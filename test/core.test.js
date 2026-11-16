// Run: npm test   (TZ is pinned to New York so results match your PC)
const test = require('node:test');
const assert = require('node:assert');
const { parse, nextOccurrence } = require('../lib/parse');
const { findSlots } = require('../lib/slots');

const NOW = new Date(2026, 10, 10, 19, 0); // Tue Nov 10 2026, 7pm local
const projects = [
  { name: 'Work', sections: [{ name: 'Thesis' }] },
  { name: 'School', sections: [{ name: 'Classes' }, { name: 'Clubs' }] },
  { name: 'Recruiting: Tech', sections: [] },
];

test('date, time, project with spaces', () => {
  const r = parse('Call Sam fri 2pm #Work', { now: NOW, projects });
  assert.equal(r.content, 'Call Sam');
  assert.deepEqual(r.due, { date: '2026-11-13', time: '14:00' });
  assert.equal(r.project, 'Work');
});

test('section, priority, length, @Now', () => {
  const r = parse('STAT pset thu 7pm for 2h #School /Classes p1 @Now', { now: NOW, projects });
  assert.equal(r.content, 'STAT pset');
  assert.deepEqual(r.due, { date: '2026-11-12', time: '19:00' });
  assert.equal(r.duration, 120);
  assert.equal(r.section, 'Classes');
  assert.equal(r.priority, 1);
  assert.equal(r.now, true);
});

test('tom, next tue, nov 20, 11/20', () => {
  assert.equal(parse('x tom', { now: NOW }).due.date, '2026-11-11');
  assert.equal(parse('x next tue', { now: NOW }).due.date, '2026-11-17');
  assert.equal(parse('x next fri', { now: NOW }).due.date, '2026-11-20');
  assert.equal(parse('x nov 20', { now: NOW }).due.date, '2026-11-20');
  assert.equal(parse('x 11/20', { now: NOW }).due.date, '2026-11-20');
  assert.equal(parse('x today', { now: NOW }).due.date, '2026-11-10');
});

test('recurring and lengths', () => {
  const r = parse('Gym every mon for 1h30m', { now: NOW });
  assert.equal(r.recurring, 'mon');
  assert.equal(r.duration, 90);
  assert.equal(r.due.date, '2026-11-16');
  assert.equal(nextOccurrence('weekday', '2026-11-13'), '2026-11-16');
  assert.equal(nextOccurrence('mon', '2026-11-16'), '2026-11-23');
});

test('words that look like tokens stay in the title', () => {
  assert.equal(parse('Look for a new apartment', { now: NOW }).content, 'Look for a new apartment');
  assert.equal(parse('Email Monday Ventures', { now: NOW }).content, 'Email Ventures');
});

test('bare time already passed goes to tomorrow', () => {
  assert.deepEqual(parse('call mom 9am', { now: NOW }).due, { date: '2026-11-11', time: '09:00' });
});

test('slots skip busy time with a buffer and respect weekend hours', () => {
  const busy = [{ start: new Date(2026, 10, 11, 10, 0), end: new Date(2026, 10, 11, 11, 0) }];
  const days = findSlots({ busy, now: NOW, days: 5, lengthMin: 60, settings: {} });
  assert.equal(days.length, 5);
  assert.equal(days[0].date, '2026-11-10');
  // Today 7pm: earliest is 7:15 → first 30-min grid slot is 7:30pm, last 60m slot starts 8pm
  assert.deepEqual(days[0].slots.map((s) => new Date(s.start).getHours() + new Date(s.start).getMinutes() / 60), [19.5, 20]);
  const wed = days[1].slots.map((s) => new Date(s.start).getHours() + new Date(s.start).getMinutes() / 60);
  assert.ok(!wed.includes(9) && !wed.includes(9.5) && !wed.includes(10) && !wed.includes(10.5) && !wed.includes(11), 'busy 10-11 plus 10 min buffer blocks 9:00-11:00 starts');
  assert.ok(wed.includes(8.5) && wed.includes(11.5));
  const sat = days[4];
  assert.equal(sat.date, '2026-11-14');
  const lastSat = new Date(sat.slots.at(-1).end);
  assert.equal(lastSat.getHours(), 18);
});
