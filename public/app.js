/* Command Center front end. Plain JS, no build step. */
'use strict';
const S = {
  projects: [], tasks: [], settings: {}, google: {}, events: [], todayEvents: [], starred: [], wa: null, mailOpen: null, mailText: {}, waSeen: {},
  view: 'tasks', nav: 'today', weekStart: null,
  projView: pref('cc.projView', 'board'), collapsed: JSON.parse(pref('cc.collapsed', '{}')), showDone: {}, openRails: {}, showArch: false,
};
const HOUR_PX = 46, START_H = 6, END_H = 24;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch {} }

const ICON = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/></svg>',
  upcoming: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

// Stored project colors (also used for Google Calendar colors) shown as muted "colored pencil" inks.
const INK = { '#7a7f87': '#a39e93', '#e8743b': '#c2643c', '#19a979': '#5b8a68', '#13447c': '#45699c', '#d6417e': '#9b2c45', '#1f8a3b': '#3d8786', '#5c3fb4': '#6a5a9c', '#e05a5a': '#7b5d8f', '#2a8fbd': '#3f7f9e', '#b38600': '#a8842c' };
const ink = (p) => (p && (INK[p.color] || p.color)) || '#a39e93';

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.code === 'SIGN_IN') { location.href = '/auth/google'; return new Promise(() => {}); }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, data: j });
  return j;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); 
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); while (x.getDay() !== 1) x.setDate(x.getDate() - 1); return x; }
function fmtTime(d, short) { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return (m ? `${h}:${pad(m)}` : `${h}`) + (short ? '' : ap); }
function fmtRange(s, e) { const ap = (d) => (d.getHours() >= 12 ? 'pm' : 'am'); return ap(s) === ap(e) ? `${fmtTime(s, true)} – ${fmtTime(e)}` : `${fmtTime(s)} – ${fmtTime(e)}`; }
function fmtHHMM(s) { const [h, m] = s.split(':').map(Number); const d = new Date(); d.setHours(h, m); return fmtTime(d); }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function dueLabel(t) {
  if (!t.due) return null;
  const today = ymd(new Date()), tom = ymd(addDays(new Date(), 1));
  const d = new Date(`${t.due.date}T00:00:00`);
  const days = Math.round((d - new Date(`${today}T00:00:00`)) / 864e5);
  let txt = t.due.date === today ? 'Today' : t.due.date === tom ? 'Tomorrow' : (days > 0 && days < 7) ? DOW[d.getDay()] : `${MON[d.getMonth()]} ${d.getDate()}`;
  if (t.due.time) txt += ` ${fmtHHMM(t.due.time)}`;
  if (t.due.date < today) txt = `since ${MON[d.getMonth()]} ${d.getDate()}`;
  return { txt, late: t.due.date < today, today: t.due.date === today };
}
function ago(iso) { const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? 'now' : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`; }

// ---------- data ----------
let lastRev = null; // last data version seen, so changes from Claude show up without a reload
async function loadState() {
  const s = await api('/api/state');
  Object.assign(S, { projects: s.projects, tasks: s.tasks, settings: s.settings, google: s.google, demo: s.demo });
  lastRev = (s.meta && s.meta.rev) || 0;
}
async function fetchEvents(start, end) {
  return (await api(`/api/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)).events;
}
async function loadEvents() {
  if (!S.google.connected) { S.events = []; S.todayEvents = []; return; }
  try {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const [wk, td] = await Promise.all([fetchEvents(S.weekStart, addDays(S.weekStart, 7)), fetchEvents(t0, addDays(t0, 1))]);
    S.events = wk; S.todayEvents = td;
  } catch (e) { if (e.status === 401) { S.google.connected = false; renderBanner(); } else toast(`Calendar: ${e.message}`); }
}
async function loadStarred() {
  if (!S.google.connected) { S.starred = []; return; }
  try { S.starred = (await api('/api/starred')).emails; } catch { S.starred = []; }
}
// WhatsApp events (cloud only; the PC version has no /api/whatsapp, so its tab stays hidden there)
async function loadWA() {
  try { S.wa = await api('/api/whatsapp'); } catch { S.wa = null; return; }
  S.waCal = [];
  if (S.google.connected && S.wa.events.length) {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    try { S.waCal = await fetchEvents(t0, addDays(t0, 16)); } catch {}
  }
  waMatchCalendar();
}
// An event already on your calendar (same day, similar name) counts as registered: show a tick once, then it drops off.
const WA_STOP = new Set('the and for with from your our this that club event events night party happy hour lunch dinner session meeting info talk wg27 wg26 class cohort mba join'.split(' '));
const waWords = (t) => new Set(String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !WA_STOP.has(w)));
function waMatchCalendar() {
  for (const e of S.wa.events) {
    if (!e.date || S.waSeen[e.id]) continue;
    const words = waWords(e.title);
    const hit = (S.waCal || []).find((c) => {
      if (c.taskId || ymd(new Date(c.start)) !== e.date) return false;
      const cw = waWords(c.title); let n = 0; words.forEach((w) => { if (cw.has(w)) n++; });
      const near = e.time && !c.allDay && Math.abs(new Date(c.start) - new Date(`${e.date}T${e.time}:00`)) <= 60 * 6e4;
      return n >= 2 || (n >= 1 && near);
    });
    if (hit) {
      S.waSeen[e.id] = 'cal';
      api(`/api/whatsapp/events/${e.id}`, { method: 'PATCH', body: { status: 'registered' } }).catch(() => {});
    }
  }
}
async function refresh(all = true) {
  await loadState();
  if (all) { await Promise.all([loadEvents(), loadStarred(), loadWA()]); S.syncedAt = new Date(); }
  render();
}

