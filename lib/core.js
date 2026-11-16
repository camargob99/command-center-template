// Command Center core: tasks, ops and the HTTP API, shared by the PC app (server.js) and the cloud app (cloud/worker.js).
const { COLORS } = require('./store');
const { parse, nextOccurrence, ymd } = require('./parse');
const { findSlots } = require('./slots');

function createCore({ store, google, demo = false }) {
// Every block Command Center puts on Google Calendar is Banana (yellow), so they stand apart from meetings.
const BLOCK_COLOR = '5';

// ---------- helpers ----------
const send = (status, body) => ({ status, body });

function hiddenCal(id) { return /#holiday|#contacts|#weeknum/.test(id); }

async function visibleCalendars() {
  const cals = await google.calendars();
  return cals.filter((c) => !hiddenCal(c.id) && !store.settings.hiddenCalendars.includes(c.id));
}

function taskBody(t, start, end) {
  const proj = store.projects.find((p) => p.id === t.projectId);
  return {
    summary: t.content,
    description: [t.description, `${proj ? proj.name : 'Inbox'} · Command Center`].filter(Boolean).join('\n\n'),
    start: { dateTime: start }, end: { dateTime: end },
    colorId: BLOCK_COLOR,
    extendedProperties: { private: { ccTaskId: t.id } },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
  };
}

function localDate(date, time) { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, mo - 1, d, h, mi); }

// Keep a scheduled task's Google block in line with its date, time, length and name.
async function syncBlock(t) {
  if (!t.event || !t.event.eventId) return;
  if (!t.due || !t.due.time) {
    try { await google.deleteEvent(t.event.calendarId, t.event.eventId); } catch {}
    t.event = null; return;
  }
  const oldLen = Math.round((new Date(t.event.end) - new Date(t.event.start)) / 60000);
  const start = localDate(t.due.date, t.due.time), end = new Date(start.getTime() + (t.duration || oldLen) * 60000);
  const body = taskBody(t, start.toISOString(), end.toISOString());
  await google.patchEvent(t.event.calendarId, t.event.eventId, { start: body.start, end: body.end, summary: body.summary, description: body.description, colorId: BLOCK_COLOR });
  t.event = { ...t.event, start: start.toISOString(), end: end.toISOString() };
  t.duration = Math.round((end - start) / 60000);
}

async function dropBlock(t) {
  if (t.event && t.event.eventId) { try { await google.deleteEvent(t.event.calendarId, t.event.eventId); } catch {} }
  t.event = null;
}

function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function applyTaskFields(t, b) {
  const allowed = ['content', 'description', 'projectId', 'sectionId', 'due', 'duration', 'priority', 'recurring', 'nowOrder', 'order', 'suggest', 'someday'];
  for (const k of allowed) if (k in b) t[k] = b[k];
  if (b.due) t.someday = false;
}

// ---------- day lists: date-only tasks for a day share one 15-minute block at 8:30am ----------
// The block's notes list the tasks. It follows the list as tasks are added, done, moved or deleted.
const LIST_TIME = '08:30', LIST_LEN = 15;
function dayListTasks(date) { return store.tasks.filter((t) => !t.completedAt && t.due && t.due.date === date && !t.due.time); }
async function syncDayLists() {
  if (demo || !google.connected) return false;
  let changed = false;
  // A task with a date AND a time goes on the calendar; a date alone rolls into that day's list block.
  const today0 = ymd(new Date());
  for (const t of store.tasks) {
    if (t.completedAt || t.event || !t.due || !t.due.time || t.due.date < today0) continue;
    try {
      const start = localDate(t.due.date, t.due.time), end = new Date(start.getTime() + (t.duration || store.settings.defaultLength || 30) * 60000);
      const ev = await google.insertEvent('primary', taskBody(t, start.toISOString(), end.toISOString()));
      t.event = { calendarId: 'primary', eventId: ev.id, start: start.toISOString(), end: end.toISOString(), link: ev.htmlLink || null };
      t.duration = Math.round((end - start) / 60000);
      changed = true;
    } catch { /* try again on the next change */ }
  }
  const today = ymd(new Date());
  const lists = store.data.meta.dayLists || (store.data.meta.dayLists = {});
  const dates = new Set(Object.keys(lists));
  for (const t of store.tasks) if (!t.completedAt && t.due && !t.due.time && t.due.date >= today) dates.add(t.due.date);
  for (const date of dates) {
    const cur = lists[date];
    if (date < today) { delete lists[date]; changed = true; continue; }
    const ts = dayListTasks(date).sort((a, b) => (a.now ? 0 : 1) - (b.now ? 0 : 1) || a.content.localeCompare(b.content));
    const lines = ts.map((t) => { const pr = store.projects.find((x) => x.id === t.projectId); return `${t.now ? '★' : '•'} ${t.content}${pr && pr.id !== 'inbox' ? ` (${pr.name})` : ''}`; });
    const sig = lines.join('\n');
    if (cur ? cur.sig === sig : !ts.length) continue;
    changed = true;
    try {
      if (!ts.length) { if (cur) { try { await google.deleteEvent(cur.calendarId, cur.eventId); } catch {} } delete lists[date]; continue; }
      const start = localDate(date, LIST_TIME), end = new Date(start.getTime() + LIST_LEN * 60000);
      const body = { summary: `Tasks (${ts.length}) [See Notes]`, description: `${sig}\n\nCommand Center`, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, colorId: BLOCK_COLOR, extendedProperties: { private: { ccDayList: date } }, reminders: { useDefault: false, overrides: [] } };
      let ev = null;
      if (cur) { try { ev = await google.patchEvent(cur.calendarId, cur.eventId, body); } catch { ev = null; } }
      if (!ev) ev = await google.insertEvent('primary', body);
      lists[date] = { calendarId: cur && ev.id === cur.eventId ? cur.calendarId : 'primary', eventId: ev.id, sig };
    } catch { /* Google offline or signed out: try again on the next change */ }
  }
  return changed;
}

// ---------- ops: one way in for Claude (Duet, Claude desktop, the CLI, the drop folder) ----------
// An op is a plain object, e.g. { "op": "add", "text": "Call Sam fri 2pm #Work" }.
function findTask(o) {
  if (o.id) { const t = store.task(o.id); if (!t) throw new Error(`No task with id ${o.id}`); return t; }
  const q = String(o.match || o.task || '').trim().toLowerCase();
  if (!q) throw new Error('Say which task: id or match');
  const open = store.tasks.filter((t) => !t.completedAt);
  const exact = open.filter((t) => t.content.toLowerCase() === q);
  const hits = exact.length ? exact : open.filter((t) => t.content.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `"${q}" matches ${hits.length} tasks: ${hits.slice(0, 5).map((t) => `${t.content} (${t.id})`).join('; ')}` : `No open task matches "${q}"`);
}
function resolvePlace(o) {
  let proj = null, sec = null;
  if (o.project) { proj = store.projectByName(o.project); if (!proj) proj = store.addProject(o.project); }
  if (o.section) {
    proj = proj || store.projects.find((x) => x.id === 'inbox');
    sec = proj.sections.find((x) => x.name.toLowerCase() === String(o.section).toLowerCase()) || store.addSection(proj, o.section);
  }
  return { proj, sec };
}
// A suggestion Claude leaves on an unsorted task (from the morning brief). The owner accepts or dismisses it.
function suggestion(sg) {
  if (!sg) return null;
  const pr = sg.project ? store.projectByName(sg.project) : null;
  const sec = pr && sg.section ? pr.sections.find((x) => x.name.toLowerCase() === String(sg.section).toLowerCase()) : null;
  return { content: sg.content ? String(sg.content).trim() : null, projectId: pr ? pr.id : null, sectionId: sec ? sec.id : null, due: sg.due || null, time: sg.time || null };
}
function brief(t) {
  const pr = store.projects.find((x) => x.id === t.projectId), sc = pr && pr.sections.find((x) => x.id === t.sectionId);
  return { id: t.id, content: t.content, project: pr ? pr.name : 'Inbox', section: sc ? sc.name : null, due: t.due, duration: t.duration, starred: Boolean(t.now), unsorted: !t.completedAt && !t.due && !t.now && !t.someday, someday: Boolean(t.someday), suggest: t.suggest || null, scheduled: t.event ? { start: t.event.start, end: t.event.end } : null, done: Boolean(t.completedAt), description: t.description || '' };
}
async function runOp(o) {
  const op = o.op || (o.text ? 'add' : null);
  if (op === 'add') {
    let t;
    if (o.text) {
      const r = parse(o.text, { projects: store.projects });
      if (!r.content) throw new Error('Empty task');
      let proj = r.project ? store.projectByName(r.project) : null;
      if (r.project && !proj) proj = store.addProject(r.project);
      proj = proj || store.projects.find((x) => x.id === 'inbox');
      const sec = r.section ? (proj.sections.find((x) => x.name.toLowerCase() === r.section.toLowerCase()) || store.addSection(proj, r.section)) : null;
      t = store.addTask({ content: r.content, projectId: proj.id, sectionId: sec ? sec.id : null, due: r.due, duration: r.duration, priority: r.priority || 4, now: r.now, recurring: r.recurring, source: o.source || 'claude' });
    } else {
      if (!o.content) throw new Error('add needs text or content');
      t = store.addTask({ content: String(o.content).trim(), source: o.source || 'claude' });
    }
    const { proj, sec } = resolvePlace(o);
    if (proj) { t.projectId = proj.id; t.sectionId = sec ? sec.id : null; }
    if (o.due) t.due = { date: o.due, time: o.time || null };
    for (const k of ['duration', 'priority', 'description', 'recurring']) if (o[k] != null) t[k] = o[k];
    if (o.star || o.top3) t.now = true;
    if (o.someday) t.someday = true;
    return { added: brief(t) };
  }
  if (op === 'update') {
    const t = findTask(o);
    const before = JSON.stringify([t.due, t.duration, t.content, t.projectId]);
    if (o.content) t.content = String(o.content).trim();
    const { proj, sec } = resolvePlace(o);
    if (proj) { t.projectId = proj.id; t.sectionId = sec ? sec.id : null; }
    if ('due' in o) t.due = o.due ? { date: o.due, time: o.time ?? (t.due ? t.due.time : null) } : null;
    else if ('time' in o && t.due) t.due.time = o.time;
    for (const k of ['duration', 'priority', 'description', 'recurring']) if (k in o) t[k] = o[k];
    if ('star' in o) t.now = Boolean(o.star); else if ('top3' in o) t.now = Boolean(o.top3);
    if ('someday' in o) t.someday = Boolean(o.someday);
    if (t.due) t.someday = false;
    if ('suggest' in o) t.suggest = suggestion(o.suggest);
    if (t.event && JSON.stringify([t.due, t.duration, t.content, t.projectId]) !== before) await syncBlock(t);
    return { updated: brief(t) };
  }
  if (op === 'complete') {
    const t = findTask(o);
    if (t.recurring && t.due) {
      const { id: _old, ...rest } = t;
      store.addTask({ ...rest, completedAt: new Date().toISOString(), recurring: null });
      t.due = { ...t.due, date: nextOccurrence(t.recurring, t.due.date) }; t.event = null; t.now = false;
    } else t.completedAt = new Date().toISOString();
    return { completed: brief(t) };
  }
  if (op === 'delete') {
    const t = findTask(o);
    await dropBlock(t);
    store.data.tasks = store.tasks.filter((x) => x.id !== t.id);
    return { deleted: brief(t) };
  }
  if (op === 'schedule') {
    const t = findTask(o);
    const start = new Date(o.start); if (isNaN(start)) throw new Error('schedule needs start (ISO date-time)');
    const end = o.end ? new Date(o.end) : new Date(start.getTime() + (o.minutes || t.duration || store.settings.defaultLength) * 60000);
    const body = taskBody(t, start.toISOString(), end.toISOString());
    let ev = null;
    if (t.event && t.event.eventId) { try { ev = await google.patchEvent(t.event.calendarId, t.event.eventId, { start: body.start, end: body.end, summary: body.summary, colorId: body.colorId }); } catch { ev = null; } }
    if (!ev) ev = await google.insertEvent('primary', body);
    t.event = { calendarId: 'primary', eventId: ev.id, start: start.toISOString(), end: end.toISOString(), link: ev.htmlLink || null };
    t.due = { date: ymd(start), time: hhmm(start) }; t.duration = Math.round((end - start) / 60000);
    return { scheduled: brief(t) };
  }
  if (op === 'unschedule') { const t = findTask(o); await dropBlock(t); if (t.due) t.due.time = null; return { unscheduled: brief(t) }; }
  if (op === 'list') {
    const today = ymd(new Date());
    let ts = store.tasks.filter((t) => (o.done ? t.completedAt : !t.completedAt));
    if (o.project) { const pr = store.projectByName(o.project); ts = ts.filter((t) => pr && t.projectId === pr.id); }
    if (o.when === 'today') ts = ts.filter((t) => t.now || (t.due && t.due.date <= today));
    if (o.when === 'unsorted') ts = ts.filter((t) => !t.due && !t.now && !t.someday);
    if (o.when === 'overdue') ts = ts.filter((t) => t.due && t.due.date < today);
    if (o.match) { const q = String(o.match).toLowerCase(); ts = ts.filter((t) => t.content.toLowerCase().includes(q)); }
    return { tasks: ts.slice(0, o.limit || 200).map(brief), count: ts.length };
  }
  if (op === 'projects') return { projects: store.projects.filter((x) => !x.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((x) => ({ id: x.id, name: x.name, sections: [...x.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((y) => y.name) })) };
  throw new Error(`Unknown op "${op}". Use add, update, complete, delete, schedule, unschedule, list, projects.`);
}
async function runOps(list) {
  const results = [];
  for (const o of list) { try { results.push({ ok: true, ...(await runOp(o)) }); } catch (e) { results.push({ ok: false, op: o.op, error: e.message }); } }
  await syncDayLists();
  store.save();
  return results;
}

// ---------- routes ----------
async function api(m, url, b0) {
  const res = await route(m, url, b0);
  if (m !== 'GET' && res.status < 400 && url.pathname.startsWith('/api/') && url.pathname !== '/api/ops' && await syncDayLists()) store.save();
  return res;
}

async function route(m, url, b0) {
  const readBody = async () => b0 || {};
  const p = url.pathname;
  const seg = p.split('/').filter(Boolean); // ['api', ...]

  if (m === 'GET' && p === '/api/state') {
    return send(200, {
      projects: store.projects, tasks: store.tasks, settings: store.settings,
      google: { configured: google.configured, connected: google.connected, canUnstar: google.canUnstar }, demo,
      meta: store.data.meta,
    });
  }

  if (m === 'POST' && p === '/api/quickadd') {
    const b = await readBody();
    const r = parse(b.text || '', { projects: store.projects });
    if (!r.content) return send(400, { error: 'Type a task name' });
    let proj = r.project ? store.projectByName(r.project) : null;
    if (r.project && !proj) proj = store.addProject(r.project);
    proj = proj || store.projects.find((x) => x.id === 'inbox');
    let sec = null;
    if (r.section) sec = proj.sections.find((s) => s.name.toLowerCase() === r.section.toLowerCase()) || store.addSection(proj, r.section);
    const t = store.addTask({ content: r.content, projectId: proj.id, sectionId: sec ? sec.id : null, due: r.due, duration: r.duration, priority: r.priority || 4, now: r.now, recurring: r.recurring });
    store.save();
    return send(200, { task: t, parsed: r });
  }

  if (m === 'GET' && p === '/api/rev') return send(200, { rev: store.data.meta.rev || 0 });

  if (m === 'POST' && p === '/api/ops') {
    const b = await readBody();
    const ops = Array.isArray(b) ? b : Array.isArray(b.ops) ? b.ops : [b];
    return send(200, { results: await runOps(ops) });
  }

  if (m === 'POST' && p === '/api/parse') {
    const b = await readBody();
    return send(200, parse(b.text || '', { projects: store.projects }));
  }

  if (seg[1] === 'tasks' && seg[2]) {
    const t = store.task(seg[2]);
    if (!t) return send(404, { error: 'No such task' });
    const action = seg[3];

    if (m === 'PATCH' && !action) {
      const b = await readBody();
      if (b.now === true && !t.now) { t.now = true; t.nowOrder = 99; }
      else if (b.now === false) t.now = false;
      const before = JSON.stringify([t.due, t.duration, t.content, t.projectId]);
      applyTaskFields(t, b);
      if (t.event && !t.completedAt && JSON.stringify([t.due, t.duration, t.content, t.projectId]) !== before) await syncBlock(t);
      store.save();
      return send(200, { task: t });
    }
    if (m === 'DELETE' && !action) {
      if (!t.completedAt) await dropBlock(t);
      store.data.tasks = store.tasks.filter((x) => x.id !== t.id);
      store.save();
      return send(200, { ok: true });
    }
    if (m === 'POST' && action === 'complete') {
      if (t.recurring && t.due) {
        const next = nextOccurrence(t.recurring, t.due.date);
        const { id: _old, ...rest } = t; // keep a completed copy of this occurrence
        store.addTask({ ...rest, completedAt: new Date().toISOString(), recurring: null });
        t.due = { ...t.due, date: next }; t.event = null; t.now = false;
      } else {
        t.completedAt = new Date().toISOString();
      }
      store.save();
      return send(200, { task: t });
    }
    if (m === 'POST' && action === 'uncomplete') {
      t.completedAt = null; store.save();
      return send(200, { task: t });
    }
    if (m === 'POST' && action === 'schedule') {
      const b = await readBody();
      const start = new Date(b.start), end = new Date(b.end);
      const body = taskBody(t, start.toISOString(), end.toISOString());
      let ev;
      if (t.event && t.event.eventId) {
        try { ev = await google.patchEvent(t.event.calendarId, t.event.eventId, { start: body.start, end: body.end, summary: body.summary, description: body.description, colorId: body.colorId }); } catch { ev = null; }
      }
      if (!ev) ev = await google.insertEvent('primary', body);
      t.event = { calendarId: 'primary', eventId: ev.id, start: start.toISOString(), end: end.toISOString(), link: ev.htmlLink || null };
      t.due = { date: ymd(start), time: hhmm(start) };
      t.duration = Math.round((end - start) / 60000);
      store.save();
      return send(200, { task: t });
    }
    if (m === 'DELETE' && action === 'schedule') {
      await dropBlock(t); if (t.due) t.due.time = null;
      store.save();
      return send(200, { task: t });
    }
  }

  if (m === 'GET' && p === '/api/calendars') {
    return send(200, { calendars: await google.calendars() });
  }

  if (m === 'GET' && p === '/api/events') {
    const timeMin = url.searchParams.get('start'), timeMax = url.searchParams.get('end');
    const cals = await visibleCalendars();
    const all = (await Promise.all(cals.map(async (c) => (await google.events(c.id, timeMin, timeMax)).map((e) => ({ e, c }))))).flat();
    const seen = new Set();
    const out = [];
    // Primary first so its copy wins when the same event is on two calendars.
    all.sort((a, b) => (b.c.primary ? 1 : 0) - (a.c.primary ? 1 : 0));
    for (const { e, c } of all) {
      if (e.status === 'cancelled') continue;
      const start = e.start.dateTime || e.start.date, end = e.end.dateTime || e.end.date;
      const key = `${(e.summary || '').trim().toLowerCase()}|${new Date(start).getTime()}|${new Date(end).getTime()}`;
      if (seen.has(key)) continue; seen.add(key);
      const taskId = e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.ccTaskId;
      out.push({ id: e.id, calendarId: c.id, calendar: c.name, title: e.summary || '(busy)', start, end, allDay: !e.start.dateTime, location: e.location || '', taskId: taskId || null, calColor: c.color, link: e.htmlLink || null, editable: c.accessRole === 'owner' || c.accessRole === 'writer' });
    }
    return send(200, { events: out });
  }

  if (m === 'PATCH' && p === '/api/events') {
    const b = await readBody();
    await google.patchEvent(b.calendarId, b.eventId, { start: { dateTime: b.start }, end: { dateTime: b.end } });
    const t = store.tasks.find((x) => x.event && x.event.eventId === b.eventId);
    if (t) {
      const s = new Date(b.start), e = new Date(b.end);
      t.event = { ...t.event, start: s.toISOString(), end: e.toISOString() };
      t.due = { date: ymd(s), time: hhmm(s) }; t.duration = Math.round((e - s) / 60000);
      store.save();
    }
    return send(200, { ok: true });
  }

  if (m === 'GET' && p === '/api/slots') {
    const len = Number(url.searchParams.get('length') || store.settings.defaultLength);
    const days = Number(url.searchParams.get('days') || 5);
    const offset = Math.max(0, Math.min(60, Number(url.searchParams.get('offset') || 0)));
    const now = new Date();
    const from = new Date(now); if (offset) { from.setHours(0, 0, 0, 0); from.setDate(from.getDate() + offset); }
    const end = new Date(now); end.setDate(end.getDate() + offset + days + 1);
    const cals = store.settings.busyCalendars || (await visibleCalendars()).map((c) => c.id);
    const busy = await google.freeBusy(cals, from.toISOString(), end.toISOString());
    return send(200, { offset, days: findSlots({ busy, now, days, offset, lengthMin: len, settings: store.settings }) });
  }

  // Email is a daily batch: once a day, take the starred emails from the last 15 days that still need a
  // reply. Dismissing one takes it out of today's batch and nothing refills it, so the list can reach 0.
  // ?refresh=1 rebuilds the batch now.
  if (m === 'GET' && p === '/api/starred') {
    const today = ymd(new Date());
    let b = store.settings.mailBatch;
    if (!b || b.date !== today || url.searchParams.has('refresh')) {
      const hidden = store.settings.dismissedMail || [];
      b = store.settings.mailBatch = { date: today, emails: (await google.starred({ days: 15 })).filter((e) => !hidden.includes(e.id)) };
      store.save();
    }
    return send(200, { emails: b.emails, batchDate: b.date });
  }
  const mailM = p.match(/^\/api\/starred\/([\w-]+)(\/dismiss)?$/);
  if (mailM && m === 'GET' && !mailM[2]) return send(200, await google.message(mailM[1]));
  if (mailM && m === 'POST' && mailM[2]) {
    const id = mailM[1];
    const b = store.settings.mailBatch;
    if (b) b.emails = b.emails.filter((e) => e.id !== id);
    // Unstar in Gmail when allowed; otherwise remember it so tomorrow's batch skips it too.
    let unstarred = false;
    try { await google.unstar(id); unstarred = true; } catch {}
    if (!unstarred) {
      const list = (store.settings.dismissedMail || []).filter((x) => x !== id);
      store.settings.dismissedMail = [id, ...list].slice(0, 200);
    }
    store.save();
    return send(200, { ok: true, unstarred });
  }

  if (m === 'PATCH' && p === '/api/settings') {
    const b = await readBody();
    Object.assign(store.settings, b); store.save();
    return send(200, { settings: store.settings });
  }

  if (m === 'POST' && p === '/api/top3/order') {
    const b = await readBody();
    (b.ids || []).forEach((tid, i) => { const t = store.task(tid); if (t) t.nowOrder = i; });
    store.save();
    return send(200, { ok: true });
  }

  if (m === 'POST' && p === '/api/projects/order') {
    const b = await readBody();
    (b.ids || []).forEach((pid, i) => { const pr = store.projects.find((x) => x.id === pid); if (pr && pr.id !== 'inbox') pr.order = i + 1; });
    store.save();
    return send(200, { ok: true });
  }

  if (seg[1] === 'projects' && seg[2] && !seg[3] && (m === 'PATCH' || m === 'DELETE')) {
    const pr = store.projects.find((x) => x.id === seg[2]);
    if (!pr) return send(404, { error: 'No such project' });
    if (m === 'PATCH') {
      const b = await readBody();
      if (typeof b.name === 'string' && b.name.trim()) {
        if (pr.id === 'inbox') return send(400, { error: "Inbox can't be renamed" });
        pr.name = b.name.trim();
      }
      for (const k of ['color', 'boardLayout']) if (k in b) pr[k] = b[k];
      if ('archived' in b && pr.id !== 'inbox') pr.archived = Boolean(b.archived);
      store.save();
      return send(200, { project: pr });
    }
    if (pr.id === 'inbox') return send(400, { error: "Inbox can't be deleted" });
    const mode = url.searchParams.get('tasks') === 'delete' ? 'delete' : 'move';
    const mine = store.tasks.filter((t) => t.projectId === pr.id);
    for (const t of mine) {
      if (mode === 'delete' || t.completedAt) { if (!t.completedAt) await dropBlock(t); }
      else { t.projectId = 'inbox'; t.sectionId = null; }
    }
    store.data.tasks = store.tasks.filter((t) => t.projectId !== pr.id);
    store.data.projects = store.projects.filter((x) => x.id !== pr.id);
    store.save();
    return send(200, { ok: true, moved: mode === 'move' ? mine.filter((t) => !t.completedAt).length : 0 });
  }

  if (seg[1] === 'projects' && seg[2] && seg[3] === 'sections' && seg[4]) {
    const pr = store.projects.find((x) => x.id === seg[2]);
    if (!pr) return send(404, { error: 'No such project' });
    if (m === 'POST' && seg[4] === 'order') {
      const b = await readBody();
      (b.ids || []).forEach((sid, i) => { const sc = pr.sections.find((x) => x.id === sid); if (sc) sc.order = i; });
      store.save();
      return send(200, { ok: true });
    }
    const sec = pr.sections.find((x) => x.id === seg[4]);
    if (!sec) return send(404, { error: 'No such section' });
    if (m === 'PATCH') {
      const b = await readBody();
      if (typeof b.name === 'string' && b.name.trim()) sec.name = b.name.trim();
      store.save();
      return send(200, { section: sec });
    }
    if (m === 'DELETE') {
      const mode = url.searchParams.get('tasks') === 'delete' ? 'delete' : 'move';
      const mine = store.tasks.filter((t) => t.projectId === pr.id && t.sectionId === sec.id);
      for (const t of mine) {
        if (mode === 'delete' && !t.completedAt) await dropBlock(t);
        if (mode === 'move' || t.completedAt) t.sectionId = null;
      }
      if (mode === 'delete') store.data.tasks = store.tasks.filter((t) => !(t.projectId === pr.id && t.sectionId === sec.id && !t.completedAt));
      pr.sections = pr.sections.filter((x) => x.id !== sec.id);
      store.save();
      return send(200, { ok: true });
    }
  }

  if (m === 'POST' && seg[1] === 'projects' && seg[2] && seg[3] === 'sections') {
    const pr = store.projects.find((x) => x.id === seg[2]);
    if (!pr) return send(404, { error: 'No such project' });
    const b = await readBody();
    const name = String(b.name || '').trim();
    if (!name) return send(400, { error: 'Give the section a name' });
    const sec = pr.sections.find((x) => x.name.toLowerCase() === name.toLowerCase()) || store.addSection(pr, name);
    store.save();
    return send(200, { section: sec });
  }

  if (m === 'POST' && p === '/api/projects') {
    const b = await readBody();
    const pr = store.addProject(b.name); store.save();
    return send(200, { project: pr });
  }

  return send(404, { error: 'Not found' });
}

async function recolorOldBlocks() {
  if (demo || store.data.meta.blocksYellow || !google.connected) return;
  const soon = Date.now() - 7 * 864e5;
  for (const t of store.tasks) {
    if (!t.event || !t.event.eventId || new Date(t.event.end).getTime() < soon) continue;
    try { await google.patchEvent(t.event.calendarId, t.event.eventId, { colorId: BLOCK_COLOR }); } catch {}
  }
  store.data.meta.blocksYellow = true; store.save();
}

  return { api, runOps, runOp, recolorOldBlocks, syncDayLists };
}

module.exports = { createCore, COLORS };
