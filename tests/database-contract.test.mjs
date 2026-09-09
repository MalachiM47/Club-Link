import test from 'node:test';
import assert from 'node:assert/strict';
import {
  removeAnnouncement,
  removeEvent,
  removeMeetingOfficerNotes,
  saveAnnouncement,
  saveClubInformation,
  saveEvent,
  saveMeetingOfficerNotes,
} from '../js/database.js';

function createDatabaseMock() {
  const calls = [];
  class Query {
    constructor(table) {
      this.table = table;
    }

    record(method, value) {
      calls.push({ table: this.table, method, value });
      return this;
    }

    insert(value) { return this.record('insert', value); }
    update(value) { return this.record('update', value); }
    upsert(value, options) { return this.record('upsert', { value, options }); }
    delete() { return this.record('delete'); }
    eq(column, value) { return this.record('eq', { column, value }); }
    select(columns) { return this.record('select', columns); }
    async single() { this.record('single'); return { data: { id: 'saved-id' }, error: null }; }
  }

  return {
    calls,
    client: { from: (table) => new Query(table) },
  };
}

test('event create and update use sanitized payloads and the correct row', async () => {
  const created = createDatabaseMock();
  await saveEvent({
    id: '',
    event_type: 'other',
    name: '  Planning session  ',
    event_date: '2026-10-02T22:00:00.000Z',
    location: '  Library  ',
    description: '   ',
  }, created.client);
  assert.deepEqual(created.calls.slice(0, 2), [
    {
      table: 'events',
      method: 'insert',
      value: {
        event_type: 'other',
        name: 'Planning session',
        event_date: '2026-10-02T22:00:00.000Z',
        location: 'Library',
        description: null,
      },
    },
    { table: 'events', method: 'select', value: 'id' },
  ]);

  const updated = createDatabaseMock();
  await saveEvent({
    id: 'event-1',
    event_type: 'meeting',
    name: 'This value is ignored for meetings',
    event_date: '2026-10-03T22:00:00.000Z',
    location: 'Room 4',
    description: 'Bring notes',
  }, updated.client);
  assert.equal(updated.calls[0].method, 'update');
  assert.equal(updated.calls[0].value.event_type, 'meeting');
  assert.equal(updated.calls[0].value.name, 'Meeting');
  assert.deepEqual(updated.calls[1], { table: 'events', method: 'eq', value: { column: 'id', value: 'event-1' } });
});

test('private meeting notes are upserted or removed by event id', async () => {
  const saved = createDatabaseMock();
  await saveMeetingOfficerNotes('event-3', '  Review officer assignments.  ', saved.client);
  assert.deepEqual(saved.calls[0], {
    table: 'event_officer_details',
    method: 'upsert',
    value: {
      value: { event_id: 'event-3', notes: 'Review officer assignments.' },
      options: { onConflict: 'event_id' },
    },
  });

  const removed = createDatabaseMock();
  await removeMeetingOfficerNotes('event-3', removed.client);
  assert.deepEqual(removed.calls.slice(0, 2), [
    { table: 'event_officer_details', method: 'delete', value: undefined },
    { table: 'event_officer_details', method: 'eq', value: { column: 'event_id', value: 'event-3' } },
  ]);
});

test('event and announcement deletion target only the requested id', async () => {
  const eventDb = createDatabaseMock();
  await removeEvent('event-2', eventDb.client);
  assert.deepEqual(eventDb.calls.slice(0, 2), [
    { table: 'events', method: 'delete', value: undefined },
    { table: 'events', method: 'eq', value: { column: 'id', value: 'event-2' } },
  ]);

  const announcementDb = createDatabaseMock();
  await removeAnnouncement('announcement-2', announcementDb.client);
  assert.deepEqual(announcementDb.calls.slice(0, 2), [
    { table: 'announcements', method: 'delete', value: undefined },
    { table: 'announcements', method: 'eq', value: { column: 'id', value: 'announcement-2' } },
  ]);
});

test('announcement creation trims stored text', async () => {
  const mock = createDatabaseMock();
  await saveAnnouncement({ id: '', title: '  Reminder  ', body: '  Bring your form.  ' }, mock.client);
  assert.deepEqual(mock.calls[0], {
    table: 'announcements',
    method: 'insert',
    value: { title: 'Reminder', body: 'Bring your form.' },
  });
});

test('club settings upsert the singleton row', async () => {
  const clubDb = createDatabaseMock();
  await saveClubInformation({
    club_description: '  A clear description.  ',
    membership_info: '  Ask an officer.  ',
    contact_email: '  club@example.com  ',
  }, clubDb.client);
  assert.equal(clubDb.calls[0].value.value.id, 1);
  assert.equal(clubDb.calls[0].value.value.contact_email, 'club@example.com');
});

test('club name and palette persist together and unsupported palettes use the default', async () => {
  const mock = createDatabaseMock();
  await saveClubInformation({ club_name: '  Robotics Society  ', color_scheme: 'forest', club_description: 'Description', membership_info: 'Join us', contact_email: '' }, mock.client);
  assert.equal(mock.calls[0].value.value.club_name, 'Robotics Society');
  assert.equal(mock.calls[0].value.value.color_scheme, 'forest');
  const fallback = createDatabaseMock();
  await saveClubInformation({ club_name: ' ', color_scheme: 'unrecognized', club_description: 'Description', membership_info: 'Join us', contact_email: '' }, fallback.client);
  assert.equal(fallback.calls[0].value.value.club_name, 'Club Link');
  assert.equal(fallback.calls[0].value.value.color_scheme, 'default');
});

test('agenda and secretary notes save independently, including an empty agenda', async () => {
  const { saveMeetingDetails } = await import('../js/database.js');
  const mock = createDatabaseMock();
  await saveMeetingDetails('meeting-1', '', '  Decisions from the meeting  ', mock.client);
  assert.equal(mock.calls[0].table, 'event_officer_details');
  assert.equal(mock.calls[0].method, 'upsert');
  assert.deepEqual(mock.calls[0].value.value, {event_id:'meeting-1',notes:'',secretary_notes:'Decisions from the meeting'});
});