const proj = (id) => S.projects.find((p) => p.id === id) || S.projects[0];
// Inbox first, then the order you set; archived projects drop out of lists.
const projList = (o = {}) => [...S.projects].filter((p) => o.archived || !p.archived).sort((a, b) => (a.id === 'inbox' ? -1 : b.id === 'inbox' ? 1 : (a.order ?? 0) - (b.order ?? 0)));
const secList = (p) => [...p.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const lenLabel = (l) => (l < 60 ? `${l}m` : `${Math.floor(l / 60)}h${l % 60 ? ` ${l % 60}m` : ''}`);
const hhmmOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function dayWord(d) { const k = ymd(d); return k === todayKey() ? 'Today' : k === ymd(addDays(new Date(), 1)) ? 'Tomorrow' : `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; }

function openMenu(anchor, items, o = {}) {
  closeMenu();
  const m = document.createElement('div'); m.id = 'menu'; m.className = `menu${o.cls ? ` ${o.cls}` : ''}`;
  m.innerHTML = o.html || items.map((it, i) => (it.sep ? '<hr>' : `<button class="mi${it.danger ? ' danger' : ''}" data-mi="${i}">${esc(it.label)}</button>`)).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(o.alignLeft ? r.left : r.right - w, innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  m.onclick = async (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; closeMenu(); try { await items[Number(b.dataset.mi)].run(); } catch (err) { toast(err.message); } };
}
function closeMenu() { const m = $('#menu'); if (m) m.remove(); }
function askText(title, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2><input class="ask-input" value="${esc(value)}"><div class="modal-actions"><span></span><div class="right"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div></div>`, (card) => {
      const inp = $('.ask-input', card);
      const ok = () => { const v = inp.value.trim(); if (!v) return; closeModal(); resolve(v); };
      $('[data-ok]', card).onclick = ok; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      $$('[data-close]', card).forEach((b) => b.addEventListener('click', () => resolve(null)));
      inp.focus(); inp.select();
    }, 'modal-card narrow');
  });
}
function askChoice(title, sub, choices) {
  // choices: [{label, value, cls}] ; resolves to value or null
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2>${sub ? `<div class="modal-sub">${esc(sub)}</div>` : ''}<div class="modal-actions"><span></span><div class="right"><button class="btn ghost" data-close>Cancel</button>${choices.map((c, i) => `<button class="btn ${c.cls || ''}" data-c="${i}">${esc(c.label)}</button>`).join('')}</div></div>`, (card) => {
      $$('[data-c]', card).forEach((b) => b.onclick = () => { closeModal(); resolve(choices[Number(b.dataset.c)].value); });
      $$('[data-close]', card).forEach((b) => b.addEventListener('click', () => resolve(null)));
    }, 'modal-card narrow');
  });
}
const sectionOf = (t) => { const p = proj(t.projectId); return p.sections.find((s) => s.id === t.sectionId) || null; };
const openTasks = () => S.tasks.filter((t) => !t.completedAt);
const todayKey = () => ymd(new Date());
const top3 = () => S.tasks.filter((t) => t.now && !t.completedAt).sort((a, b) => (a.nowOrder ?? 50) - (b.nowOrder ?? 50) || a.createdAt.localeCompare(b.createdAt));
const top3DoneToday = () => S.tasks.filter((t) => t.now && t.completedAt && ymd(new Date(t.completedAt)) === todayKey());
const unsorted = () => openTasks().filter((t) => !t.due && !t.now && !t.someday).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const restOfToday = () => sortTasks(openTasks().filter((t) => !t.now && t.due && t.due.date <= todayKey()));
function atRisk(t) { if (!t.due || t.completedAt) return false; return new Date(`${t.due.date}T${t.due.time || '23:59'}:00`) - Date.now() < 24 * 3600e3; }
function sortTasks(list) {
  const k = (t) => (t.due ? t.due.date + (t.due.time || '99') : '9999');
  return [...list].sort((a, b) => k(a).localeCompare(k(b)) || (a.priority - b.priority) || a.content.localeCompare(b.content));
}

// ---------- shared pieces ----------
const projChip = (t, withSection = true) => { const p = proj(t.projectId), s = withSection && sectionOf(t); return `<span class="proj"><i style="background:${ink(p)}"></i>${esc(p.name)}${s ? ` · ${esc(s.name)}` : ''}</span>`; };
function metaBits(t, o = {}) {
  const out = [];
  if (o.project) out.push(projChip(t, o.section !== false));
  if (o.starTag && t.now) out.push('<span class="star-tag">★ Starred</span>');
  const due = dueLabel(t);
  if (due && !(t.event && !due.late)) out.push(`<span class="${due.late ? 'late' : ''}">${esc(due.txt)}</span>`);
  if (t.duration && !t.event) out.push(`<span>${t.duration} min</span>`);
  if (t.recurring) out.push(`<span>↻ every ${esc(t.recurring)}</span>`);
  if (t.completedAt && o.doneAt) out.push(`<span>done ${fmtTime(new Date(t.completedAt))}</span>`);
  return out.join('');
}
function rhs(t) {
  if (t.completedAt) return '';
  const star = `<button class="act ico${t.now ? ' on' : ''}" data-act="now" title="${t.now ? 'Unstar' : 'Star'}">${ICON.star}</button>`;
  const edit = `<button class="act ico" data-act="edit" title="Edit">${ICON.edit}</button>`;
  const sched = t.event
    ? `<button class="when cal" data-act="schedule" title="Move on calendar">${fmtRange(new Date(t.event.start), new Date(t.event.end))}</button>`
    : `<button class="act sched" data-act="schedule">${ICON.cal}Schedule</button>`;
  return `<div class="rhs">${star}${edit}${sched}</div>`;
}
function hlTitle(t) { return t.now ? `<span class="hl"><span>${esc(t.content)}</span></span>` : esc(t.content); }
function row(t, o = {}) {
  const lead = o.rank ? `<span class="rank">${o.rank}</span>` : `<span class="handle">${o.drag === false ? '' : '⋮⋮'}</span>`;
  return `<div class="row${t.completedAt ? ' donerow' : ''}" data-task="${t.id}" ${o.drag === false || t.completedAt ? '' : 'draggable="true"'}>
    ${lead}<button class="ck${t.completedAt ? ' done' : t.priority === 1 ? ' p1' : ''}" data-act="${t.completedAt ? 'uncomplete' : 'complete'}" aria-label="Complete"></button>
    <div style="min-width:0"><div class="t" data-act="edit">${o.hl ? hlTitle(t) : esc(t.content)}</div><div class="m">${metaBits(t, o)}</div></div>${rhs(t)}</div>`;
}

// ---------- render ----------
function render() {
  $('#side').classList.toggle('tray', S.view === 'calendar');
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('#qa').classList.toggle('hidden', S.view === 'tasks' && S.nav === 'inbox');
  $('#theme-btn').innerHTML = document.documentElement.classList.contains('dark') ? ICON.sun : ICON.moon;
  renderBanner();
  if (S.view === 'calendar') { renderTray(); renderCalendar(); }
  else { renderSide(); renderTasks(); }
}

function renderBanner() {
  const b = $('#banner');
  let html = '';
  if (S.demo) html = '<b>Demo mode.</b> Sample tasks and a pretend calendar. Nothing touches your real Google account.';
  else if (!S.google.configured) html = '<b>Google isn\'t set up yet.</b> Follow step 3 in README.md (add your Google client ID to config.json), then restart.';
  else if (!S.google.connected) html = '<b>Connect Google</b> to see your calendar and starred email. <a href="/auth/google">Connect Google →</a>';
  b.innerHTML = html; b.classList.toggle('hidden', !html);
}

function renderSide() {
  const open = openTasks();
  const nav = (key, icon, label, count) => `<button class="nav${S.nav === key && S.view === 'tasks' ? ' on' : ''}" data-nav="${key}">${icon}<span class="lbl">${label}</span><span class="ct">${count || ''}</span></button>`;
  const todayCount = top3().length + restOfToday().length;
  const inbox = S.projects.find((p) => p.id === 'inbox');
  const upcoming = open.filter((t) => t.due && t.due.date > todayKey()).length;
  let h = '<div class="mark"><span class="logo">Command <i>Center</i></span></div>';
  h += nav('today', ICON.today, 'Today', todayCount) + nav('inbox', ICON.inbox, 'Inbox', unsorted().length) + nav('upcoming', ICON.upcoming, 'Upcoming', upcoming);
  h += '<div class="eyebrow"><span>Projects</span><button data-act="add-project" title="New project">+</button></div>';
  for (const p of projList()) {
    if (p === inbox) continue;
    const ts = open.filter((t) => t.projectId === p.id);
    const risk = ts.some(atRisk);
    h += `<button class="nav pnav${S.nav === `p:${p.id}` && S.view === 'tasks' ? ' on' : ''}" draggable="true" data-projdrag="${p.id}" data-nav="p:${p.id}"><span class="sgrip">⋮⋮</span><span class="tick" style="background:${ink(p)}"></span><span class="lbl">${esc(p.name)}</span>${risk ? '<span class="risk" title="Something due within a day"></span>' : ''}<span class="ct">${ts.length || ''}</span></button>`;
  }
  const arch = projList({ archived: true }).filter((p) => p.archived);
  if (arch.length) {
    h += `<button class="nav arch-toggle" data-act="toggle-arch"><span class="lbl">Archived</span><span class="ct">${arch.length}</span></button>`;
    if (S.showArch) for (const p of arch) h += `<button class="nav pnav archived${S.nav === `p:${p.id}` ? ' on' : ''}" data-nav="p:${p.id}"><span class="tick" style="background:${ink(p)}"></span><span class="lbl">${esc(p.name)}</span></button>`;
  }
  $('#side').innerHTML = h;
}

function renderTray() {
  const need = sortTasks(openTasks().filter((t) => !t.event && ((t.due && t.due.date <= ymd(addDays(new Date(), 2))) || t.now)));
  let h = '<div class="mark"><span class="logo">Command <i>Center</i></span></div><div class="eyebrow"><span>Needs a time</span></div>';
  h += need.length ? need.map((t) => { const p = proj(t.projectId), due = dueLabel(t); return `<div class="tc" draggable="true" data-task="${t.id}" style="--c:${ink(p)}"><div class="t" data-act="edit">${esc(t.content)}</div><div class="m">${t.now ? '★ ' : ''}${esc(p.name)}${due ? ` · <span class="${due.late ? 'late' : ''}">${esc(due.txt)}</span>` : ''}${t.duration ? ` · ${t.duration} min` : ''}</div></div>`; }).join('')
    : '<div class="empty" style="padding:8px 10px">Everything due soon already has a time.</div>';
  $('#side').innerHTML = h;
}

// ----- Tasks tab -----
function renderTasks() {
  if (S.nav.startsWith('p:')) return renderProject(S.nav.slice(2));
  if (S.nav === 'inbox') return renderInbox();
  if (S.nav === 'upcoming') return renderUpcoming();
  renderToday();
}

function ribbonHTML() {
  const ws = S.settings.workStart || '08:00', we = (new Date().getDay() % 6 === 0 ? S.settings.weekendEnd : S.settings.weekdayEnd) || '21:00';
  const h0 = Number(ws.split(':')[0]), h1 = Math.max(h0 + 4, Math.ceil(Number(we.split(':')[0]) + Number(we.split(':')[1]) / 60));
  const pct = (d) => ((d.getHours() + d.getMinutes() / 60 - h0) / (h1 - h0)) * 100;
  let r = '<div class="ribbon"><div class="track"></div>';
  for (let h = h0; h <= h1; h++) if ((h - h0) % 2 === 0) r += `<span class="hr" style="left:${((h - h0) / (h1 - h0)) * 100}%">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</span>`;
  const byId = Object.fromEntries(S.tasks.map((t) => [t.id, t]));
  for (const e of S.todayEvents.filter((x) => !x.allDay)) {
    const s = new Date(e.start), en = new Date(e.end);
    let a = Math.max(0, pct(s)), b = Math.min(100, pct(en)); if (b <= 0 || a >= 100) continue;
    const t = e.taskId && byId[e.taskId];
    const style = `left:calc(${a}% + 2px);width:calc(${b - a}% - 4px);${t ? `--c:${ink(proj(t.projectId))}` : ''}`;
    r += `<div class="blk ${t ? 'task' : 'meet'}" ${t ? `data-task="${t.id}" data-act="edit"` : ''} style="${style}" title="${esc(t ? t.content : e.title)} · ${fmtRange(s, en)}">${esc(t ? t.content : e.title)}</div>`;
  }
  const n = pct(new Date());
  if (n >= 0 && n <= 100) r += `<div class="now" style="left:${n}%"></div>`;
  return r + '</div>';
}

// Status line header: date · week | top 3 | open (late) | booked | next | synced
function isoWeek(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); }
function statusLine(d, tops, done, rest, onCal) {
  const late = [...tops, ...rest].filter((t) => t.due && t.due.date < todayKey()).length;
  const now = Date.now();
  const seen = new Set();
  const next = [...S.todayEvents, ...S.events].filter((e) => !e.allDay && new Date(e.start) > now && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const nextWhen = next && (ymd(new Date(next.start)) === todayKey() ? fmtTime(new Date(next.start)) : `${dayWord(new Date(next.start)).replace('Tomorrow', 'tmrw')} ${fmtTime(new Date(next.start))}`);
  const booked = `${Math.floor(onCal / 60)}h${pad(Math.round(onCal % 60))}`;
  const k = (x) => `<span class="k">${x}</span>`;
  return `<div class="stl"><span><b>${DOW[d.getDay()].toUpperCase()} ${d.getDate()} ${MON[d.getMonth()].toUpperCase()}</b> · W${isoWeek(d)}</span>`
    + `<span>${k('starred')}<b>${tops.length}</b></span>`
    + `<span>${k('open')}<b>${tops.length + rest.length}</b>${late ? ` <span class="late">(${late} late)</span>` : ''}</span>`
    + `<span>${k('booked')}<b>${booked}</b></span>`
    + (next ? `<span class="nx">${k('next')}<b>${esc(next.title)}</b> · ${nextWhen}</span>` : '')
    + `<span class="sy"><span class="ok">●</span> synced ${fmtTime(S.syncedAt || new Date())}</span></div>`;
}
function renderToday() {
  const d = new Date(), tops = top3(), done = top3DoneToday(), rest = restOfToday();
  const onCal = S.todayEvents.filter((e) => !e.allDay).reduce((m, e) => m + (new Date(e.end) - new Date(e.start)) / 6e4, 0);
  const calTxt = onCal ? ` · ${Math.floor(onCal / 60)}h${onCal % 60 ? ` ${Math.round(onCal % 60)}m` : ''} on your calendar` : '';
  let topH = '<div class="top3" id="top3">';
  tops.forEach((t) => { topH += row(t, { hl: true, project: true }); });
  done.forEach((t) => { topH += row(t, { hl: true, project: true, doneAt: true }); });
  if (!tops.length && !done.length) topH += '<div class="empty">Nothing starred.</div>';
  topH += '</div>';
  const pull = tops.length > 1 ? 'Drag to rank' : '';
  const restH = rest.length ? rest.map((t) => row(t, { project: true })).join('') : '<div class="empty">Nothing else due today.</div>';
  $('#view').innerHTML = `
    <div class="head st">${statusLine(d, tops, done, rest, onCal)}</div>
    ${ribbonHTML()}
    <div class="body today2">
      <div class="col">
        <section class="sheet tablet"><div class="section-h"><h3>Starred</h3><span class="aside">${pull}</span></div>${topH}</section>
        <section class="sheet rest"><div class="scroll">
          <div class="section-h"><h3>Rest of today</h3><span class="aside">${rest.length} task${rest.length === 1 ? '' : 's'}${rest.filter((t) => t.due.date < todayKey()).length ? ` · ${rest.filter((t) => t.due.date < todayKey()).length} overdue` : ''}</span></div>${restH}
        </div></section>
      </div>
      <div class="col${S.wa ? '' : ' mail-only'}">${mailHTML()}${S.wa ? waHTML() : ''}</div>
    </div>`;
}

const gmailLink = (m) => `https://mail.google.com/mail/u/0/#all/${esc(m.threadId)}`;
function mailHTML() {
  let rows;
  if (!S.google.connected) rows = '<div class="empty">Connect Google to see emails you star.</div>';
  else if (!S.starred.length) rows = '<div class="empty">All caught up. Tomorrow brings a new batch of starred emails from the last 15 days that you haven’t answered.</div>';
  else rows = S.starred.map((m) => {
    const open = S.mailOpen === m.id;
    const full = open ? `<div class="efull">${S.mailText[m.id] == null ? '<span class="dim">Loading…</span>' : esc(S.mailText[m.id]) || '<span class="dim">(no text)</span>'}</div>
      <div class="eacts big"><button class="go" data-act="mail-task">Make task</button><button data-act="mail-sched">Schedule reply</button><a href="${gmailLink(m)}" target="_blank" rel="noopener">Open in Gmail ↗</a><button data-act="mail-dismiss">Dismiss</button><button data-act="mail-pop">⤢ Bigger</button></div>` : '';
    return `<div class="er${open ? ' open' : ''}" data-mail="${m.id}"><span class="car" data-act="mail-open">${open ? '⌄' : '›'}</span>
      <div class="ebody" style="min-width:0"><div data-act="mail-open" class="ehit"><div class="eh"><b>${esc(m.from)}</b><span class="age">${ago(m.date)}</span></div><div class="es">${esc(m.subject)}</div>${open ? '' : `<div class="ep">${esc(m.snippet || '')}</div>`}</div>${full}</div>
      ${open ? '<span></span>' : '<div class="eacts"><button class="go" data-act="mail-task">Make task</button><button data-act="mail-dismiss">Dismiss</button><button class="xbtn" data-act="mail-pop" title="Open">⤢</button></div>'}</div>`;
  }).join('');
  return `<section class="sheet gmail"><div class="section-h" style="padding-bottom:6px"><div class="tabs-sm"><span class="on" title="Starred in the last 15 days, not answered yet. New batch each morning.">Needs a reply${S.starred.length ? ` · ${S.starred.length}` : ''}</span></div><span class="aside">${S.google.connected && S.google.canUnstar === false ? '<a class="allow" href="/auth/google?reconnect=1">Let Dismiss unstar in Gmail →</a>' : ''}${S.google.connected ? refreshBtn('mail-refresh', S.mailBusy) : ''}${S.starred.length ? '<button class="xbtn" data-act="mail-inbox">⤢ Open inbox</button>' : ''}</span></div><div class="scroll">${rows}</div></section>`;
}

function waWhen(e) {
  if (!e.date) return 'No date';
  const d = new Date(`${e.date}T00:00:00`), tom = ymd(addDays(new Date(), 1));
  const day = e.date === todayKey() ? 'Today' : e.date === tom ? 'Tomorrow' : `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  return e.time ? `${day} · ${fmtHHMM(e.time)}` : day;
}
const waHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const initials = (n) => String(n || '?').replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function waCard(e) {
  const d = e.date ? new Date(`${e.date}T00:00:00`) : null;
  const seen = S.waSeen[e.id];
  const title = e.link ? `<a class="ti" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}<span class="ext">↗</span></a>` : `<span class="ti">${esc(e.title)}</span>`;
  const meta = [e.time && fmtHHMM(e.time), e.place, e.group].filter(Boolean).join(' · ');
  const quote = !seen && (e.quote || e.note) ? `<div class="quote">${e.quote ? `${e.sender ? `<b>${esc(e.sender)}:</b> ` : ''}${esc(e.quote)}` : esc(e.note)}</div>` : '';
  const foot = seen
    ? `<div class="foot">${seen === 'cal' ? '<span class="chip">On your calendar</span>' : ''}<span class="ok">✓ Registered</span></div>`
    : `<div class="foot">${e.deadline ? `<span class="chip red">${esc(e.deadline)}</span>` : ''}${e.link ? `<span class="chip">${esc(waHost(e.link))}</span>` : ''}<button class="act-btn" data-act="wa-action">Action ▾</button></div>`;
  return `<div class="ec${seen ? ' auto' : ''}" data-wa="${e.id}"><div class="day">${d ? `<span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b>` : '<span>TBD</span>'}</div>
    <div style="min-width:0">${title}${meta ? `<div class="mm">${esc(meta)}</div>` : ''}${quote}${foot}</div></div>`;
}
// ↻ on the email and WhatsApp panels. Neither one uses Claude: email asks Gmail again, WhatsApp asks your PC to sync now.
const refreshBtn = (act, busy) => `<button class="xbtn rf${busy ? ' busy' : ''}" data-act="${act}" title="Refresh" aria-label="Refresh"${busy ? ' disabled' : ''}>↻</button>`;
// When the PC last sent WhatsApp messages. Red once it has been quiet for 30 minutes (it syncs every 10).
const WA_STALE = 30 * 6e4;
function waStatus() {
  const t = S.wa.lastSync; if (!t) return '';
  const d = new Date(t), days = (Date.now() - t) / 864e5;
  const when = ymd(d) === todayKey() ? fmtTime(d) : days < 6 ? `${DOW[d.getDay()]} ${fmtTime(d)}` : `${MON[d.getMonth()]} ${d.getDate()}`;
  return Date.now() - t > WA_STALE ? `<span class="stale" title="Is your PC on and awake? Running whatsapp\\start-whatsapp.bat restarts the sync.">PC sync off since ${when}</span>` : `synced ${when}`;
}
async function mailRefresh() {
  S.mailBusy = true; render();
  try { S.starred = (await api('/api/starred?refresh=1')).emails; } catch (e) { toast(`Email: ${e.message}`); }
  S.mailBusy = false; render();
}
// Ask the PC to sync now, then wait for it (it checks once a minute). New messages come with the free event matcher's cards.
async function waRefresh() {
  S.waBusy = true; render();
  let ok = false;
  try {
    const { requested } = await api('/api/whatsapp/refresh', { method: 'POST' });
    for (let i = 0; i < 20 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try { const w = await api('/api/whatsapp'); ok = w.lastSync >= requested; } catch {}
    }
    if (ok) await loadWA();
  } catch {}
  S.waBusy = false; render();
  if (!ok) toast('Your PC didn’t answer. Is it on?');
}
function waHTML() {
  const { events, replies = [], groups, lastSync } = S.wa;
  const watched = groups.filter((g) => g.watch).length;
  let body;
  if (!lastSync) body = '<div class="empty">Not linked yet. Run <b>whatsapp\\start-whatsapp.bat</b> on your PC and scan the QR code.</div>';
  else if (!watched) body = '<div class="empty">Pick the groups to watch in <a href="#" data-act="wa-groups">Groups</a>. Claude checks them for events each morning.</div>';
  else {
    const open = events.filter((e) => !S.waSeen[e.id] || S.waSeen[e.id] !== 'gone');
    const top = open.slice(0, 4);
    body = `<div class="sub-h"><span>Events · next up</span>${open.length > 4 ? `<a href="#" data-act="wa-all">See all ${open.length} →</a>` : ''}</div>`;
    body += top.length ? top.map(waCard).join('') : '<div class="empty">No upcoming events from your groups.</div>';
    if (replies.length) {
      body += `<div class="sub-h wait"><span>Waiting on you · ${replies.length}</span></div>`;
      body += replies.map((r) => `<div class="rp" data-reply="${r.id}"><div class="av">${esc(initials(r.from))}</div>
        <div style="min-width:0"><div class="who">${esc(r.from || 'Someone')} <span>· ${esc(r.group || 'WhatsApp')}${r.at ? ` · ${ago(new Date(r.at).toISOString())}` : ''}</span><span class="why">${esc(r.reason || 'asked you')}</span></div><div class="snip">${esc(r.text)}</div></div>
        <div class="acts"><a href="whatsapp://" title="Open WhatsApp">Open ↗</a><button data-act="wa-replied">Replied</button><button data-act="wa-rdismiss">Dismiss</button></div></div>`).join('');
    }
  }
  const aside = lastSync ? `<a href="#" data-act="wa-groups">${watched} group${watched === 1 ? '' : 's'}</a> · ${waStatus()}${refreshBtn('wa-refresh', S.waBusy)}` : '';
  const quiet = lastSync && watched && !events.length && !replies.length;
  return `<section class="sheet wa${quiet ? ' quiet' : ''}"><div class="section-h" style="padding-bottom:0"><h3>WhatsApp</h3><span class="aside">${aside}${lastSync && watched ? '<button class="xbtn" data-act="wa-all">⤢ Open</button>' : ''}</span></div><div class="scroll">${body}</div></section>`;
}
// Full-screen WhatsApp: every event in the next 2 weeks as a full card, plus Waiting on you in full.
function waAll(filter = S.waFilter || '') {
  S.waFilter = filter;
  const evs = S.wa.events;
  const replies = S.wa.replies || [];
  const groups = [...new Set([...evs.map((e) => e.group), ...replies.map((r) => r.group)].filter(Boolean))].sort();
  if (filter && !groups.includes(filter)) S.waFilter = filter = '';
  const ev = evs.filter((e) => !filter || e.group === filter), rp = replies.filter((r) => !filter || r.group === filter);
  const watched = S.wa.groups.filter((g) => g.watch).length;
  const keepScroll = $$('#modal-card.wf .colL, #modal-card.wf .colR').map((x) => x.scrollTop);
  openModal(`<div class="bar"><h2>WhatsApp</h2><span class="aside"><a href="#" data-act="wa-groups">${watched} group${watched === 1 ? '' : 's'}</a>${S.wa.lastSync ? ` · ${waStatus()}` : ''}</span>
      ${groups.length > 1 ? `<div class="filters"><button class="${filter ? '' : 'on'}" data-f="">All</button>${groups.map((g) => `<button class="${g === filter ? 'on' : ''}" data-f="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : ''}
      <button class="x" data-close aria-label="Close">✕</button></div>
    <div class="colL"><div class="sub-h"><span>Events · next 2 weeks</span></div>${ev.length ? ev.map(waCard).join('') : '<div class="empty">No events in the next two weeks.</div>'}</div>
    <div class="colR"><div class="sub-h"><span>Waiting on you · ${rp.length}</span></div>${rp.length ? rp.map(waReplyRow).join('') : '<div class="empty">Nothing waiting on you.</div>'}</div>`, (card) => {
    $$('[data-f]', card).forEach((b) => b.onclick = () => waAll(b.dataset.f));
    const cols = $$('.colL, .colR', card); keepScroll.forEach((y, i) => { if (cols[i]) cols[i].scrollTop = y; });
  }, 'modal-card wf');
}
const waReplyRow = (r) => `<div class="rp" data-reply="${r.id}"><div class="av">${esc(initials(r.from))}</div>
  <div style="min-width:0"><div class="who">${esc(r.from || 'Someone')} <span>· ${esc(r.group || 'WhatsApp')}${r.at ? ` · ${ago(new Date(r.at).toISOString())}` : ''}</span><span class="why">${esc(r.reason || 'asked you')}</span></div><div class="snip">${esc(r.text)}</div></div>
  <div class="acts"><a href="whatsapp://" title="Open WhatsApp">Open ↗</a><button data-act="wa-replied">Replied</button><button data-act="wa-rdismiss">Dismiss</button></div></div>`;
// Re-draw whichever pop-up is open after an action inside it.
function refreshPopup() {
  if ($('#modal').classList.contains('hidden')) return;
  const c = $('#modal-card');
  if (c.classList.contains('wf')) waAll();
  else if (c.classList.contains('rd') || c.classList.contains('ib')) mailPopup();
}

// ---------- email pop-ups: one email large (reader), or the whole inbox ----------
async function mailText(id) {
  if (S.mailText[id] == null) {
    try { S.mailText[id] = (await api(`/api/starred/${id}`)).text; } catch (e) { S.mailText[id] = `Couldn't load this email (${e.message}).`; }
  }
  return S.mailText[id];
}
function mailFooter(m) {
  return `<div class="ft" data-mail="${m.id}"><button class="pri" data-act="mail-task">Make task</button><button data-act="mail-sched">Schedule reply</button><a href="${gmailLink(m)}" target="_blank" rel="noopener">Open in Gmail ↗</a><span class="sp"></span><button data-act="mail-dismiss">Dismiss</button></div>`;
}
function mailReading(m) {
  const d = new Date(m.date);
  return `<div class="hd"><h2>${esc(m.subject)}</h2><div class="who"><b>${esc(m.from)}</b><span>${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()} · ${fmtTime(d)}</span></div></div>
    <div class="bd">${S.mailText[m.id] == null ? '<span class="dim">Loading…</span>' : esc(S.mailText[m.id]) || '<span class="dim">(no text)</span>'}</div>`;
}
// S.mailPop = { mode: 'reader' | 'inbox', id, q }
function mailPopup(o) {
  if (o) S.mailPop = { ...(S.mailPop || {}), ...o };
  const P = S.mailPop; if (!P) return;
  const q = (P.q || '').toLowerCase();
  const list = P.mode === 'inbox' ? S.starred.filter((m) => !q || `${m.from} ${m.subject} ${m.snippet || ''}`.toLowerCase().includes(q)) : S.starred;
  if (!list.length && P.mode === 'reader') { closeModal(); S.mailPop = null; return; }
  if (!list.find((m) => m.id === P.id)) P.id = list[0] ? list[0].id : null;
  const i = list.findIndex((m) => m.id === P.id), m = list[i];
  if (P.mode === 'reader') {
    openModal(`<div class="top"><span class="chip">Starred</span><div class="rnav"><button data-step="-1" ${i > 0 ? '' : 'disabled'} aria-label="Previous">‹</button>${i + 1} of ${list.length}<button data-step="1" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Next">›</button><button data-act="mail-inbox" title="Open inbox">⤢</button><button data-close aria-label="Close">✕</button></div></div>
      ${mailReading(m)}${mailFooter(m)}`, wireMail, 'modal-card rd');
  } else {
    const focused = document.activeElement && document.activeElement.classList.contains('mail-q');
    openModal(`<div class="bar"><h2>Needs a reply</h2><input class="search mail-q" placeholder="Search…" value="${esc(P.q || '')}"><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="list">${list.map((x) => `<div class="li${x.id === P.id ? ' on' : ''}" data-pick="${x.id}"><div class="eh"><b>${esc(x.from)}</b><span class="age">${ago(x.date)}</span></div><div class="es">${esc(x.subject)}</div><div class="ep">${esc(x.snippet || '')}</div></div>`).join('') || '<div class="empty">No matches.</div>'}</div>
      <div class="pane">${m ? mailReading(m) + mailFooter(m) : ''}</div>`, (card) => {
      wireMail(card);
      const inp = $('.mail-q', card);
      inp.oninput = () => { S.mailPop.q = inp.value; mailPopup(); };
      if (focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      const on = $('.li.on', card); if (on) on.scrollIntoView({ block: 'nearest' });
    }, 'modal-card ib');
  }
  if (m && S.mailText[m.id] == null) mailText(m.id).then(() => { if (S.mailPop && S.mailPop.id === m.id && !$('#modal').classList.contains('hidden')) mailPopup(); });
}
function wireMail(card) {
  $$('[data-step]', card).forEach((b) => b.onclick = () => mailStep(Number(b.dataset.step)));
  $$('[data-pick]', card).forEach((b) => b.onclick = () => mailPopup({ id: b.dataset.pick }));
}
function mailStep(d) {
  const P = S.mailPop; if (!P) return;
  const q = (P.q || '').toLowerCase();
  const list = P.mode === 'inbox' ? S.starred.filter((m) => !q || `${m.from} ${m.subject} ${m.snippet || ''}`.toLowerCase().includes(q)) : S.starred;
  const i = list.findIndex((m) => m.id === P.id), n = list[i + d];
  if (n) mailPopup({ id: n.id });
}
async function waTask(e, act) {
  let taskId = null;
  if (act === 'wa-task') {
    const desc = [e.place, e.note, e.link, e.group && `From WhatsApp: ${e.group}`].filter(Boolean).join('\n');
    const r = await api('/api/ops', { method: 'POST', body: [{ op: 'add', content: `Go to ${e.title}`, due: e.date || undefined, time: e.time || undefined, description: desc, source: 'whatsapp' }] });
    taskId = r.results[0] && r.results[0].added && r.results[0].added.id;
  }
  await api(`/api/whatsapp/events/${e.id}`, { method: 'PATCH', body: { status: act === 'wa-task' ? 'added' : 'dismissed', taskId } });
  S.wa.events = S.wa.events.filter((x) => x.id !== e.id);
  await refresh(false); refreshPopup();
  toast(act === 'wa-task' ? 'Added to Inbox' : 'Dismissed');
}
// Registered: the card shows a tick for a moment, then drops off.
async function waRegistered(id) {
  await api(`/api/whatsapp/events/${id}`, { method: 'PATCH', body: { status: 'registered' } });
  S.waSeen[id] = 'you'; render(); refreshPopup();
  setTimeout(() => { if (!S.wa) return; S.wa.events = S.wa.events.filter((x) => x.id !== id); delete S.waSeen[id]; if (S.view === 'tasks' && S.nav === 'today') render(); refreshPopup(); }, 2500);
}
function waRefreshModal() { refreshPopup(); }
function waGroups() {
  const list = S.wa.groups;
  const body = list.length ? list.map((g) => `<label class="wg"><input type="checkbox" data-jid="${esc(g.jid)}" ${g.watch ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('') : '<div class="empty">No groups yet. They show up a few minutes after the PC sync starts.</div>';
  openModal(`<h2>WhatsApp groups</h2><div class="modal-sub">Only ticked groups are copied to the cloud and checked for events. Direct chats never are.</div><input class="ask-input wg-filter" placeholder="Filter"><div class="wg-list">${body}</div><div class="modal-actions"><span></span><div class="right"><button class="btn primary" data-close>Done</button></div></div>`, (card) => {
    $('.wg-filter', card).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.wg', card).forEach((l) => l.classList.toggle('hidden', !l.textContent.toLowerCase().includes(q))); };
    $$('input[data-jid]', card).forEach((cb) => cb.onchange = async () => {
      try { await api('/api/whatsapp/groups', { method: 'PATCH', body: { jid: cb.dataset.jid, watch: cb.checked } }); const g = S.wa.groups.find((x) => x.jid === cb.dataset.jid); if (g) g.watch = cb.checked; render(); }
      catch (e) { cb.checked = !cb.checked; toast(e.message); }
    });
  }, 'modal-card narrow');
}


// ----- Inbox: one list. Capture bar on top, Starred and dated tasks on the left, Unsorted and Later on the right -----
// Unsorted = no date (and not starred or parked as Someday). A date is what moves something out.
function nbRow(t, o = {}) {
  const due = dueLabel(t), p = proj(t.projectId);
  const bits = [];
  if (due && due.late) bits.push(`<span class="late">${esc(due.txt)}</span>`);
  if (t.event) bits.push(`<button class="nb-sch" data-act="schedule">${ICON.cal}${fmtRange(new Date(t.event.start), new Date(t.event.end))}${o.day ? ` · ${esc(dueLabel({ due: { date: t.due.date } }).txt)}` : ''}</button>`);
  else if (t.due && t.due.time) bits.push(`<button class="nb-sch" data-act="schedule">${ICON.cal}${o.day ? `${esc(dueLabel({ due: { date: t.due.date } }).txt)} ` : ''}${fmtHHMM(t.due.time)}</button>`);
  else if (o.day && due && !due.late && !due.today) bits.push(`<span>${esc(due.txt)}</span>`);
  if (t.recurring) bits.push(`<span>↻</span>`);
  if (p.id !== 'inbox') bits.push(`<span class="nb-tag"><i style="background:${ink(p)}"></i>${esc(p.name)}</span>`);
  return `<div class="nb-row${t.now ? ' st' : ''}" data-task="${t.id}"><button class="ck${t.priority === 1 ? ' p1' : ''}" data-act="complete" aria-label="Complete"></button>
    <div class="nb-t" data-act="edit">${t.now ? `<span class="nb-mk">${esc(t.content)}</span>` : esc(t.content)}</div>
    <div class="nb-m">${bits.join('')}</div><button class="nb-star${t.now ? ' on' : ''}" data-act="now" title="${t.now ? 'Unstar' : 'Star'}">${ICON.star}</button></div>`;
}
function laterBuckets(list) {
  const now = new Date(), out = new Map();
  for (const t of list) {
    const d = new Date(`${t.due.date}T00:00:00`);
    const months = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
    const k = months <= 0 ? `Rest of ${MONTHS[now.getMonth()]}` : months < 4 ? MONTHS[d.getMonth()] : 'Further out';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(t);
  }
  return out;
}
function renderInbox() {
  const old = $('#nb-input'), keep = old ? { v: old.value, focus: document.activeElement === old, at: old.selectionStart } : null;
  const today = todayKey(), tom = ymd(addDays(new Date(), 1)), wk = ymd(addDays(new Date(), 7));
  const open = openTasks(), dated = sortTasks(open.filter((t) => t.due && !t.now));
  const groups = [
    ['Starred', top3(), { day: true }],
    ['Today', dated.filter((t) => t.due.date <= today), {}],
    ['Tomorrow', dated.filter((t) => t.due.date === tom), {}],
    ['This week', dated.filter((t) => t.due.date > tom && t.due.date <= wk), { day: true }],
  ];
  const cnt = (n) => `<span class="n">${n}</span>`;
  let left = '';
  for (const [name, ts, o] of groups) if (ts.length) left += `<div class="nb-gh"><span>${name}</span>${cnt(ts.length)}<span class="ln"></span></div>${ts.map((t) => nbRow(t, o)).join('')}`;
  if (!left) left = '<div class="empty">Nothing dated this week.</div>';

  const uns = unsorted(), withSg = uns.filter((t) => t.suggest);
  const sgChips = (t) => {
    const g = t.suggest, p = g.projectId && S.projects.find((x) => x.id === g.projectId);
    const sec = p && g.sectionId && p.sections.find((x) => x.id === g.sectionId);
    return `${g.content && g.content !== t.content ? `<div class="nb-rn">→ ${esc(g.content)}</div>` : ''}<div class="nb-ua">${p ? `<span class="nb-sg"><i style="background:${ink(p)}"></i>${esc(p.name)}${sec ? ` / ${esc(sec.name)}` : ''}</span>` : ''}${g.due ? `<span class="nb-sg">${esc(dueLabel({ due: { date: g.due, time: g.time || null } }).txt)}</span>` : ''}
      <button class="nb-ok" data-act="sg-accept" title="Accept">✓</button><button class="nb-no" data-act="sg-dismiss" title="Dismiss suggestion">✕</button></div>`;
  };
  const quick = '<div class="nb-ua nb-q"><button data-act="nb-when" data-v="today">Today</button><button data-act="nb-when" data-v="tom">Tomorrow</button><button data-act="nb-when" data-v="next">Next week</button><button data-act="nb-when" data-v="pick">Pick…</button><button data-act="nb-when" data-v="someday">Someday</button></div>';
  const tray = uns.length ? uns.map((t) => `<div class="nb-uc" data-task="${t.id}"><div class="nb-ut"><span data-act="edit">${esc(t.content)}</span><span class="age">${ago(t.createdAt)}</span></div>${t.suggest ? sgChips(t) : quick}</div>`).join('') : '<div class="empty">All sorted.</div>';

  const later = sortTasks(open.filter((t) => t.due && !t.now && t.due.date > wk));
  const buckets = [...laterBuckets(later)];
  const someday = open.filter((t) => !t.due && !t.now && t.someday).sort((a, b) => a.content.localeCompare(b.content));
  if (someday.length) buckets.push(['Someday', someday]);
  const laterH = buckets.length ? buckets.map(([k, ts]) => `<button class="nb-lr" data-act="nb-later" data-k="${esc(k)}"><span>${esc(k)}</span>${cnt(ts.length)}<span class="chev">${S.laterOpen === k ? '⌄' : '›'}</span></button>${S.laterOpen === k ? `<div class="nb-lo">${ts.map((t) => nbRow(t, { day: true })).join('')}</div>` : ''}`).join('') : '<div class="empty">Nothing further out.</div>';

  $('#view').innerHTML = `<div class="nb">
    <form class="nb-cap" id="nb-cap" autocomplete="off"><span class="plus">+</span><input id="nb-input" placeholder="Add anything. fri 2pm, #project and @star work too" aria-label="Add a task"><div class="nb-chips" id="nb-chips"></div><button type="button" class="qi" data-act="cheats" title="How to write a task">?</button></form>
    <div class="nb-grid">
      <section class="nb-panel nb-list"><div class="scroll">${left}</div></section>
      <aside class="nb-side">
        <section class="nb-panel nb-tray"><div class="nb-ph"><h3>Unsorted</h3>${cnt(uns.length)}${withSg.length > 1 ? '<button class="btn dk" data-act="sg-accept-all">Accept all</button>' : ''}</div><div class="scroll">${tray}</div></section>
        <section class="nb-panel nb-later"><div class="nb-ph"><h3>Later</h3>${cnt(later.length + someday.length)}</div><div class="scroll">${laterH}</div></section>
      </aside>
    </div></div>`;
  const inp = $('#nb-input');
  wireAdd(inp, $('#nb-chips'));
  if (keep) { inp.value = keep.v; if (keep.focus) { inp.focus(); try { inp.setSelectionRange(keep.at, keep.at); } catch {} } if (keep.v) updateChips(inp); }
}
async function acceptSuggestion(id, quiet) {
  const t = S.tasks.find((x) => x.id === id); if (!t || !t.suggest) return;
  const g = t.suggest, body = { suggest: null };
  if (g.content) body.content = g.content;
  if (g.projectId) { body.projectId = g.projectId; body.sectionId = g.sectionId || null; }
  if (g.due) body.due = { date: g.due, time: g.time || null };
  await api(`/api/tasks/${id}`, { method: 'PATCH', body });
  if (!quiet) { toast(g.due ? `Moved to ${dueLabel({ due: body.due }).txt}` : 'Filed'); await refresh(false); }
}
async function setWhen(id, v) {
  if (v === 'pick') return openPicker(id);
  if (v === 'someday') { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { someday: true } }); toast('Parked in Someday'); return refresh(false); }
  const d = v === 'today' ? new Date() : v === 'tom' ? addDays(new Date(), 1) : addDays(mondayOf(new Date()), 7);
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: { due: { date: ymd(d), time: null } } });
  toast(`Moved to ${dueLabel({ due: { date: ymd(d) } }).txt}`);
  await refresh(false);
}

function renderSimpleList(title, sub, list, o = {}) {
  $('#view').innerHTML = `<div class="head"><h1 class="title">${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
    <div class="body single"><section class="sheet"><div class="scroll">${list.length ? list.map((t) => row(t, { project: o.project, section: o.section, starTag: true })).join('') : '<div class="empty">Empty. Nice.</div>'}</div></section></div>`;
}

function renderUpcoming() {
  const list = sortTasks(openTasks().filter((t) => t.due && t.due.date > todayKey()));
  const groups = {};
  for (const t of list) (groups[t.due.date] ||= []).push(t);
  let h = '';
  for (const [k, ts] of Object.entries(groups)) {
    const d = new Date(`${k}T00:00:00`);
    h += `<div class="psec" style="cursor:default"><span class="caret"></span><h3>${DAYS[d.getDay()]} <span style="color:var(--ink-3);font-style:italic">${MON[d.getMonth()]} ${d.getDate()}</span></h3><span class="n">${ts.length}</span></div>${ts.map((t) => row(t, { project: true, starTag: true })).join('')}`;
  }
  const undated = sortTasks(openTasks().filter((t) => !t.due && t.projectId !== 'inbox')).length;
  $('#view').innerHTML = `<div class="head"><h1 class="title">Upcoming</h1><div class="sub">${list.length} dated tasks ahead${undated ? ` · ${undated} more with no date live in their projects` : ''}</div></div>
    <div class="body single"><section class="sheet"><div class="scroll plist">${h || '<div class="empty">Nothing dated ahead.</div>'}</div></section></div>`;
}

// ----- project screen -----
function renderProject(pid) {
  const p = S.projects.find((x) => x.id === pid);
  if (!p) { S.nav = 'today'; return renderToday(); }
  const ts = openTasks().filter((t) => t.projectId === p.id);
  const secs = secList(p);
  const layout = p.boardLayout || 'wrap';
  const loose = sortTasks(ts.filter((t) => !t.sectionId || !secs.find((s) => s.id === t.sectionId)));
  const cols = [...(loose.length ? [{ id: '', name: 'No section', tasks: loose }] : []), ...secs.map((s) => ({ id: s.id, name: s.name, tasks: sortTasks(ts.filter((t) => t.sectionId === s.id)) }))];
  const board = S.projView === 'board';
  const head = `<div class="head"><div><div class="kicker"><span class="tick" style="background:${ink(p)};height:12px"></span>${p.archived ? 'Archived project' : 'Project'}</div><h1 class="title">${esc(p.name)}</h1></div>
    <div class="right">${p.archived ? '<button class="btn" data-act="proj-restore">Restore</button>' : ''}<button class="btn ghost stats-btn" data-act="proj-stats">Stats</button>
      ${board ? `<div class="switch sm"><button data-act="layout" data-v="wrap" class="${layout === 'wrap' ? 'on' : ''}">Wrap rows</button><button data-act="layout" data-v="scroll" class="${layout === 'scroll' ? 'on' : ''}">Scroll sideways</button></div>` : ''}
      ${p.id === 'inbox' ? '' : '<button class="btn primary" data-act="add-section">+ Add section</button>'}
      <div class="switch"><button data-act="projview" data-v="list" class="${S.projView === 'list' ? 'on' : ''}">List</button><button data-act="projview" data-v="board" class="${board ? 'on' : ''}">Board</button></div>
      <button class="btn ghost more-btn" data-act="proj-menu" title="Project options">⋯</button></div></div>`;
  const cnt = (n) => (n ? `<span class="n">${n}</span>` : '');
  const secMore = (c) => (c.id ? `<button class="more" data-act="sec-menu" data-sec="${c.id}" title="Section options">⋯</button>` : '');
  let body;
  if (S.projView === 'board') {
    body = `<div class="board ${layout}">` + cols.map((c) => {
      if (layout === 'scroll' && c.id && !c.tasks.length && !S.openRails[c.id]) return `<div class="col slim" data-col="${c.id}" data-act="open-rail" title="${esc(c.name)}"><h4 draggable="true" data-secdrag="${c.id}">${esc(c.name)}</h4><span class="rail-plus">+</span></div>`;
      return `<div class="col" data-col="${c.id}"><h4 ${c.id ? `draggable="true" data-secdrag="${c.id}"` : ''}>${c.id ? '<span class="sgrip">⋮⋮</span>' : ''}<span class="nm">${esc(c.name)}</span>${cnt(c.tasks.length)}${secMore(c)}</h4>
      ${c.tasks.map((t) => `<div class="card" draggable="true" data-task="${t.id}"><button class="ck${t.priority === 1 ? ' p1' : ''}" data-act="complete" aria-label="Complete"></button><div style="min-width:0"><div class="t" data-act="edit">${hlTitle(t)}</div>${(() => { const mb = metaBits(t, { starTag: false }); const cal = t.event ? `<button class="when cal" data-act="schedule" style="font-size:11px">${DOW[new Date(t.event.start).getDay()]} ${fmtTime(new Date(t.event.start))}</button>` : ''; return mb || cal ? `<div class="m">${cal}${mb}</div>` : ''; })()}
        <div class="cacts"><button class="act ico${t.now ? ' on' : ''}" data-act="now" title="Star">${ICON.star}</button>${t.event ? '' : `<button class="act ico" data-act="schedule" title="Schedule">${ICON.cal}</button>`}<button class="act ico" data-act="edit" title="Edit">${ICON.edit}</button></div></div></div>`).join('')}
      <button class="add" data-act="inline-add" data-sec="${c.id}">+ Add task</button></div>`; }).join('') + '</div>';
  } else {
    let h = '';
    for (const c of cols) {
      const key = `${p.id}:${c.id}`, closed = S.collapsed[key];
      h += `<div class="psec" data-act="collapse" data-key="${key}" ${c.id ? `data-secrow="${c.id}"` : ''}><span class="sgrip" ${c.id ? `draggable="true" data-secdrag="${c.id}"` : 'style="visibility:hidden"'}>⋮⋮</span><span class="caret">${closed ? '▸' : '▾'}</span><h3>${esc(c.name)}</h3>${cnt(c.tasks.length)}${secMore(c)}</div>`;
      if (!closed) h += c.tasks.map((t) => row(t, { starTag: true, hl: true })).join('') + `<button class="addrow" data-act="inline-add" data-sec="${c.id}">+ Add task</button>`;
    }
    const doneList = S.tasks.filter((t) => t.projectId === p.id && t.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    h += `<div class="psec muted" data-act="toggle-done"><span class="caret">${S.showDone[p.id] ? '▾' : '▸'}</span><h3>Completed</h3>${cnt(doneList.length)}<span class="aside">${S.showDone[p.id] ? 'hide' : 'show'}</span></div>`;
    if (S.showDone[p.id]) h += doneList.slice(0, 50).map((t) => row(t, { drag: false, doneAt: true })).join('');
    body = `<div class="scroll plist-wrap" style="flex:1"><section class="sheet plist">${h}</section></div>`;
  }
  $('#view').innerHTML = head + body;
  $('#view').dataset.project = p.id;
}

// ----- Calendar tab -----
function layoutDay(evs) {
  const items = evs.map((e) => ({ e, s: new Date(e.start).getTime(), en: new Date(e.end).getTime() })).sort((a, b) => a.s - b.s || b.en - a.en);
  let cluster = [], clusterEnd = 0; const out = [];
  const flush = () => { const lanes = []; for (const it of cluster) { let i = lanes.findIndex((end) => end <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.en; it.lane = i; } cluster.forEach((it) => { it.lanes = lanes.length; out.push(it); }); cluster = []; };
  for (const it of items) { if (cluster.length && it.s >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en); }
  flush();
  return out;
}

function renderCalendar() {
  const ws = S.weekStart, we = addDays(ws, 6), today = todayKey();
  const meetMin = S.events.filter((e) => !e.allDay && !e.taskId).reduce((m, e) => m + (new Date(e.end) - new Date(e.start)) / 6e4, 0);
  const title = ws.getMonth() === we.getMonth() ? `${MONTHS[ws.getMonth()]} <em>${ws.getDate()} – ${we.getDate()}</em>` : `${MON[ws.getMonth()]} ${ws.getDate()} <em>– ${MON[we.getMonth()]} ${we.getDate()}</em>`;
  let head = '<div></div>', ad = '<div class="lbl">all day</div>', grid = '<div class="hrs">';
  for (let h = START_H; h < END_H; h++) grid += `<div>${h === START_H ? '' : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`}</div>`;
  grid += '</div>';
  const byId = Object.fromEntries(S.tasks.map((t) => [t.id, t]));
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), key = ymd(d), wkend = d.getDay() % 6 === 0;
    head += `<div class="${key === today ? 'today' : ''}"><div class="d">${DOW[d.getDay()]}</div><div class="n">${d.getDate()}</div></div>`;
    ad += `<div>${S.events.filter((e) => e.allDay && e.start <= key && e.end > key).map((e) => `<div class="ad" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}</div>`;
    let col = `<div class="dcol${wkend ? ' we' : ''}" data-date="${key}" style="height:${(END_H - START_H) * HOUR_PX}px">`;
    for (const it of layoutDay(S.events.filter((e) => !e.allDay && ymd(new Date(e.start)) === key))) {
      const e = it.e, s = new Date(e.start), en = new Date(e.end);
      const top = (s.getHours() + s.getMinutes() / 60 - START_H) * HOUR_PX, h = Math.max(18, (en - s) / 36e5 * HOUR_PX - 2);
      const w = 100 / it.lanes, style = `top:${top}px;height:${h}px;left:calc(${it.lane * w}% + 4px);width:calc(${w}% - 8px);`;
      const t = e.taskId && byId[e.taskId];
      const inner = (name) => `<div class="tt">${esc(name)}</div>${h > 32 ? `<div class="tm">${fmtRange(s, en)}</div>` : ''}`;
      if (t) col += `<div class="ev tk${t.completedAt ? ' done' : ''}" draggable="true" data-ev="${esc(e.id)}" data-task="${t.id}" title="${esc(t.content)} · double-click to edit" style="${style}--c:${ink(proj(t.projectId))}">${inner(t.content)}</div>`;
      else col += `<div class="ev meet${e.editable ? ' editable' : ''}" ${e.editable ? 'draggable="true"' : ''} data-ev="${esc(e.id)}" title="${esc(e.title)}${e.location ? ` · ${esc(e.location)}` : ''} (${esc(e.calendar || '')})" style="${style}">${inner(e.title)}</div>`;
    }
    if (key === today) { const n = new Date(); col += `<div class="nowline" style="top:${(n.getHours() + n.getMinutes() / 60 - START_H) * HOUR_PX}px"></div>`; }
    grid += col + '</div>';
  }
  const prevScroll = $('#cal-scroll') ? $('#cal-scroll').scrollTop : null;
  $('#view').innerHTML = `<div class="head"><h1 class="title">${title}</h1><div class="sub">${meetMin ? `<b>${Math.floor(meetMin / 60)}h${meetMin % 60 ? ` ${Math.round(meetMin % 60)}m` : ''}</b> of meetings this week` : ''}</div>
    <div class="right calnav"><button class="btn" data-act="wk" data-d="-7">‹</button><button class="btn" data-act="wk" data-d="0">This week</button><button class="btn" data-act="wk" data-d="7">›</button></div></div>
    <div class="calbox"><div class="cal-h">${head}</div>${S.events.some((e) => e.allDay) ? `<div class="cal-ad">${ad}</div>` : ''}<div class="cal-scroll" id="cal-scroll"><div class="cal-g">${grid}</div></div></div>`;
  $('#cal-scroll').scrollTop = prevScroll ?? (Math.max(START_H, new Date().getHours() - 2) - START_H) * HOUR_PX;
}

// ---------- actions ----------
async function completeTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  await api(`/api/tasks/${id}/complete`, { method: 'POST' });
  toast(t.recurring ? `Done. Next one: every ${t.recurring}` : 'Done');
  await refresh(false);
}
async function toggleNow(id) {
  const t = S.tasks.find((x) => x.id === id);
  try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { now: !t.now } }); await refresh(false); }
  catch (e) { toast(e.message); }
}
function openModal(html, wire, cls = 'modal-card') {
  const c = $('#modal-card'); c.className = cls; c.innerHTML = html; $('#modal').classList.remove('hidden');
  $$('[data-close]', c).forEach((b) => b.onclick = closeModal);
  wire && wire(c);
}
function closeModal() { $('#modal').classList.add('hidden'); }

function editTask(id) {
  const t = S.tasks.find((x) => x.id === id); if (!t) return;
  const projOpts = projList().map((p) => `<option value="${p.id}" ${p.id === t.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const secOpts = (pid) => `<option value="">No section</option>${secList(proj(pid)).map((s) => `<option value="${s.id}" ${s.id === t.sectionId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
  openModal(`<h2>Edit task</h2>
    <div class="form-grid">
      <label class="full">Task<input name="content" value="${esc(t.content)}"></label>
      <label>Project<select name="projectId">${projOpts}</select></label>
      <label>Section<select name="sectionId">${secOpts(t.projectId)}</select></label>
      <label>Due date<input type="date" name="date" value="${t.due ? t.due.date : ''}"></label>
      <label>Time<input type="time" name="time" value="${t.due && t.due.time ? t.due.time : ''}"></label>
      ${t.event ? '<div class="mvline full hidden"></div>' : ''}
      <label>Minutes to block<input type="number" min="5" step="5" name="duration" value="${t.duration || ''}"></label>
      <label>Priority<select name="priority">${[1, 2, 3, 4].map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p === 4 ? 'None' : `p${p}`}</option>`).join('')}</select></label>
      <label>Repeats<select name="recurring">${['', 'day', 'weekday', 'week', 'month', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((r) => `<option value="${r}" ${(t.recurring || '') === r ? 'selected' : ''}>${r ? `every ${r}` : 'No'}</option>`).join('')}</select></label>
      <label>Starred<select name="now"><option value="0">No</option><option value="1" ${t.now ? 'selected' : ''}>Yes</option></select></label>
      <label class="full">Notes<textarea name="description">${esc(t.description)}</textarea></label>
    </div>
    <div class="modal-actions"><button class="btn danger" data-act="m-delete">Delete task</button>
      <div class="right">${t.event ? '<button class="btn" data-act="m-unschedule">Remove from calendar</button>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-act="m-save">Save</button></div></div>`, (card) => {
    const f = (n) => card.querySelector(`[name=${n}]`);
    f('projectId').onchange = () => { f('sectionId').innerHTML = secOpts(f('projectId').value); };
    const mv = $('.mvline', card);
    const newRange = () => {
      if (!t.event || !f('date').value || !f('time').value) return null;
      const [y, mo, d] = f('date').value.split('-').map(Number), [h, mi] = f('time').value.split(':').map(Number);
      const s0 = new Date(y, mo - 1, d, h, mi), oldLen = Math.round((new Date(t.event.end) - new Date(t.event.start)) / 6e4);
      return [s0, new Date(s0.getTime() + (Number(f('duration').value) || oldLen) * 6e4)];
    };
    const showMove = () => {
      if (!mv) return;
      const os = new Date(t.event.start), oe = new Date(t.event.end), nr = newRange();
      const same = nr && nr[0].getTime() === os.getTime() && nr[1].getTime() === oe.getTime();
      mv.classList.toggle('hidden', same);
      mv.innerHTML = nr ? `<s>${esc(dayWord(os))} ${fmtRange(os, oe)}</s><span>→</span><b>${esc(dayWord(nr[0]))} ${fmtRange(nr[0], nr[1])}</b>` : `<s>${esc(dayWord(os))} ${fmtRange(os, oe)}</s><span>→</span><b>Off the calendar</b>`;
    };
    ['date', 'time', 'duration'].forEach((n) => f(n).addEventListener('input', showMove));
    card.querySelector('[data-act=m-save]').onclick = async () => {
      const body = {
        content: f('content').value.trim(), projectId: f('projectId').value, sectionId: f('sectionId').value || null,
        due: f('date').value ? { date: f('date').value, time: f('time').value || null } : null,
        duration: f('duration').value ? Number(f('duration').value) : null, priority: Number(f('priority').value),
        recurring: f('recurring').value || null, description: f('description').value,
      };
      if (!body.content) return toast('Give the task a name');
      const wantNow = f('now').value === '1';
      try {
        await api(`/api/tasks/${id}`, { method: 'PATCH', body });
        if (wantNow !== Boolean(t.now)) await api(`/api/tasks/${id}`, { method: 'PATCH', body: { now: wantNow } });
      } catch (e) { return toast(e.message); }
      const nr = newRange(), moved = t.event && nr && (nr[0].getTime() !== new Date(t.event.start).getTime() || nr[1].getTime() !== new Date(t.event.end).getTime());
      const booked = !t.event && body.due && body.due.time;
      closeModal(); await refresh(Boolean(t.event || booked));
      if (moved) toast(`Moved to ${fmtRange(nr[0], nr[1])}`);
      else if (booked) toast(`On your calendar ${dueLabel(body).txt}`);
    };
    card.querySelector('[data-act=m-delete]').onclick = async () => {
      if (!(await askChoice('Delete this task?', t.content, [{ label: 'Delete', value: true, cls: 'accent' }]))) return;
      await api(`/api/tasks/${id}`, { method: 'DELETE' }); await refresh(); toast('Deleted');
    };
    const un = card.querySelector('[data-act=m-unschedule]');
    if (un) un.onclick = async () => { await api(`/api/tasks/${id}/schedule`, { method: 'DELETE' }); closeModal(); toast('Removed from calendar'); await refresh(); };
    f('content').focus();
  });
}

async function openPicker(taskId) {
  if (!S.google.connected) return toast('Connect Google first');
  const t = S.tasks.find((x) => x.id === taskId);
  const booked = t.event ? { s: new Date(t.event.start), e: new Date(t.event.end) } : null;
  let len = booked ? Math.round((booked.e - booked.s) / 6e4) : (t.duration || S.settings.defaultLength || 30);
  let off = 0; // days ahead of today shown in the slot grid (arrows move 5 at a time)
  const save = async (start, end, msg) => {
    const clash = S.events.find((ev) => !ev.allDay && !ev.taskId && new Date(ev.start) < end && new Date(ev.end) > start);
    if (clash && !(await askChoice(`Overlaps “${clash.title}”`, fmtRange(new Date(clash.start), new Date(clash.end)), [{ label: 'Book it anyway', value: true, cls: 'primary' }]))) return;
    await api(`/api/tasks/${taskId}/schedule`, { method: 'POST', body: { start: start.toISOString(), end: end.toISOString() } });
    closeModal(); toast(msg || `Blocked ${fmtRange(start, end)}`);
    if (start < S.weekStart || start >= addDays(S.weekStart, 7)) S.weekStart = mondayOf(start);
    await refresh();
  };
  const draw = async () => {
    const lens = [...new Set([15, 30, 45, 60, 90, len])].sort((x, y) => x - y);
    const segs = lens.map((l) => `<button class="seg-btn ${l === len ? 'on' : ''}" data-len="${l}">${lenLabel(l)}</button>`).join('');
    const top = booked
      ? `<div class="booked"><div class="bk-day">${esc(dayWord(booked.s))}</div>
          <div class="bk-main"><div class="bk-when"><b>${fmtRange(booked.s, booked.e)}</b><span>${lenLabel(Math.round((booked.e - booked.s) / 6e4))}</span></div>
            <div class="bk-ctl"><label class="bk-start">Start<input type="time" step="300" value="${hhmmOf(booked.s)}"></label><div class="len-segs">${segs}</div></div></div>
          <button class="btn" data-act="m-unsched">Remove from calendar</button></div>
        <div class="or-line"><span>Or pick a new time</span></div><div class="len-row nav-only"><div class="wk-nav"></div></div>`
      : `<div class="len-row">${segs}<div class="wk-nav"></div></div>`;
    openModal(`<h2>${booked ? 'Scheduled' : 'Find a time'}</h2><div class="modal-sub">${esc(t.content)}</div>${top}
      <div id="slots"><div class="empty" style="padding:16px 0">Finding free time…</div></div>
      <div class="modal-actions"><span></span><button class="btn ghost" data-close>Cancel</button></div>`, (card) => {
      $$('[data-len]', card).forEach((b) => b.onclick = async () => {
        len = Number(b.dataset.len);
        if (booked) return save(booked.s, new Date(booked.s.getTime() + len * 6e4), `Now ${fmtRange(booked.s, new Date(booked.s.getTime() + len * 6e4))}`);
        draw();
      });
      const st = $('.bk-start input', card);
      if (st) st.onchange = () => {
        if (!st.value) return;
        const [h, m] = st.value.split(':').map(Number); const s0 = new Date(booked.s); s0.setHours(h, m, 0, 0);
        const e0 = new Date(s0.getTime() + len * 6e4); save(s0, e0, `Moved to ${fmtRange(s0, e0)}`);
      };
      const un = $('[data-act=m-unsched]', card);
      if (un) un.onclick = async (e) => { e.stopPropagation(); await api(`/api/tasks/${taskId}/schedule`, { method: 'DELETE' }); closeModal(); toast('Removed from calendar'); await refresh(); };
    }, 'modal-card picker');
    await slots();
  };
  const slots = async () => {
    const a = addDays(new Date(), off), b = addDays(a, 4);
    const nav = $('#modal-card .wk-nav');
    if (nav) {
      nav.innerHTML = `${off ? '<button class="txt" data-off="0">Today</button>' : ''}<button data-off="${Math.max(0, off - 5)}" ${off ? '' : 'disabled'} aria-label="Previous 5 days">‹</button><b>${MON[a.getMonth()]} ${a.getDate()} – ${MON[b.getMonth()]} ${b.getDate()}</b><button data-off="${off + 5}" aria-label="Next 5 days">›</button>`;
      $$('[data-off]', nav).forEach((x) => x.onclick = () => { off = Number(x.dataset.off); $('#slots').innerHTML = '<div class="empty" style="padding:16px 0">Finding free time…</div>'; slots(); });
    }
    const r = await api(`/api/slots?length=${len}&days=5&offset=${off}`);
    const group = (h) => (h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening');
    $('#slots').innerHTML = `<div class="slot-grid">${r.days.map((d) => {
      const dt = new Date(`${d.date}T00:00:00`); let last = '', col = '';
      for (const sl of d.slots) { const g = group(new Date(sl.start).getHours()); if (g !== last) { col += `<div class="grp">${g}</div>`; last = g; } col += `<button class="slot" data-start="${sl.start}" data-end="${sl.end}">${fmtTime(new Date(sl.start))}</button>`; }
      return `<div><div class="slot-day">${d.date === todayKey() ? 'Today' : DOW[dt.getDay()]}<small>${MON[dt.getMonth()]} ${dt.getDate()}</small></div><div class="slot-col">${col || '<div class="slot-none">No free time</div>'}</div></div>`;
    }).join('')}</div>`;
    $$('#slots .slot').forEach((b) => b.onclick = () => save(new Date(b.dataset.start), new Date(b.dataset.end)));
  };
  draw();
}

function sectionMenu(btn) {
  const p = proj($('#view').dataset.project), secs = secList(p), sid = btn.dataset.sec, sec = secs.find((x) => x.id === sid), i = secs.indexOf(sec);
  const board = S.projView === 'board';
  const move = (to) => { const ids = secs.map((x) => x.id).filter((x) => x !== sid); ids.splice(to, 0, sid); return api(`/api/projects/${p.id}/sections/order`, { method: 'POST', body: { ids } }).then(() => refresh(false)); };
  const items = [
    { label: 'Rename', run: async () => { const n = await askText('Rename section', sec.name); if (n) { await api(`/api/projects/${p.id}/sections/${sid}`, { method: 'PATCH', body: { name: n } }); await refresh(false); } } },
    ...(i > 0 ? [{ label: 'Move to first', run: () => move(0) }, { label: board ? 'Move left' : 'Move up', run: () => move(i - 1) }] : []),
    ...(i < secs.length - 1 ? [{ label: board ? 'Move right' : 'Move down', run: () => move(i + 1) }] : []),
    { sep: true },
    { label: 'Delete section', danger: true, run: () => deleteSection(p, sec) },
  ];
  openMenu(btn, items);
}
async function deleteSection(p, sec) {
  const n = openTasks().filter((t) => t.projectId === p.id && t.sectionId === sec.id).length;
  let mode = 'move';
  if (n) {
    mode = await askChoice(`Delete “${sec.name}”?`, `${n} open task${n > 1 ? 's' : ''} in it.`, [{ label: 'Keep tasks, no section', value: 'move' }, { label: 'Delete tasks too', value: 'delete', cls: 'accent' }]);
    if (!mode) return;
  }
  await api(`/api/projects/${p.id}/sections/${sec.id}?tasks=${mode}`, { method: 'DELETE' });
  await refresh(false);
  toast(`Deleted ${sec.name}`);
}
function projectMenu(btn, pid) {
  const p = proj(pid || $('#view').dataset.project);
  if (p.id === 'inbox') return;
  const list = projList().filter((x) => x.id !== 'inbox'), i = list.indexOf(p);
  const move = (to) => { const ids = list.map((x) => x.id).filter((x) => x !== p.id); ids.splice(to, 0, p.id); return api('/api/projects/order', { method: 'POST', body: { ids } }).then(() => refresh(false)); };
  const items = [
    { label: 'Rename project', run: async () => { const n = await askText('Rename project', p.name); if (n) { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: n } }); await refresh(false); } } },
    { label: 'Change color', run: () => pickColor(p) },
    ...(p.archived ? [] : [{ label: 'Add section', run: () => addSection(p.id) }]),
    ...(!p.archived && i > 0 ? [{ label: 'Move up', run: () => move(i - 1) }] : []),
    ...(!p.archived && i >= 0 && i < list.length - 1 ? [{ label: 'Move down', run: () => move(i + 1) }] : []),
    { sep: true },
    { label: p.archived ? 'Restore project' : 'Archive project', run: async () => { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { archived: !p.archived } }); await refresh(false); toast(p.archived ? `Restored ${p.name}` : `Archived ${p.name}`); } },
    { label: 'Delete project…', danger: true, run: () => deleteProject(p) },
  ];
  openMenu(btn, items, { alignLeft: !pid ? false : true });
}
async function deleteProject(p) {
  const n = openTasks().filter((t) => t.projectId === p.id).length;
  const mode = await askChoice(`Delete “${p.name}”?`, n ? `${n} open task${n > 1 ? 's' : ''} in it.` : '', n
    ? [{ label: 'Move tasks to Inbox', value: 'move' }, { label: 'Delete tasks too', value: 'delete', cls: 'accent' }]
    : [{ label: 'Delete', value: 'delete', cls: 'accent' }]);
  if (!mode) return;
  await api(`/api/projects/${p.id}?tasks=${mode}`, { method: 'DELETE' });
  S.nav = 'today'; await refresh(false);
  toast(`Deleted ${p.name}`);
}
const PALETTE = ['#7a7f87', '#e8743b', '#19a979', '#13447c', '#d6417e', '#1f8a3b', '#5c3fb4', '#e05a5a', '#2a8fbd', '#b38600'];
function pickColor(p) {
  openModal(`<h2>Color</h2><div class="modal-sub">${esc(p.name)}</div><div class="swatches">${PALETTE.map((c) => `<button class="sw${c === p.color ? ' on' : ''}" data-c="${c}" style="background:${INK[c] || c}"></button>`).join('')}</div>`, (card) => {
    $$('[data-c]', card).forEach((b) => b.onclick = async () => { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { color: b.dataset.c } }); closeModal(); await refresh(false); });
  }, 'modal-card narrow');
}
function projectStats(btn) {
  const p = proj($('#view').dataset.project);
  const mine = S.tasks.filter((t) => t.projectId === p.id);
  const open = mine.filter((t) => !t.completedAt), late = open.filter((t) => t.due && t.due.date < todayKey()).length;
  const done = mine.filter((t) => t.completedAt).length;
  openMenu(btn, [], { cls: 'stats', html: `<div class="st"><b>${open.length}</b><span>Open</span></div><div class="st${late ? ' late' : ''}"><b>${late}</b><span>Overdue</span></div><div class="st"><b>${done}</b><span>Completed</span></div>` });
}

