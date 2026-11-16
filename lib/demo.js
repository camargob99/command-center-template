// Fake Google for demo mode (`npm run demo`): lets you try the dashboard with sample data.
const { ymd, startOfDay, addDays } = require('./parse');

function at(day, hh, mm = 0) { const d = new Date(day); d.setHours(hh, mm, 0, 0); return d.toISOString(); }

class DemoGoogle {
  constructor() {
    const mon = startOfDay(new Date());
    while (mon.getDay() !== 1) mon.setDate(mon.getDate() - 1);
    const d = (i) => addDays(mon, i);
    this.items = [
      { id: 'e1', calendarId: 'primary', summary: 'Team standup', start: at(d(0), 9, 30), end: at(d(0), 10) },
      { id: 'e2', calendarId: 'work', summary: 'Quarterly planning', start: at(d(1), 13), end: at(d(1), 14, 30) },
      { id: 'e3', calendarId: 'work', summary: 'Design review', start: at(d(2), 10, 15), end: at(d(2), 11, 15) },
      { id: 'e3b', calendarId: 'primary', summary: 'Design review', start: at(d(2), 10, 15), end: at(d(2), 11, 15) },
      { id: 'e4', calendarId: 'primary', summary: 'Dinner with Alex', start: at(d(1), 19), end: at(d(1), 20, 30) },
      { id: 'e5', calendarId: 'primary', summary: 'Coffee with Sam', start: at(d(4), 10), end: at(d(4), 10, 45) },
      { id: 'e6', calendarId: 'work', summary: 'Client check-in', start: at(d(3), 9), end: at(d(3), 9, 45) },
      { id: 'e7', calendarId: 'primary', summary: 'Spanish class', start: at(d(3), 18), end: at(d(3), 19) },
      { id: 'e8', calendarId: 'primary', summary: 'Gym', start: at(d(5), 9), end: at(d(5), 10) },
    ].map((e) => ({ ...e, start: { dateTime: e.start }, end: { dateTime: e.end } }));
    this.n = 100;
  }
  get configured() { return true; }
  get connected() { return true; }
  get canUnstar() { return true; }
  async calendars() {
    return [
      { id: 'primary', name: 'Personal', primary: true, color: '#039be5', selected: true, accessRole: 'owner' },
      { id: 'work', name: 'Work', primary: false, color: '#7986cb', selected: true, accessRole: 'reader' },
    ];
  }
  async events(calendarId, timeMin, timeMax) {
    const a = new Date(timeMin).getTime(), b = new Date(timeMax).getTime();
    return this.items.filter((e) => e.calendarId === calendarId && new Date(e.start.dateTime).getTime() < b && new Date(e.end.dateTime).getTime() > a);
  }
  async freeBusy(ids, timeMin, timeMax) {
    const evs = (await Promise.all(ids.map((id) => this.events(id, timeMin, timeMax)))).flat();
    return evs.map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));
  }
  async insertEvent(calendarId, body) {
    const e = { id: `d${this.n++}`, calendarId, ...body };
    this.items.push(e); return e;
  }
  async patchEvent(calendarId, eventId, body) {
    const e = this.items.find((x) => x.id === eventId); Object.assign(e, body); return e;
  }
  async deleteEvent(calendarId, eventId) { this.items = this.items.filter((x) => x.id !== eventId); }
  async starred() {
    const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
    return [
      { id: 'm1', threadId: 'm1', from: 'Sam Lee', subject: 'Notes from Tuesday', date: h(5), snippet: 'Thanks for the time. Could you send over the draft proposal by Thursday so I can share it with the team?' },
      { id: 'm2', threadId: 'm2', from: 'Northwind Recruiting', subject: 'Next steps', date: h(28), snippet: 'Great speaking with you. As next steps we would love to set up time with two of the hiring managers next week.' },
      { id: 'm3', threadId: 'm3', from: 'City Running Club', subject: 'Half marathon sign-up closes Friday', date: h(52), snippet: 'Reminder: registration closes this Friday at 5pm. Spots are limited.' },
    ].filter((m) => !(this.unstarred || []).includes(m.id));
  }
  async message(id) {
    const m = (await this.starred()).find((x) => x.id === id) || { snippet: '' };
    return { id, threadId: id, text: `${m.snippet}\n\nLet me know what works on your side and I can send over a few options.\n\nThanks,\n${m.from || ''}` };
  }
  async unstar(id) { this.unstarred = [...(this.unstarred || []), id]; }
}

function seedTasks(store) {
  const P = (name) => store.projectByName(name) || store.addProject(name);
  const today = new Date();
  const day = (n) => ymd(addDays(today, n));
  const add = (content, project, extra = {}) => {
    const [pn, sn] = project.split(' / ');
    const pr = P(pn);
    const sec = sn ? (pr.sections.find((x) => x.name === sn) || store.addSection(pr, sn)) : null;
    return store.addTask({ content, projectId: pr.id, sectionId: sec ? sec.id : null, ...extra });
  };
  ['Work', 'Job search', 'Side project', 'Learning', 'Personal'].forEach(P);
  add('Prep client check-in', 'Work / Clients', { now: true, due: { date: day(0), time: null }, priority: 1 });
  add('Send draft proposal to Sam', 'Work / Clients', { now: true, due: { date: day(1), time: null }, duration: 90 });
  add('Review Q1 budget', 'Work', { due: { date: day(0), time: null }, duration: 60 });
  add('Update slides for planning', 'Work', { due: { date: day(2), time: null } });
  add('Apply: Product Manager, Northwind', 'Job search / Applications', { due: { date: day(-1), time: null }, priority: 2 });
  add('Follow up with Northwind recruiter', 'Job search / Networking', { due: { date: day(1), time: null } });
  add('Sketch landing page', 'Side project', { duration: 60 });
  add('Book flights for the holidays', 'Personal / Travel', { due: { date: day(4), time: null } });
  add('Renew passport', 'Personal / Admin', { due: { date: day(-3), time: null } });
  add('Spanish: 20 min practice', 'Learning', { recurring: 'weekday', due: { date: day(0), time: null } });
  add('Read chapter 4', 'Learning', { due: { date: day(2), time: null } });
  add('Gift ideas for mom', 'Inbox');
  add('Look into a standing desk', 'Inbox');
  store.save();
}

module.exports = { DemoGoogle, seedTasks };
