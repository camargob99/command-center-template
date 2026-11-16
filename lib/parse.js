// Quick add parser: turns "Call Sam fri 2pm #Work @Now p1 for 30m"
// into structured fields. Plain code, no AI.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_ALIASES = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// Next occurrence of weekday (today counts).
function upcoming(today, dow) {
  const diff = (dow - today.getDay() + 7) % 7;
  return addDays(today, diff);
}

// Find the longest name in `names` that `text` starts with (case-insensitive).
function longestPrefix(text, names) {
  const lower = text.toLowerCase();
  let best = null;
  for (const n of names) {
    const ln = n.toLowerCase();
    if (lower.startsWith(ln) && (lower.length === ln.length || /[\s,]/.test(lower[ln.length]))) {
      if (!best || n.length > best.length) best = n;
    }
  }
  return best;
}

function parse(input, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = startOfDay(now);
  const projects = opts.projects || []; // [{name, sections:[{name}]}]
  let text = ` ${input.trim()} `;
  const out = { content: '', due: null, duration: null, project: null, section: null, now: false, priority: null, recurring: null };

  const cut = (re, fn) => {
    text = text.replace(re, (...m) => { const keep = fn(...m); return keep === undefined ? ' ' : keep; });
  };

  // #Project (longest known name wins, else one word)
  cut(/\s#(\S[^#@/]*)/, (m, rest) => {
    const name = longestPrefix(rest, projects.map((p) => p.name));
    if (name) { out.project = name; return ' ' + rest.slice(name.length) + ' '; }
    const word = rest.split(/\s+/)[0];
    out.project = word;
    return ' ' + rest.slice(word.length) + ' ';
  });
  // /Section (within the chosen project if known)
  cut(/\s\/(\S[^#@/]*)/, (m, rest) => {
    const proj = projects.find((p) => out.project && p.name.toLowerCase() === out.project.toLowerCase());
    const pool = proj ? (proj.sections || []).map((s) => s.name) : projects.flatMap((p) => (p.sections || []).map((s) => s.name));
    const name = longestPrefix(rest, pool);
    if (name) { out.section = name; return ' ' + rest.slice(name.length) + ' '; }
    const word = rest.split(/\s+/)[0];
    out.section = word;
    return ' ' + rest.slice(word.length) + ' ';
  });
  cut(/\s@(?:now|top3|star)\b/i, () => { out.now = true; });
  cut(/\sp([1-4])\b/i, (m, p) => { out.priority = Number(p); });
  cut(/\sfor\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?(?=\s)/i, (m, h, mm) => {
    if (!h && !mm) return m; // "for" without a length stays in the text
    out.duration = (Number(h || 0) * 60) + Number(mm || 0);
  });

  // Recurrence: every day | every weekday | every week | every month | every mon
  cut(/\s(?:every|each)\s+(day|weekday|week|month|[a-z]+)\b/i, (m, what) => {
    const w = what.toLowerCase();
    if (['day', 'weekday', 'week', 'month'].includes(w) || DAY_ALIASES[w] !== undefined) {
      out.recurring = w in DAY_ALIASES ? DAYS[DAY_ALIASES[w]] : w;
      return undefined;
    }
    return m;
  });

  // Time: 2pm, 2:30pm, 14:00, at 9am
  let time = null;
  cut(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m, h, mi, ap) => {
    let hh = Number(h) % 12; if (ap.toLowerCase() === 'pm') hh += 12;
    time = `${pad(hh)}:${mi || '00'}`;
  });
  if (!time) {
    cut(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m, h, mi) => { time = `${pad(Number(h))}:${mi}`; });
  }

  // Date
  let date = null;
  cut(/\s(today|tod|tonight)(?=\s)/i, () => { date = today; });
  if (!date) cut(/\s(tomorrow|tom|tmr)(?=\s)/i, () => { date = addDays(today, 1); });
  if (!date) {
    cut(/\snext\s+(week|[a-z]+)(?=\s)/i, (m, w) => {
      const k = w.toLowerCase();
      if (k === 'week') { date = addDays(upcoming(addDays(today, 1), 1), 0); return undefined; }
      if (DAY_ALIASES[k] === undefined) return m;
      const up = upcoming(addDays(today, 1), DAY_ALIASES[k]);
      // "next X" means X in next week (Mon-Sun weeks)
      const daysToSunday = (7 - today.getDay()) % 7;
      const endOfWeek = addDays(today, daysToSunday);
      date = up <= endOfWeek ? addDays(up, 7) : up;
      return undefined;
    });
  }
  if (!date) {
    cut(/\s(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)(?=\s)/i, (m, w) => {
      date = upcoming(today, DAY_ALIASES[w.toLowerCase()]);
    });
  }
  if (!date) {
    cut(/\s([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, (m, mon, d) => {
      const mi = MONTHS[mon.toLowerCase()];
      if (mi === undefined) return m;
      date = new Date(today.getFullYear(), mi, Number(d));
      if (date < today) date.setFullYear(date.getFullYear() + 1);
    });
  }
  if (!date) {
    cut(/\s(\d{1,2})\s+([a-z]{3,9})(?=\s)/i, (m, d, mon) => {
      const mi = MONTHS[mon.toLowerCase()];
      if (mi === undefined) return m;
      date = new Date(today.getFullYear(), mi, Number(d));
      if (date < today) date.setFullYear(date.getFullYear() + 1);
    });
  }
  if (!date) {
    cut(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (m, mo, d, y) => {
      let yy = y ? Number(y) : today.getFullYear(); if (yy < 100) yy += 2000;
      date = new Date(yy, Number(mo) - 1, Number(d));
      if (!y && date < today) date.setFullYear(date.getFullYear() + 1);
    });
  }

  if (out.recurring && !date) {
    if (out.recurring in DAY_ALIASES) date = upcoming(today, DAY_ALIASES[out.recurring]);
    else if (out.recurring === 'weekday') { date = today; while (date.getDay() === 0 || date.getDay() === 6) date = addDays(date, 1); }
    else date = today;
  }
  if (time && !date) {
    // A bare time means today, or tomorrow if that time already passed.
    const [hh, mm] = time.split(':').map(Number);
    const t = new Date(today); t.setHours(hh, mm);
    date = t < now ? addDays(today, 1) : today;
  }
  if (date) out.due = { date: ymd(date), time };

  out.content = text.replace(/\s+/g, ' ').trim();
  return out;
}

// Next due date for a recurring task after completion.
function nextOccurrence(recurring, fromDate) {
  const d = new Date(`${fromDate}T00:00:00`);
  const r = recurring;
  if (r === 'day') return ymd(addDays(d, 1));
  if (r === 'week') return ymd(addDays(d, 7));
  if (r === 'month') { const x = new Date(d); x.setMonth(x.getMonth() + 1); return ymd(x); }
  if (r === 'weekday') { let x = addDays(d, 1); while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1); return ymd(x); }
  if (r in DAY_ALIASES) { return ymd(upcoming(addDays(d, 1), DAY_ALIASES[r])); }
  return null;
}

module.exports = { parse, nextOccurrence, ymd, addDays, startOfDay };