async function addProject() {
  const n = await askText('New project', '', 'Add'); if (!n) return;
  const r = await api('/api/projects', { method: 'POST', body: { name: n.trim() } });
  await refresh(false); go('tasks', `p:${r.project.id}`);
}
async function addSection(pid) {
  const n = await askText('New section', '', 'Add'); if (!n) return;
  await api(`/api/projects/${pid}/sections`, { method: 'POST', body: { name: n.trim() } });
  await refresh(false);
}
function inlineAdd(btn) {
  const pid = $('#view').dataset.project, p = proj(pid), sec = p.sections.find((s) => s.id === btn.dataset.sec);
  const inp = document.createElement('input');
  inp.className = `add-input${btn.classList.contains('addrow') ? ' addrow-input' : ''}`;
  inp.placeholder = `New task in ${sec ? sec.name : p.name}… (dates like “fri 2pm” work)`;
  btn.replaceWith(inp); inp.focus();
  inp.onkeydown = async (e) => {
    if (e.key === 'Escape') return render();
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    const r = await api('/api/quickadd', { method: 'POST', body: { text: inp.value.trim() } });
    await api(`/api/tasks/${r.task.id}`, { method: 'PATCH', body: { projectId: p.id, sectionId: sec ? sec.id : null } });
    await refresh(false);
    const again = $$(`[data-act=inline-add]`).find((b) => b.dataset.sec === (sec ? sec.id : '')); if (again) inlineAdd(again);
  };
  inp.onblur = () => setTimeout(() => { if (document.activeElement !== inp && !inp.value.trim()) render(); }, 100);
}

