// Free-slot finder for the "Schedule on calendar" picker. Plain code, local time.

function minutesOf(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/**
 * @param {object} o
 * @param {{start:string|Date,end:string|Date}[]} o.busy  busy intervals
 * @param {Date} o.now
 * @param {number} o.days       how many days (starting today + offset)
 * @param {number} o.lengthMin  slot length
 * @param {object} o.settings   {workStart, weekdayEnd, weekendEnd, bufferMin, stepMin}
 * @returns {{date:string, slots:{start:string,end:string}[]}[]}
 */
function findSlots({ busy, now, days = 5, lengthMin = 30, settings = {}, offset = 0 }) {
  const s = { workStart: '08:00', weekdayEnd: '21:00', weekendEnd: '18:00', bufferMin: 10, stepMin: 30, ...settings };
  const buf = s.bufferMin * 60000;
  const blocks = busy.map((b) => [new Date(b.start).getTime() - buf, new Date(b.end).getTime() + buf]);
  const earliest = now.getTime() + 15 * 60000;
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + offset + i);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const startM = minutesOf(s.workStart);
    const endM = minutesOf(weekend ? s.weekendEnd : s.weekdayEnd);
    const slots = [];
    for (let m = startM; m + lengthMin <= endM; m += s.stepMin) {
      const st = new Date(day); st.setMinutes(m);
      const en = new Date(st.getTime() + lengthMin * 60000);
      if (st.getTime() < earliest) continue;
      const clash = blocks.some(([a, b]) => st.getTime() < b && en.getTime() > a);
      if (!clash) slots.push({ start: st.toISOString(), end: en.toISOString() });
    }
    const y = day.getFullYear(), mo = String(day.getMonth() + 1).padStart(2, '0'), d = String(day.getDate()).padStart(2, '0');
    out.push({ date: `${y}-${mo}-${d}`, slots });
  }
  return out;
}

module.exports = { findSlots };
