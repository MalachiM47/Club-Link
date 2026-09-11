import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterUpcomingEvents,
  getEventArchiveDate,
  formatRelativeDate,
  getPreviousEvents,
  initialsFromEmail,
  normalizeSearch,
  parseDate,
  toDatetimeLocalValue,
} from '../js/utils.js';

test('active events lead the schedule and completed events archive immediately', () => {
  const events=[
    {id:'upcoming',event_date:'2099-01-01T12:00:00Z'},
    {id:'live',event_date:'2099-01-02T12:00:00Z',status:'active'},
    {id:'ended',event_date:'2099-01-03T12:00:00Z',status:'completed'},
  ];
  const now=new Date('2099-01-01T10:00:00Z');
  assert.deepEqual(filterUpcomingEvents(events,'','all',now).map(e=>e.id),['live','upcoming']);
  assert.deepEqual(getPreviousEvents(events,now).map(e=>e.id),['ended']);
});

test('parseDate rejects invalid and empty values', () => {
  assert.equal(parseDate('not-a-date'), null);
  assert.equal(parseDate(''), null);
});

test('search normalization is case-insensitive and trims whitespace', () => {
  assert.equal(normalizeSearch('  Science FAIR '), 'science fair');
});

test('event filtering hides past events and searches all supported fields', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');
  const events = [
    { name: 'Past meeting', location: 'Room 1', description: '', event_date: '2026-09-06T12:00:00.000Z' },
    { name: 'Design workshop', location: 'Library', description: 'Bring a laptop', event_date: '2026-09-20T12:00:00.000Z' },
    { name: 'Service day', location: 'Courtyard', description: 'Community project', event_date: '2027-01-10T12:00:00.000Z' },
  ];

  assert.deepEqual(filterUpcomingEvents(events, '', 'all', now), [events[1], events[2]]);
  assert.deepEqual(filterUpcomingEvents(events, 'LIBRARY', 'all', now), [events[1]]);
  assert.deepEqual(filterUpcomingEvents(events, 'community', 'all', now), [events[2]]);
  assert.deepEqual(filterUpcomingEvents(events, '', '30', now), [events[1]]);
});

test('previous events include only passed schedule items in newest-first order', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');
  const events = [
    { name: 'Older meeting', event_date: '2026-08-01T12:00:00.000Z' },
    { name: 'Upcoming event', event_date: '2026-09-20T12:00:00.000Z' },
    { name: 'Recent workshop', event_date: '2026-09-06T12:00:00.000Z' },
  ];

  assert.deepEqual(getPreviousEvents(events, now), [events[2], events[0]]);
});

test('relative dates produce useful near-term labels', () => {
  const now = new Date(2026, 8, 7, 9, 0, 0);
  assert.equal(formatRelativeDate(new Date(2026, 8, 7, 18, 0, 0), now), 'Today');
  assert.equal(formatRelativeDate(new Date(2026, 8, 8, 18, 0, 0), now), 'Tomorrow');
});

test('datetime-local conversion preserves a usable local minute value', () => {
  assert.match(toDatetimeLocalValue('2026-09-20T18:30:00.000Z'), /^2026-09-20T\d{2}:30$/);
});

test('account avatar uses the first email character safely', () => {
  assert.equal(initialsFromEmail('officer@example.com'), 'O');
  assert.equal(initialsFromEmail(''), 'O');
});

test('events remain through their scheduled day and archive exactly at next midnight', () => {
  const event={name:'Meeting',event_date:new Date(2026,8,9,11,43).toISOString()};
  for(const now of [new Date(2026,8,9,11,43),new Date(2026,8,9,23,59,59,999)]) {
    assert.deepEqual(filterUpcomingEvents([event],'','all',now),[event]);
    assert.deepEqual(getPreviousEvents([event],now),[]);
  }
  const midnight=new Date(2026,8,10);
  assert.deepEqual(filterUpcomingEvents([event],'','all',midnight),[]);
  assert.deepEqual(getPreviousEvents([event],midnight),[event]);
});
test('archive cutoff follows calendar boundaries, including year rollover and DST dates', () => {
  for(const [year,month,day] of [[2026,11,31],[2026,2,8],[2026,10,1]]) {
    const eventDate=new Date(year,month,day,11);
    assert.equal(getEventArchiveDate(eventDate).getTime(),new Date(year,month,day+1).getTime());
  }
  assert.equal(getEventArchiveDate('invalid'),null);
});