function go(view, nav) {
  if (view) S.view = view;
  if (nav) S.nav = nav;
  render();
}
function flashTask(id) {
  requestAnimationFrame(() => { const el = $(`[data-task="${id}"]`, $('#view')); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } });
}
function setTheme(dark) { document.documentElement.classList.toggle('dark', dark); setPref('cc.theme', dark ? 'dark' : 'light'); render(); }

// ---------- quick add with # and / autocomplete ----------
const AC = { el: null, chips: null, opts: [], idx: 0, trig: null, dismissed: null, step: null, defaultToday: false };

function acContext(input) {
  const v = input.value, caret = input.selectionStart;
  const before = v.slice(0, caret);
  const m = before.match(/(^|\s)([#/])([^#/@\n]*)$/);
  if (!m) return null;
  const at = before.length - m[3].length - 1;
  if (AC.dismissed === `${input.id}:${at}`) return null;
  return { kind: m[2], q: m[3], at, caret };
}
function projectInText(text) {
  // Last #Project in the text that matches a known project (longest name wins).
  const names = [...S.projects].map((p) => p.name).sort((a, b) => b.length - a.length);
  let found = null;
  const re = /(^|\s)#/g; let mm;
  while ((mm = re.exec(text))) { const rest = text.slice(mm.index + mm[0].length).toLowerCase(); const n = names.find((x) => rest.startsWith(x.toLowerCase())); if (n) found = S.projects.find((p) => p.name === n); }
  return found;
}
const wordMatch = (name, q) => { if (!q) return true; const n = name.toLowerCase(), qq = q.toLowerCase().trim(); return n.startsWith(qq) || n.split(/[\s:&,()-]+/).some((w) => w.startsWith(qq)); };
const mark = (name, q) => { if (!q) return esc(name); const i = name.toLowerCase().indexOf(q.toLowerCase().trim()); return i < 0 ? esc(name) : `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.trim().length))}</mark>${esc(name.slice(i + q.trim().length))}`; };

function acBuild(input) {
  const ctx = acContext(input);
  if (AC.step && AC.step.input === input) return acRender();
  if (!ctx) return acClose();
  const q = ctx.q, opts = [];
  if (ctx.kind === '#') {
    for (const p of projList()) if (wordMatch(p.name, q)) opts.push({ type: 'project', p, label: mark(p.name, q) });
    if (q.trim() && !opts.length) opts.push({ type: 'new-project', name: q.trim() });
  } else {
    const p = projectInText(input.value.slice(0, ctx.at));
    if (p) { for (const s of secList(p)) if (wordMatch(s.name, q)) opts.push({ type: 'section', p, s, label: mark(s.name, q), flat: true }); }
    else for (const pp of projList()) for (const s of secList(pp)) if (wordMatch(s.name, q)) opts.push({ type: 'section', p: pp, s, label: mark(s.name, q), group: pp });
    const exact = opts.some((o) => o.s && o.s.name.toLowerCase() === q.trim().toLowerCase());
    if (q.trim() && !exact) opts.push({ type: 'new-section', name: q.trim(), p });
    AC.secProject = p;
  }
  const real = opts.filter((o) => !o.type.startsWith('new'));
  if (!real.length && /\s/.test(q)) return acClose(); // they've moved on: treat it as plain text
  AC.el = input; AC.trig = ctx; AC.opts = opts; AC.idx = Math.min(AC.idx, Math.max(0, opts.length - 1));
  if (!opts.length) return acClose();
  acRender();
}
function acRender() {
  const box = $('#suggest'), input = AC.step ? AC.step.input : AC.el;
  let h = '';
  if (AC.step) {
    h += `<div class="sh"><span>Create section “${esc(AC.step.name)}” in…</span></div>`;
    AC.opts = projList().map((p) => ({ type: 'pick-project', p }));
    AC.opts.forEach((o, i) => { h += `<button class="opt flat${i === AC.idx ? ' on' : ''}" data-i="${i}"><span class="tick" style="background:${ink(o.p)}"></span>${esc(o.p.name)}<span class="ret">↵</span></button>`; });
  } else {
    const isSec = AC.trig.kind === '/';
    h += `<div class="sh"><span>${isSec ? (AC.secProject ? `Sections in ${esc(AC.secProject.name)}` : 'Sections') : 'Projects'}</span></div>`;
    let lastGroup = null;
    AC.opts.forEach((o, i) => {
      const on = i === AC.idx ? ' on' : '';
      if (o.group && o.group !== lastGroup) { h += `<div class="g"><i style="background:${ink(o.group)}"></i>${esc(o.group.name)}</div>`; lastGroup = o.group; }
      if (o.type === 'project') h += `<button class="opt flat${on}" data-i="${i}"><span class="tick" style="background:${ink(o.p)}"></span><span>${o.label}</span><span class="ret">↵</span></button>`;
      else if (o.type === 'section') h += `<button class="opt${o.flat ? ' flat' : ''}${on}" data-i="${i}"><span class="sl">/</span><span>${o.label}</span><span class="ret">↵</span></button>`;
      else if (o.type === 'new-project') h += `<div class="g" style="padding-top:12px">Or make a new one</div><button class="opt new${on}" data-i="${i}"><span>+ Create project <b>“${esc(o.name)}”</b></span><span class="ret">↵</span></button>`;
      else if (o.type === 'new-section') h += `<div class="g" style="padding-top:12px">Or make a new one</div><button class="opt new${on}" data-i="${i}"><span>+ Create section <b>“${esc(o.name)}”</b> ${o.p ? `in ${esc(o.p.name)}` : 'in…'}</span>${o.p ? '' : '<span class="pj">choose a project next</span>'}<span class="ret">↵</span></button>`;
    });
  }
  h += '<div class="foot"><span><span class="kbd">↑↓</span>move</span><span><span class="kbd">Enter</span>pick</span><span><span class="kbd">Esc</span>close, keep as text</span></div>';
  box.innerHTML = h; box.classList.remove('hidden');
  const r = input.getBoundingClientRect();
  const above = input.id === 'composer-input';
  box.style.left = `${Math.max(8, Math.min(r.left - 30, innerWidth - 450))}px`;
  if (above) { box.style.top = ''; box.style.bottom = `${innerHeight - r.top + 18}px`; } else { box.style.bottom = ''; box.style.top = `${r.bottom + 12}px`; }
  const on = $('.opt.on', box); if (on) on.scrollIntoView({ block: 'nearest' });
  const cb = input.id === 'nb-input' ? $('#nb-chips') : $('#qa-chips'); if (cb) cb.innerHTML = '';
}
function acGhost(input) {
  $$('.ac-ghost').forEach((g) => g.parentNode.removeChild(g));
  const ctx = acContext(input);
  if (!ctx || ctx.q || document.activeElement !== input || AC.step) return;
  const word = ctx.kind === '#' ? 'project' : 'section';
  const cs = getComputedStyle(input), cv = acGhost.c || (acGhost.c = document.createElement('canvas').getContext('2d'));
  cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const x = input.offsetLeft + parseFloat(cs.paddingLeft) + cv.measureText(input.value.slice(0, ctx.caret)).width - input.scrollLeft + 2;
  const g = document.createElement('span'); g.className = 'ac-ghost'; g.textContent = word;
  Object.assign(g.style, { left: `${x}px`, top: `${input.offsetTop}px`, height: `${input.offsetHeight}px`, lineHeight: `${input.offsetHeight}px`, font: `italic ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` });
  input.parentElement.appendChild(g);
}
function acClose() { $('#suggest').classList.add('hidden'); AC.opts = []; AC.idx = 0; AC.step = null; AC.trig = null; }
function acInsert(input, text) {
  const t = AC.trig, v = input.value;
  input.value = v.slice(0, t.at) + text + ' ' + v.slice(t.caret).replace(/^\s+/, '');
  const pos = t.at + text.length + 1; input.setSelectionRange(pos, pos); input.focus();
}
async function acPick(i) {
  const o = AC.opts[i]; if (!o) return;
  const input = AC.step ? AC.step.input : AC.el;
  try {
    if (o.type === 'project') acInsert(input, `#${o.p.name}`);
    else if (o.type === 'section') {
      const hasProj = AC.secProject;
      acInsert(input, hasProj ? `/${o.s.name}` : `#${o.p.name} /${o.s.name}`);
    } else if (o.type === 'new-project') {
      const r = await api('/api/projects', { method: 'POST', body: { name: o.name } }); S.projects.push(r.project);
      acInsert(input, `#${o.name}`); toast(`New project: ${o.name}`); refreshQuiet();
    } else if (o.type === 'new-section') {
      if (o.p) { await api(`/api/projects/${o.p.id}/sections`, { method: 'POST', body: { name: o.name } }); await loadState(); acInsert(input, `/${o.name}`); toast(`New section in ${o.p.name}: ${o.name}`); refreshQuiet(); }
      else { AC.step = { input, name: o.name, trig: AC.trig }; AC.idx = 0; return acRender(); }
    } else if (o.type === 'pick-project') {
      const st = AC.step; AC.step = null; AC.trig = st.trig;
      await api(`/api/projects/${o.p.id}/sections`, { method: 'POST', body: { name: st.name } }); await loadState();
      acInsert(input, `#${o.p.name} /${st.name}`); toast(`New section in ${o.p.name}: ${st.name}`); refreshQuiet();
    }
  } catch (e) { toast(e.message); }
  acClose(); acGhost(input); updateChips(input);
}
function refreshQuiet() { loadState().then(() => render()).catch(() => {}); }

let chipTimer;
function updateChips(input) {
  clearTimeout(chipTimer);
  const box = input.id === 'nb-input' ? $('#nb-chips') : $('#qa-chips');
  chipTimer = setTimeout(async () => {
    const v = input.value.trim();
    if (!box) return;
    if (!v || !$('#suggest').classList.contains('hidden')) { box.innerHTML = ''; return; }
    const r = await api('/api/parse', { method: 'POST', body: { text: v } }).catch(() => null); if (!r || input.value.trim() !== v) return;
    const chips = [];
    if (r.due) chips.push(`<span class="chip">${esc(dueLabel({ due: r.due }).txt)}</span>`);
    else if (!r.now) chips.push('<span class="chip">Unsorted</span>');
    if (r.duration) chips.push(`<span class="chip">${r.duration} min</span>`);
    if (r.recurring) chips.push(`<span class="chip">↻ every ${esc(r.recurring)}</span>`);
    const p = r.project ? S.projects.find((x) => x.name.toLowerCase() === r.project.toLowerCase()) : null;
    chips.push(`<span class="chip${r.project && !p ? ' new' : ''}"><i style="background:${p ? ink(p) : 'var(--ink-4)'}"></i>→ ${esc(r.project || 'Inbox')}${r.section ? ` / ${esc(r.section)}` : ''}${r.project && !p ? ' (new)' : ''}</span>`);
    if (r.now) chips.push('<span class="chip top">★ Starred</span>');
    if (r.priority) chips.push(`<span class="chip">p${r.priority}</span>`);
    box.innerHTML = chips.join('');
  }, 120);
}

async function submitAdd(input, o = {}) {
  const v = input.value.trim(); if (!v) return;
  try {
    const parsed = await api('/api/parse', { method: 'POST', body: { text: v } });
    const r = await api('/api/quickadd', { method: 'POST', body: { text: v } });
    input.value = ''; updateChips(input);
    await refresh(false);
    const pname = proj(r.task.projectId).name, sec = sectionOf(S.tasks.find((t) => t.id === r.task.id) || r.task);
    toast(!parsed.due && !parsed.now ? 'Added to Unsorted' : `Added to ${pname}${sec ? ` / ${sec.name}` : ''}`);
    if (o.focusAfter) (document.getElementById(input.id) || input).focus();
  } catch (err) { toast(err.message); }
}

function wireAdd(input, chips, o = {}) {
  input.addEventListener('input', () => { AC.idx = 0; AC.dismissed = null; acBuild(input); acGhost(input); updateChips(input); });
  input.addEventListener('click', () => acBuild(input));
  input.addEventListener('keydown', (e) => {
    const open = !$('#suggest').classList.contains('hidden');
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); AC.idx = (AC.idx + (e.key === 'ArrowDown' ? 1 : -1) + AC.opts.length) % AC.opts.length; return acRender(); }
    if (open && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); return acPick(AC.idx); }
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (AC.trig) AC.dismissed = `${input.id}:${AC.trig.at}`; acClose(); return updateChips(input); }
    if (!open && e.key === 'Enter') { e.preventDefault(); return submitAdd(input, { ...o, focusAfter: true }); }
    if (!open && e.key === 'Escape') { input.blur(); }
  });
  input.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') acBuild(input); });
  input.addEventListener('blur', () => setTimeout(() => { acGhost(input); if (!document.activeElement || !$('#suggest').contains(document.activeElement)) { if (!AC.step) acClose(); if (input.id === 'qa-input') $('#qa-chips').innerHTML = ''; } }, 180));
  input.closest('form').addEventListener('submit', (e) => e.preventDefault());
}
$('#suggest').addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); acPick(Number(b.dataset.i)); });

