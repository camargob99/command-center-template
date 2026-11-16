// Free event matcher for WhatsApp (no AI). Runs in the cloud each time the PC sync sends new messages,
// so likely events show up on the Today page right away. The weekday morning Claude check still reviews
// every message; whatever it saves replaces these rough cards (see save_whatsapp_events).
//
// A message counts only when it has BOTH a date we can pin down (today through the next 14 days)
// and a word that sounds like an event. Buy/sell/swap posts, very short messages and your own messages are skipped.

const DAY = 864e5;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const EVENT_WORDS = /\b(rsvp|regist\w*|sign[ -]?ups?|signup|tickets?|event|invite[ds]?|join us|come (join|rep|by|out|through|hang)|dinner|lunch|breakfast|brunch|party|mixer|happy hour|social|talk|panel|workshop|info ?session|session|game ?night|watch party|trip|trek|potluck|meetup|meet-up|gathering|tailgate|celebration|kick ?off|reception|networking|fireside|speaker|sgd|bbq|drinks|formal|gala|tournament|screening|hike|run club)\b/i;
const NOISE = /^\W*(iso|selling|sell|looking for|giving away|anyone need|swap|trade|can swap|still selling|wts|wtb)\b/i;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// The date a message talks about, as YYYY-MM-DD, read relative to when it was sent. null when unclear.
export function findDate(text, sentMs) {
  const t = ` ${String(text).toLowerCase()} `;
  const base = startOfDay(sentMs);
  // "Nov 18", "November 18th"
  let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?\b/);
  // "18 Nov", "18th of November"
  if (!m) { const r = t.match(/\b(\d{1,2})(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/); if (r) m = [r[0], r[4], r[1]]; }
  if (m) return nearest(base, MONTHS.indexOf(m[1].slice(0, 3)), Number(m[2]));
  // "11/18" (US month/day), not "1/2 of us" style fractions: needs a valid month and day
  m = t.match(/(?:^|[\s(])(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?=[\s,.)!?]|$)/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) return nearest(base, Number(m[1]) - 1, Number(m[2]));
  if (/\b(today|tonight|tonite)\b/.test(t)) return ymd(base);
  if (/\b(tomorrow|tmrw|tmr|tomorow)\b/.test(t)) return ymd(addDays(base, 1));
  // "wed", "Wednesday", "this friday", "next tue", optionally with a day number: "wed 18th"
  m = t.match(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)(day|nesday|sday|urday|rsday|s)?\.?(\s+(the\s+)?(\d{1,2})(st|nd|rd|th)?)?\b/);
  if (m) {
    const want = WEEKDAYS.indexOf(m[2]);
    if (m[6]) { // "wed 18th": the next 18th that falls on a Wednesday
      for (let i = 0; i < 70; i++) { const d = addDays(base, i); if (d.getDate() === Number(m[6]) && d.getDay() === want) return ymd(d); }
      return null;
    }
    let ahead = (want - base.getDay() + 7) % 7;
    if (m[1] && ahead === 0) ahead = 7;
    return ymd(addDays(base, ahead));
  }
  return null;
}
// The next month/day on or after the message (a date a few days back stays in that year, so recaps fall out of the window).
function nearest(base, month, day) {
  if (month < 0 || day < 1 || day > 31) return null;
  for (const y of [base.getFullYear(), base.getFullYear() + 1]) {
    const d = new Date(y, month, day);
    if (d.getMonth() !== month) continue;
    if (d >= addDays(base, -3)) return ymd(d);
  }
  return null;
}

export function findTime(text) {
  const t = String(text).toLowerCase();
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/);
  if (m) { let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12; const mm = Number(m[2] || 0); if (h < 24 && mm < 60) return `${pad(h)}:${pad(mm)}`; }
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${pad(Number(m[1]))}:${m[2]}`;
  return null;
}

// A short card title from the message: its first meaningful line, without emoji and markdown stars.
export function titleOf(text) {
  const lines = String(text).split('\n').map((l) => l.replace(/[*_~`]/g, '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()).filter((l) => l.length > 3);
  let s = lines[0] || 'WhatsApp event';
  if (s.length > 70) { s = s.slice(0, 70); const sp = s.lastIndexOf(' '); s = `${s.slice(0, sp > 40 ? sp : 70)}…`; }
  return s.replace(/^[\s\-–•:]+/, '');
}

// Messages ({chat, id, sender, body, ts}) to likely events. `now` decides the 14-day window.
export function matchEvents(msgs, now = Date.now()) {
  const today = ymd(new Date(now)), last = ymd(new Date(now + 14 * DAY));
  const out = [], seenBody = new Set();
  for (const m of msgs) {
    const body = String(m.body || '');
    if (m.sender === 'Me' || body.length < 25 || body.startsWith('[')) continue;
    if (NOISE.test(body) && body.length < 200) continue;
    if (!EVENT_WORDS.test(body)) continue;
    const date = findDate(body, Number(m.ts));
    if (!date || date < today || date > last) continue;
    const key = body.replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase(); // same post cross-posted to several groups
    if (seenBody.has(key)) continue;
    seenBody.add(key);
    const link = (body.match(/https?:\/\/[^\s)>\]]+/) || [])[0] || null;
    const dl = body.match(/\b((rsvp|register|sign up|deadline)[^.\n!]{0,20}?\b(by|before)\s+[^.\n!,]{2,18})/i);
    out.push({
      chat: m.chat, title: titleOf(body), date, time: findTime(body), link,
      quote: body.length > 300 ? `${body.slice(0, 300)}…` : body, sender: m.sender || null,
      deadline: dl ? dl[1].trim().slice(0, 40) : null, srcAdded: m.added || null,
    });
  }
  return out;
}
