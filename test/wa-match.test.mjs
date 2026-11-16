// Run: npm test. The free WhatsApp event matcher (cloud/wa-match.js).
import test from 'node:test';
import assert from 'node:assert';
import { matchEvents, findDate, findTime, titleOf } from '../cloud/wa-match.js';

const sent = new Date(2026, 10, 13, 15, 0).getTime(); // Fri Nov 13 2026, 3pm
const msg = (body, extra = {}) => ({ chat: 'g1@g.us', id: String(Math.random()), sender: 'Ana', body, ts: sent, added: sent, ...extra });

test('dates', () => {
  assert.equal(findDate('sgd for wed 18th', sent), '2026-11-18');
  assert.equal(findDate('Dinner on Nov 20th', sent), '2026-11-20');
  assert.equal(findDate('20 November', sent), '2026-11-20');
  assert.equal(findDate('party 11/21!', sent), '2026-11-21');
  assert.equal(findDate('tonight at 8', sent), '2026-11-13');
  assert.equal(findDate('tmrw brunch', sent), '2026-11-14');
  assert.equal(findDate('this tuesday', sent), '2026-11-17');
  assert.equal(findDate('Friday drinks', sent), '2026-11-13');
  assert.equal(findDate('next fri', sent), '2026-11-20');
  assert.equal(findDate('1/2 of us are going', sent), '2027-01-02'); // valid m/d, but out of the 14-day window below
  assert.equal(findDate('no date here', sent), null);
});

test('times and titles', () => {
  assert.equal(findTime('starts 7:30 pm'), '19:30');
  assert.equal(findTime('at 12am'), '00:00');
  assert.equal(findTime('doors 18:00'), '18:00');
  assert.equal(findTime('see you'), null);
  assert.equal(titleOf('*🎉 Thanksgiving Potluck 🎉*\nBring a dish'), 'Thanksgiving Potluck');
});

test('matches real-looking events and skips the rest', () => {
  const now = sent;
  const out = matchEvents([
    msg('Ive just put sgd for wed 18th - collab with MENA and Europe club, 30 ppl. Come rep whalasa!'),
    msg('ISO 2 tickets for the formal on Nov 20, DM me'), // selling/looking for: skip
    msg('lol what is everyone doing tomorrow'), // no event word
    msg('Happy hour tonight at 7pm at the usual spot, RSVP by 5pm https://partiful.com/e/abc'),
    msg('Happy hour tonight at 7pm at the usual spot, RSVP by 5pm https://partiful.com/e/abc', { chat: 'g2@g.us' }), // cross-post
    msg('Dinner next month on Jan 30 for everyone in the club'), // outside 14 days
    msg('I will host a dinner Sat at 8pm', { sender: 'Me' }), // your own message
  ], now);
  assert.equal(out.length, 2);
  assert.equal(out[0].date, '2026-11-18');
  assert.match(out[0].title, /^Ive just put sgd/);
  assert.equal(out[1].date, '2026-11-13');
  assert.equal(out[1].time, '19:00');
  assert.equal(out[1].link, 'https://partiful.com/e/abc');
  assert.match(out[1].deadline, /RSVP by 5pm/);
});