// ---------- Ctrl K: search and jump ----------
function openPalette() {
  openModal('<input id="pal-q" placeholder="Search tasks, projects, sections, or type a command…" autocomplete="off"><div class="res" id="pal-res"></div><div class="foot"><span><span class="kbd">↑↓</span> move</span><span><span class="kbd">Enter</span> go</span><span><span class="kbd">Esc</span> close</span></div>', (card) => {
    const q = $('#pal-q', card); let items = [], idx = 0;
    const cmds = [
      { label: 'Go to Tasks', run: () => go('tasks', 'today') }, { label: 'Go to Calendar', run: () => go('calendar') },
      { label: 'Go to Inbox', run: () => go('tasks', 'inbox') }, { label: 'Go to Upcoming', run: () => go('tasks', 'upcoming') },
      { label: document.documentElement.classList.contains('dark') ? 'Switch to light mode' : 'Switch to dark mode', run: () => setTheme(!document.documentElement.classList.contains('dark')) },
      { label: 'New project', run: addProject },
      ...(S.google.configured && !S.google.connected ? [{ label: 'Connect Google', run: () => { location.href = '/auth/google'; } }] : []),
    ];
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const hit = (x) => !s || x.toLowerCase().includes(s);
      const tasks = openTasks().filter((t) => s && hit(t.content)).slice(0, 8).map((t) => ({ g: 'Tasks', html: `<span class="tick" style="background:${ink(proj(t.projectId))}"></span><span>${mark(t.content, s)}</span><span class="pj">${esc(proj(t.projectId).name)}${sectionOf(t) ? ` / ${esc(sectionOf(t).name)}` : ''}</span>`, run: () => { go('tasks', t.projectId === 'inbox' ? 'inbox' : `p:${t.projectId}`); flashTask(t.id); } }));
      const projs = projList({ archived: true }).filter((p) => hit(p.name)).slice(0, s ? 6 : 0).map((p) => ({ g: 'Projects', html: `<span class="tick" style="background:${ink(p)}"></span><span>${mark(p.name, s)}</span>`, run: () => go('tasks', p.id === 'inbox' ? 'inbox' : `p:${p.id}`) }));
      const secs = s ? S.projects.flatMap((p) => p.sections.filter((x) => hit(x.name)).map((x) => ({ g: 'Sections', html: `<span class="sl" style="color:var(--ink-4)">/</span><span>${mark(x.name, s)}</span><span class="pj">${esc(p.name)}</span>`, run: () => { S.projView = 'list'; go('tasks', `p:${p.id}`); } }))).slice(0, 5) : [];
      const cm = cmds.filter((c) => hit(c.label)).map((c) => ({ g: 'Commands', html: esc(c.label), run: c.run }));
      items = [...tasks, ...projs, ...secs, ...cm]; idx = Math.min(idx, Math.max(0, items.length - 1));
      let h = '', g = null;
      items.forEach((it, i) => { if (it.g !== g) { h += `<div class="g">${it.g}</div>`; g = it.g; } h += `<button class="it${i === idx ? ' on' : ''}" data-i="${i}">${it.html}</button>`; });
      $('#pal-res', card).innerHTML = h || '<div class="empty">No matches</div>';
      const on = $('.it.on', card); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const runAt = (i) => { const it = items[i]; if (!it) return; closeModal(); it.run(); };
    q.oninput = () => { idx = 0; draw(); };
    q.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); runAt(idx); }
    };
    $('#pal-res', card).onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) runAt(Number(b.dataset.i)); };
    draw(); q.focus();
  }, 'palette');
}

