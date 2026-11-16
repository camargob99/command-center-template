// Cloudflare Workers always run in UTC. Command Center's date logic (quick add, free slots, "today")
// uses local time, so in the cloud we swap in a Date whose local getters and setters follow one time zone.
export function installZonedDate(zone) {
  const Real = Date;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  // Minutes to add to UTC to get wall time in `zone` at instant ms.
  const cache = new Map(); // offsets only change on quarter hours, so cache by 15-minute bucket
  const offset = (ms) => {
    const key = Math.floor(ms / 9e5);
    if (cache.has(key)) return cache.get(key);
    const o = rawOffset(key * 9e5);
    if (cache.size > 5000) cache.clear();
    cache.set(key, o); return o;
  };
  const rawOffset = (ms) => {
    const p = {}; for (const x of fmt.formatToParts(new Real(ms))) p[x.type] = x.value;
    const wall = Real.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
  };
  // Wall-clock fields (as a UTC timestamp) to the real instant.
  // Ambiguous (fall back): earlier instant. Skipped (spring forward): read with the pre-change offset. Same as Node.
  const fromWall = (wallMs) => {
    const before = offset(wallMs - 864e5 / 2), after = offset(wallMs + 864e5 / 2);
    const ok = [before, after].map((o) => wallMs - o * 60000).filter((ms) => wallMs - offset(ms) * 60000 === ms);
    return ok.length ? Math.min(...ok) : wallMs - before * 60000;
  };
  const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

  class ZonedDate extends Real {
    constructor(...a) {
      if (a.length === 0) { super(); return; }
      if (a.length === 1) {
        if (typeof a[0] === 'string') {
          const m = a[0].match(LOCAL_ISO); // no offset: read as local time, like Node does
          if (m) { super(fromWall(Real.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), +(m[7] || '0').slice(0, 3).padEnd(3, '0')))); return; }
        }
        super(a[0] instanceof Real ? a[0].getTime() : a[0]); return;
      }
      const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = a;
      super(fromWall(Real.UTC(y, mo, d, h, mi, s, ms)));
    }
    _w() { return new Real(this.getTime() + offset(this.getTime()) * 60000); }
    _set(fn) { const w = this._w(); fn(w); return this.setTime(fromWall(w.getTime())); }
    getFullYear() { return this._w().getUTCFullYear(); }
    getMonth() { return this._w().getUTCMonth(); }
    getDate() { return this._w().getUTCDate(); }
    getDay() { return this._w().getUTCDay(); }
    getHours() { return this._w().getUTCHours(); }
    getMinutes() { return this._w().getUTCMinutes(); }
    getSeconds() { return this._w().getUTCSeconds(); }
    getTimezoneOffset() { return -offset(this.getTime()); }
    setFullYear(...a) { return this._set((w) => w.setUTCFullYear(...a)); }
    setMonth(...a) { return this._set((w) => w.setUTCMonth(...a)); }
    setDate(...a) { return this._set((w) => w.setUTCDate(...a)); }
    setHours(...a) { return this._set((w) => w.setUTCHours(...a)); }
    setMinutes(...a) { return this._set((w) => w.setUTCMinutes(...a)); }
    setSeconds(...a) { return this._set((w) => w.setUTCSeconds(...a)); }
    toLocaleDateString(loc, o = {}) { return super.toLocaleDateString(loc, { timeZone: zone, ...o }); }
    toLocaleTimeString(loc, o = {}) { return super.toLocaleTimeString(loc, { timeZone: zone, ...o }); }
    toLocaleString(loc, o = {}) { return super.toLocaleString(loc, { timeZone: zone, ...o }); }
    static now() { return Real.now(); }
    static parse(s) { return new ZonedDate(s).getTime(); }
  }
  globalThis.Date = ZonedDate;
  return ZonedDate;
}
