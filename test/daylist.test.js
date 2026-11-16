// Run: npm test. Stars have no cap; date-only tasks for a day share one 8:30am Google block.
const test = require('node:test');
const assert = require('node:assert');
const { createCore } = require('../lib/core');
const { Store } = require('../lib/store');

function fakeGoogle() {
  const events = new Map(); let n = 0;
  return {
    events, connected: true, configured: true,
    async insertEvent(cal, body) { const id = `ev${++n}`; events.set(id, { ...body }); return { id }; },
    async patchEvent(cal, id, body) { if (!events.has(id)) throw new Error('gone'); events.set(id, { ...events.get(id), ...body }); return { id }; },
    async deleteEvent(cal, id) { events.delete(id); },
  };
}
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('day list block follows date-only tasks', async () => {
  const store = new Store({ data: null }), google = fakeGoogle();
  const core = createCore({ store, google });
  const d = day(3);
  await core.runOps([{ op: 'add', content: 'Call bank', due: d }, { op: 'add', content: 'Buy gift', due: d, project: 'Personal' }, { op: 'add', content: 'Booked thing', due: d, time: '14:00' }]);
  const lists = () => [...google.events.values()].filter((e) => /^Tasks \(/.test(e.summary));
  assert.equal(lists().length, 1);
  let ev = lists()[0];
  assert.equal(ev.summary, 'Tasks (2) [See Notes]');
  assert.match(ev.description, /Buy gift \(Personal\)/);
  assert.equal(new Date(ev.start.dateTime).getHours(), 8);
  assert.equal(new Date(ev.start.dateTime).getMinutes(), 30);
  await core.runOps([{ op: 'add', content: 'Return book', due: d }]);
  assert.equal(lists().length, 1);
  ev = lists()[0];
  assert.equal(ev.summary, 'Tasks (3) [See Notes]');
  await core.runOps([{ op: 'complete', match: 'Call bank' }, { op: 'complete', match: 'Buy gift' }, { op: 'update', match: 'Return book', due: '' }]);
  assert.equal(lists().length, 0);
});

test('stars have no cap and a date clears someday', async () => {
  const store = new Store({ data: null }), google = fakeGoogle();
  const core = createCore({ store, google });
  const r = await core.runOps([1, 2, 3, 4, 5].map((i) => ({ op: 'add', text: `Task ${i} @star` })));
  assert.equal(r.filter((x) => x.added.starred).length, 5);
  await core.runOps([{ op: 'add', content: 'Plan trip', someday: true }]);
  let [res] = await core.runOps([{ op: 'list', when: 'unsorted' }]);
  assert.equal(res.count, 0);
  [res] = await core.runOps([{ op: 'update', match: 'Plan trip', due: day(10) }]);
  assert.equal(res.updated.someday, false);
});

test('suggestions resolve project names and can be cleared', async () => {
  const store = new Store({ data: null }), google = fakeGoogle();
  const core = createCore({ store, google });
  await core.runOps([{ op: 'projects' }, { op: 'add', content: 'x', project: 'School' }, { op: 'add', content: 'gift for mom' }]);
  let [res] = await core.runOps([{ op: 'update', match: 'gift for mom', suggest: { project: 'School', due: day(2), content: 'Buy gift for mom' } }]);
  assert.equal(res.updated.suggest.content, 'Buy gift for mom');
  assert.ok(res.updated.suggest.projectId);
  [res] = await core.runOps([{ op: 'update', match: 'gift for mom', suggest: null }]);
  assert.equal(res.updated.suggest, null);
});

test('a date plus a time puts the task on the calendar', async () => {
  const store = new Store({ data: null }), google = fakeGoogle();
  const core = createCore({ store, google });
  const d = day(4);
  await core.runOps([{ op: 'add', content: 'Thesis deck', due: d, time: '16:00' }]);
  const t = store.tasks.find((x) => x.content === 'Thesis deck');
  assert.ok(t.event, 'timed task gets a block');
  const ev = google.events.get(t.event.eventId);
  assert.equal(ev.summary, 'Thesis deck');
  assert.equal(new Date(ev.start.dateTime).getHours(), 16);
  // Date only: no own block, goes into the 8:30 list instead
  await core.runOps([{ op: 'add', content: 'Call bank', due: d }]);
  assert.ok(!store.tasks.find((x) => x.content === 'Call bank').event);
  assert.equal([...google.events.values()].filter((e) => /Tasks \(1\)/.test(e.summary)).length, 1);
  // Edit panel path: PATCH with date + time
  const u = store.tasks.find((x) => x.content === 'Call bank');
  const res = await core.api('PATCH', new URL(`http://x/api/tasks/${u.id}`), { due: { date: d, time: '09:00' } });
  assert.equal(res.status, 200);
  assert.ok(u.event, 'edit with a time books it');
  assert.equal([...google.events.values()].filter((e) => /^Tasks \(/.test(e.summary)).length, 0, 'day list block goes away');
});