function toggleCheats(anchor) {
  const c = $('#cheats');
  if (!c.classList.contains('hidden')) return c.classList.add('hidden');
  const r = anchor.getBoundingClientRect();
  c.classList.remove('hidden');
  c.style.left = `${Math.max(8, Math.min(r.right - 440, innerWidth - 450))}px`;
  if (r.top > innerHeight / 2) { c.style.top = ''; c.style.bottom = `${innerHeight - r.top + 12}px`; } else { c.style.bottom = ''; c.style.top = `${r.bottom + 10}px`; }
}

// ---------- click wiring ----------
document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#menu')) closeMenu();
  const navBtn = ev.target.closest('[data-nav]');
  if (navBtn) return go('tasks', navBtn.dataset.nav);
  const tab = ev.target.closest('#tabs [data-view]');
  if (tab) return go(tab.dataset.view);
  if (!ev.target.closest('#cheats') && !ev.target.closest('[data-act=cheats]')) $('#cheats').classList.add('hidden');
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const taskEl = btn.closest('[data-task]');
  const id = taskEl && taskEl.dataset.task;
  try {
    if (act === 'complete') return await completeTask(id);
    if (act === 'uncomplete') { await api(`/api/tasks/${id}/uncomplete`, { method: 'POST' }); return refresh(false); }
    if (act === 'now') return await toggleNow(id);
    if (act === 'schedule') return await openPicker(id);
    if (act === 'edit' && id) return editTask(id);
    if (act === 'sg-accept') return await acceptSuggestion(id);
    if (act === 'sg-accept-all') { for (const t of unsorted().filter((x) => x.suggest)) await acceptSuggestion(t.id, true); return refresh(false); }
    if (act === 'sg-dismiss') { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { suggest: null } }); return refresh(false); }
    if (act === 'nb-when') return await setWhen(id, btn.dataset.v);
    if (act === 'nb-later') { S.laterOpen = S.laterOpen === btn.dataset.k ? null : btn.dataset.k; return render(); }
    if (act === 'cheats') return toggleCheats(btn);
    if (act === 'add-project') return await addProject();
    if (act === 'add-section') return await addSection($('#view').dataset.project);
    if (act === 'sec-menu') { ev.stopPropagation(); return sectionMenu(btn); }
    if (act === 'proj-menu') return projectMenu(btn);
    if (act === 'proj-stats') return projectStats(btn);
    if (act === 'proj-restore') { await api(`/api/projects/${$('#view').dataset.project}`, { method: 'PATCH', body: { archived: false } }); return refresh(false); }
    if (act === 'layout') { await api(`/api/projects/${$('#view').dataset.project}`, { method: 'PATCH', body: { boardLayout: btn.dataset.v } }); return refresh(false); }
    if (act === 'open-rail') { S.openRails[btn.dataset.col] = true; return render(); }
    if (act === 'toggle-arch') { S.showArch = !S.showArch; return render(); }
    if (act === 'inline-add') return inlineAdd(btn);
    if (act === 'projview') { S.projView = btn.dataset.v; setPref('cc.projView', S.projView); return render(); }
    if (act === 'collapse') { S.collapsed[btn.dataset.key] = !S.collapsed[btn.dataset.key]; setPref('cc.collapsed', JSON.stringify(S.collapsed)); return render(); }
    if (act === 'toggle-done') { const pid = $('#view').dataset.project; S.showDone[pid] = !S.showDone[pid]; return render(); }
    if (act === 'wk') { const d = Number(btn.dataset.d); S.weekStart = d ? addDays(S.weekStart, d) : mondayOf(new Date()); await loadEvents(); return renderCalendar(); }
    if (act === 'wa-groups') { ev.preventDefault(); return waGroups(); }
    if (act === 'wa-all') { ev.preventDefault(); return waAll(); }
    if (act === 'wa-refresh') return S.waBusy || waRefresh();
    if (act === 'mail-refresh') return S.mailBusy || mailRefresh();
    if (act === 'wa-action') {
      const e = S.wa.events.find((x) => x.id === btn.closest('[data-wa]').dataset.wa);
      const items = [];
      if (e.link) items.push({ label: `Register on ${waHost(e.link)} ↗`, run: () => window.open(e.link, '_blank', 'noopener') });
      items.push({ label: 'Mark registered', run: () => waRegistered(e.id) }, { label: 'Add as a task', run: () => waTask(e, 'wa-task') }, { sep: true }, { label: 'Dismiss', run: () => waTask(e, 'wa-dismiss') });
      return openMenu(btn, items);
    }
    if (act === 'wa-registered') { await waRegistered(btn.closest('[data-wa]').dataset.wa); return waRefreshModal(btn); }
    if (act === 'wa-replied' || act === 'wa-rdismiss') {
      const id = btn.closest('[data-reply]').dataset.reply;
      await api(`/api/whatsapp/replies/${id}`, { method: 'PATCH', body: { status: act === 'wa-replied' ? 'replied' : 'dismissed' } });
      S.wa.replies = S.wa.replies.filter((x) => x.id !== id);
      render(); return refreshPopup();
    }
    if (act === 'wa-task' || act === 'wa-dismiss') {
      const e = S.wa.events.find((x) => x.id === btn.closest('[data-wa]').dataset.wa);
      await waTask(e, act);
      return waRefreshModal(btn);
    }
    if (act === 'mail-open') {
      const id = btn.closest('[data-mail]').dataset.mail;
      S.mailOpen = S.mailOpen === id ? null : id; render();
      if (S.mailOpen && S.mailText[id] == null) {
        try { S.mailText[id] = (await api(`/api/starred/${id}`)).text; } catch (e) { S.mailText[id] = `Couldn't load this email (${e.message}).`; }
        render();
      }
      return;
    }
    if (act === 'mail-pop') { const id = btn.closest('[data-mail]').dataset.mail; return mailPopup({ mode: 'reader', id, q: '' }); }
    if (act === 'mail-inbox') { return mailPopup({ mode: 'inbox', id: (S.mailPop && S.mailPop.id) || S.mailOpen || (S.starred[0] && S.starred[0].id), q: '' }); }
    if (act === 'mail-dismiss') {
      const id = btn.closest('[data-mail]').dataset.mail;
      const inPop = !$('#modal').classList.contains('hidden') && S.mailPop && S.mailPop.id === id;
      let next = null;
      if (inPop) { const i = S.starred.findIndex((x) => x.id === id); next = (S.starred[i + 1] || S.starred[i - 1] || {}).id || null; }
      const r = await api(`/api/starred/${id}/dismiss`, { method: 'POST' });
      S.starred = S.starred.filter((x) => x.id !== id); if (S.mailOpen === id) S.mailOpen = null; render();
      if (inPop) { if (next) mailPopup({ id: next }); else { closeModal(); S.mailPop = null; } }
      return toast(r.unstarred ? 'Unstarred in Gmail' : 'Hidden here. Reconnect Google once to also unstar in Gmail.');
    }
    if (act === 'mail-task' || act === 'mail-sched') {
      const m = S.starred.find((x) => x.id === btn.closest('[data-mail]').dataset.mail);
      const content = act === 'mail-task' ? `Email: ${m.subject} (${m.from})` : `Reply to ${m.from}: ${m.subject}`;
      const r = await api('/api/quickadd', { method: 'POST', body: { text: content } });
      await api(`/api/tasks/${r.task.id}`, { method: 'PATCH', body: { description: `https://mail.google.com/mail/u/0/#all/${m.threadId}` } });
      await refresh(false);
      if (act === 'mail-sched') return openPicker(r.task.id);
      return toast('Added to Inbox');
    }
  } catch (e) { toast(e.message); }
});
$('#search-btn').onclick = openPalette;
$('#theme-btn').onclick = () => setTheme(!document.documentElement.classList.contains('dark'));
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('dblclick', (e) => { const b = e.target.closest('.ev.tk'); if (b) editTask(b.dataset.task); });
document.addEventListener('contextmenu', (e) => { const b = e.target.closest('.pnav[data-projdrag]'); if (!b) return; e.preventDefault(); projectMenu(b, b.dataset.projdrag); });

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#modal').classList.contains('hidden') ? openPalette() : closeModal(); }
  if (e.key === 'Escape') { closeMenu(); closeModal(); acClose(); $('#cheats').classList.add('hidden'); return; }
  if (!$('#modal').classList.contains('hidden') && S.mailPop && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && document.activeElement.tagName !== 'TEXTAREA') {
    const c = $('#modal-card'), inInput = document.activeElement.tagName === 'INPUT';
    if (c.classList.contains('rd') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return mailStep(e.key === 'ArrowLeft' ? -1 : 1); }
    if (c.classList.contains('ib') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (inInput) document.activeElement.blur(); return mailStep(e.key === 'ArrowUp' ? -1 : 1); }
  }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !$('#modal').classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '1') go('tasks'); else if (e.key === '2') go('calendar'); else if (e.key === '3') go('tasks', 'inbox');
  else if (e.key === 'q' || e.key === 'Q' || e.key === '/') { e.preventDefault(); ($('#nb-input') || $('#qa-input')).focus(); }
});

// ---------- drag and drop ----------
let drag = null;
document.addEventListener('dragstart', (e) => {
  const sEl = e.target.closest && e.target.closest('[data-secdrag]');
  const pEl = e.target.closest && e.target.closest('[data-projdrag]');
  if (sEl || pEl) {
    drag = sEl ? { kind: 'section', id: sEl.dataset.secdrag } : { kind: 'project', id: pEl.dataset.projdrag };
    const box = sEl ? (sEl.closest('.col') || sEl.closest('.psec')) : pEl;
    setTimeout(() => box.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.id);
    return;
  }
  const evEl = e.target.closest('.ev[draggable]');
  const tEl = e.target.closest('[data-task][draggable]');
  if (evEl) {
    const evt = S.events.find((x) => x.id === evEl.dataset.ev);
    drag = { kind: 'event', evt, taskId: evEl.dataset.task || null, minutes: (new Date(evt.end) - new Date(evt.start)) / 6e4, grabOffset: e.offsetY };
  } else if (tEl) {
    const t = S.tasks.find((x) => x.id === tEl.dataset.task);
    drag = { kind: 'task', taskId: t.id, minutes: t.duration || S.settings.defaultLength || 30, grabOffset: 0, fromTop3: Boolean(tEl.closest('#top3')) };
  } else return;
  setTimeout(() => (evEl || tEl).classList.add('dragging'));
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.taskId || drag.evt.id);
});
document.addEventListener('dragend', () => { $$('.dragging').forEach((x) => x.classList.remove('dragging')); clearDrop(); drag = null; });
function clearDrop() { $$('.drop-ghost').forEach((g) => g.remove()); $$('.drop-target, .drop, .drop-before, .drop-after, .drop-before-line, .drop-left, .drop-right').forEach((c) => c.classList.remove('drop-target', 'drop', 'drop-before', 'drop-after', 'drop-before-line', 'drop-left', 'drop-right')); }
function slotFromEvent(col, e, d = drag) {
  const rect = col.getBoundingClientRect();
  let mins = START_H * 60 + Math.round(((e.clientY - rect.top - (d.grabOffset || 0)) / HOUR_PX) * 60 / 15) * 15;
  mins = Math.max(START_H * 60, Math.min(END_H * 60 - d.minutes, mins));
  const day = new Date(`${col.dataset.date}T00:00:00`); day.setMinutes(mins);
  return day;
}
function top3Target(e) { const box = e.target.closest('#top3'); if (!box) return null; const rows = $$('.row[data-task]:not(.donerow)', box); const r = rows.find((x) => e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2); return { box, before: r || null }; }
function orderTarget(e) {
  // Where a dragged section or project would land: before or after the hovered one.
  if (drag.kind === 'project') {
    const el = e.target.closest('.pnav[data-projdrag]'); if (!el || el.dataset.projdrag === drag.id) return null;
    const r = el.getBoundingClientRect(); return { el, id: el.dataset.projdrag, after: e.clientY > r.top + r.height / 2 };
  }
  const el = e.target.closest('.col[data-col]') || e.target.closest('.psec[data-secrow]');
  if (!el) return null;
  const id = el.dataset.col ?? el.dataset.secrow; if (!id || id === drag.id) return null;
  const r = el.getBoundingClientRect(), horiz = el.classList.contains('col');
  return { el, id, after: horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2, horiz };
}
document.addEventListener('dragover', (e) => {
  if (!drag) return;
  if (drag.kind === 'section' || drag.kind === 'project') {
    const ot = orderTarget(e); clearDrop(); if (!ot) return;
    e.preventDefault(); ot.el.classList.add(ot.after ? (ot.horiz ? 'drop-right' : 'drop-after') : (ot.horiz ? 'drop-left' : 'drop-before-line'));
    return;
  }
  const col = e.target.closest('.dcol');
  if (col) {
    e.preventDefault();
    const start = slotFromEvent(col, e);
    clearDrop(); col.classList.add('drop-target');
    const g = document.createElement('div'); g.className = 'drop-ghost';
    g.style.top = `${(start.getHours() + start.getMinutes() / 60 - START_H) * HOUR_PX}px`; g.style.height = `${drag.minutes / 60 * HOUR_PX}px`;
    g.textContent = fmtRange(start, new Date(start.getTime() + drag.minutes * 6e4));
    return col.appendChild(g);
  }
  const bcol = e.target.closest('.col[data-col]');
  if (bcol && drag.kind === 'task') { e.preventDefault(); clearDrop(); return bcol.classList.add('drop'); }
  const tt = drag.kind === 'task' && top3Target(e);
  if (tt) { e.preventDefault(); clearDrop(); if (tt.before) tt.before.classList.add('drop-before'); }
});
document.addEventListener('drop', async (e) => {
  if (!drag) return;
  if (drag.kind === 'section' || drag.kind === 'project') {
    const ot = orderTarget(e), d = drag; drag = null; clearDrop(); if (!ot) return;
    e.preventDefault();
    try {
      if (d.kind === 'project') { const ids = projList().filter((p) => p.id !== 'inbox').map((p) => p.id); await moveInList(ids, d.id, ot.id, ot.after, (x) => api('/api/projects/order', { method: 'POST', body: { ids: x } })); }
      else { const p = proj($('#view').dataset.project); await moveInList(secList(p).map((x) => x.id), d.id, ot.id, ot.after, (x) => api(`/api/projects/${p.id}/sections/order`, { method: 'POST', body: { ids: x } })); }
      await refresh(false);
    } catch (err) { toast(err.message); }
    return;
  }
  const d = drag; drag = null;
  const col = e.target.closest('.dcol'), bcol = e.target.closest('.col[data-col]'), tt = d.kind === 'task' && top3Target(e);
  clearDrop();
  try {
    if (col) {
      e.preventDefault();
      if (!S.google.connected) return toast('Connect Google first');
      const start = slotFromEvent(col, e, d), end = new Date(start.getTime() + d.minutes * 6e4);
      if (d.taskId) await api(`/api/tasks/${d.taskId}/schedule`, { method: 'POST', body: { start: start.toISOString(), end: end.toISOString() } });
      else await api('/api/events', { method: 'PATCH', body: { calendarId: d.evt.calendarId, eventId: d.evt.id, start: start.toISOString(), end: end.toISOString() } });
      toast(`Blocked ${fmtRange(start, end)}`); return await refresh();
    }
    if (bcol) { e.preventDefault(); await api(`/api/tasks/${d.taskId}`, { method: 'PATCH', body: { sectionId: bcol.dataset.col || null } }); return await refresh(false); }
    if (tt) {
      e.preventDefault();
      const t = S.tasks.find((x) => x.id === d.taskId);
      if (!t.now) { await toggleNow(t.id); if (!S.tasks.find((x) => x.id === t.id).now) return; }
      const ids = top3().map((x) => x.id).filter((x) => x !== t.id);
      const at = tt.before ? ids.indexOf(tt.before.dataset.task) : -1;
      ids.splice(at < 0 ? ids.length : at, 0, t.id);
      await api('/api/top3/order', { method: 'POST', body: { ids } }); return await refresh(false);
    }
  } catch (err) { toast(err.message); }
});

async function moveInList(ids, id, targetId, after, save) {
  const out = ids.filter((x) => x !== id); let at = out.indexOf(targetId); if (at < 0) return;
  out.splice(after ? at + 1 : at, 0, id); await save(out);
}

// Pick up changes Claude makes from outside the page (Duet, CLI, drop folder).
async function checkRev() {
  if (document.hidden) return;
  try {
    const { rev } = await api('/api/rev');
    if (lastRev !== null && rev !== lastRev && $('#modal').classList.contains('hidden') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !drag) await refresh(S.view === 'calendar');
  } catch {}
}
setInterval(checkRev, 5000);
document.addEventListener('visibilitychange', checkRev);

// ---------- boot ----------
function tickClock() { const d = new Date(); $('#clock').textContent = `${DOW[d.getDay()]} ${fmtTime(d)}`; }
(async function boot() {
  S.weekStart = mondayOf(new Date());
  wireAdd($('#qa-input'), $('#qa-chips'));
  tickClock(); setInterval(tickClock, 15e3);
  await refresh();
  setInterval(() => { if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; refresh().catch(() => {}); }, 60e3); // picks up changes from your phone or Google
})();
