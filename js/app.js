import {
  isSupabaseConfigured,
  loadOfficerMeetingDetails,
  loadPublicData,
  removeAnnouncement,
  removeEvent,
  removeMeetingOfficerNotes,
  saveAnnouncement,
  saveClubInformation,
  saveEvent,
  saveMeetingOfficerNotes,
} from './database.js';
import { getAuthState, signInOfficer, signOutOfficer, watchAuthState } from './auth.js';
import {
  filterUpcomingEvents,
  formatDate,
  formatDateTime,
  formatRelativeDate,
  formatTime,
  getPreviousEvents,
  initialsFromEmail,
  parseDate,
  toDatetimeLocalValue,
} from './utils.js';

const state = {
  events: [],
  announcements: [],
  settings: null,
  user: null,
  officer: null,
  dataError: null,
  pendingDelete: null,
  meetingDetails: new Map(),
  meetingDetailsError: null,
};

const buttonContents = new WeakMap();
let scheduleTransitionTimer = null;

const elements = {
  configurationBanner: document.querySelector('#configuration-banner'),
  todayDate: document.querySelector('#today-date'),
  meetingMonth: document.querySelector('#meeting-month'),
  meetingDay: document.querySelector('#meeting-day'),
  meetingTitle: document.querySelector('#meeting-card-title'),
  meetingSchedule: document.querySelector('#meeting-schedule'),
  meetingTime: document.querySelector('#meeting-time'),
  meetingLocation: document.querySelector('#meeting-location'),
  meetingNote: document.querySelector('#meeting-note'),
  nextEventOfficerNotes: document.querySelector('#next-event-officer-notes'),
  dashboardEvents: document.querySelector('#dashboard-events'),
  dashboardAnnouncement: document.querySelector('#dashboard-announcement'),
  eventsList: document.querySelector('#events-list'),
  previousEventsList: document.querySelector('#previous-events-list'),
  announcementsList: document.querySelector('#announcements-list'),
  eventSearch: document.querySelector('#event-search'),
  eventRange: document.querySelector('#event-range'),
  eventResultCount: document.querySelector('#event-result-count'),
  clubDescription: document.querySelector('#club-description'),
  membershipInfo: document.querySelector('#membership-info'),
  contactInfo: document.querySelector('#contact-info'),
  contactLink: document.querySelector('#contact-link'),
  signedOutPanel: document.querySelector('#signed-out-panel'),
  signedInPanel: document.querySelector('#signed-in-panel'),
  accountEmail: document.querySelector('#account-email'),
  accountRole: document.querySelector('#account-role'),
  accountAvatar: document.querySelector('#account-avatar'),
  accessNote: document.querySelector('#access-note'),
  sidebar: document.querySelector('#sidebar'),
  sidebarScrim: document.querySelector('#sidebar-scrim'),
  menuButton: document.querySelector('#menu-button'),
  toastRegion: document.querySelector('#toast-region'),
  editNextEventButton: document.querySelector('#edit-next-event-button'),
  eventType: document.querySelector('#event-type'),
  eventNameField: document.querySelector('#event-name-field'),
  eventName: document.querySelector('#event-name'),
  meetingOfficerNotesField: document.querySelector('#meeting-officer-notes-field'),
  meetingOfficerNotes: document.querySelector('#meeting-officer-notes'),
};

function createIcon(symbol) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbol}`);
  svg.append(use);
  return svg;
}

function createEmptyState(title, copy, icon = 'icon-calendar') {
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  const content = document.createElement('div');
  content.className = 'empty-state-content';
  const iconBox = document.createElement('span');
  iconBox.className = 'empty-icon';
  iconBox.append(createIcon(icon));
  const heading = document.createElement('h3');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = copy;
  content.append(iconBox, heading, paragraph);
  wrapper.append(content);
  return wrapper;
}

function createCompactEmpty(copy) {
  const empty = document.createElement('div');
  empty.className = 'empty-compact';
  empty.textContent = copy;
  return empty;
}

function createErrorState(copy) {
  const wrapper = document.createElement('div');
  wrapper.className = 'error-state';
  const content = document.createElement('div');
  content.className = 'empty-state-content';
  const heading = document.createElement('h3');
  heading.textContent = 'Information could not be loaded';
  const paragraph = document.createElement('p');
  paragraph.textContent = copy;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-secondary';
  retry.textContent = 'Try again';
  retry.addEventListener('click', refreshPublicData);
  content.append(heading, paragraph, retry);
  wrapper.append(content);
  return wrapper;
}

function setLoadingState() {
  const eventSkeleton = document.createElement('div');
  eventSkeleton.className = 'skeleton-list';
  for (let i = 0; i < 3; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    eventSkeleton.append(card);
  }
  elements.eventsList.replaceChildren(eventSkeleton);

  elements.previousEventsList.setAttribute('aria-busy', 'true');
  elements.previousEventsList.replaceChildren(createCompactEmpty('Loading previous events…'));

  const announcementSkeleton = document.createElement('div');
  announcementSkeleton.className = 'skeleton-list';
  for (let i = 0; i < 2; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    announcementSkeleton.append(card);
  }
  elements.announcementsList.replaceChildren(announcementSkeleton);
  elements.dashboardEvents.replaceChildren(createCompactEmpty('Loading upcoming events…'));
  elements.dashboardAnnouncement.replaceChildren(createCompactEmpty('Loading the latest update…'));
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  dot.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.textContent = message;
  toast.append(dot, copy);
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function friendlyError(error, fallback) {
  if (error?.code === '42501' || /row-level security|permission denied/i.test(error?.message ?? '')) {
    return 'Your account does not have officer permission for that action.';
  }
  if (/failed to fetch|network/i.test(error?.message ?? '')) {
    return 'Club Link could not reach Supabase. Check your connection and try again.';
  }
  return fallback;
}

function getNextEvent() {
  return filterUpcomingEvents(state.events, '', 'all')[0] ?? null;
}

function createOfficerNotes(event, dark = false) {
  if (!state.officer || event?.event_type !== 'meeting') return null;

  const details = document.createElement('details');
  details.className = `officer-notes${dark ? ' officer-notes-dark' : ''}`;
  const summary = document.createElement('summary');
  summary.textContent = 'Officer notes';
  const body = document.createElement('div');
  body.className = 'officer-notes-body';
  const note = document.createElement('p');
  note.textContent = state.meetingDetailsError
    ? 'Private notes could not be loaded.'
    : state.meetingDetails.get(event.id)?.notes || 'No private notes have been added.';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = dark ? 'button button-on-dark' : 'button button-secondary';
  edit.textContent = 'Edit meeting details';
  edit.addEventListener('click', () => openEventDialog(event));
  body.append(note, edit);
  details.append(summary, body);
  return details;
}

function scheduleNextEventTransition() {
  window.clearTimeout(scheduleTransitionTimer);
  scheduleTransitionTimer = null;
  const nextEventDate = parseDate(getNextEvent()?.event_date);
  if (!nextEventDate) return;

  const millisecondsUntilPast = Math.max(0, nextEventDate.getTime() - Date.now() + 250);
  scheduleTransitionTimer = window.setTimeout(
    renderAll,
    Math.min(millisecondsUntilPast, 2147483647),
  );
}

function renderNextEvent() {
  const nextEvent = getNextEvent();
  const eventDate = parseDate(nextEvent?.event_date);

  if (state.dataError) {
    elements.nextEventOfficerNotes.replaceChildren();
    elements.nextEventOfficerNotes.hidden = true;
    elements.meetingMonth.textContent = 'STATUS';
    elements.meetingDay.textContent = '!';
    elements.meetingTitle.textContent = 'Schedule details are unavailable';
    elements.meetingSchedule.textContent = 'Club Link could not load the shared club schedule.';
    elements.meetingTime.textContent = 'Try again below';
    elements.meetingLocation.textContent = 'No location available';
    elements.meetingNote.textContent = '';
    elements.meetingNote.hidden = true;
    elements.editNextEventButton.hidden = true;
    return;
  }

  elements.meetingMonth.textContent = eventDate
    ? new Intl.DateTimeFormat(undefined, { month: 'short' }).format(eventDate).toUpperCase()
    : 'NEXT';
  elements.meetingDay.textContent = eventDate ? String(eventDate.getDate()).padStart(2, '0') : '--';
  elements.meetingTitle.textContent = nextEvent?.name || 'No upcoming event has been scheduled';
  elements.meetingSchedule.textContent = eventDate
    ? formatDateTime(eventDate)
    : 'Meetings and events will appear here when officers add them.';
  elements.meetingTime.textContent = eventDate ? formatTime(eventDate) : 'No date scheduled';
  elements.meetingLocation.textContent = nextEvent?.location || 'No location scheduled';
  elements.meetingNote.textContent = nextEvent?.description || '';
  elements.meetingNote.hidden = !nextEvent?.description;
  elements.nextEventOfficerNotes.replaceChildren();
  const officerNotes = createOfficerNotes(nextEvent, true);
  if (officerNotes) elements.nextEventOfficerNotes.append(officerNotes);
  elements.nextEventOfficerNotes.hidden = !officerNotes;
  elements.editNextEventButton.hidden = !(state.officer && nextEvent);
}

function renderDashboardEvents() {
  elements.dashboardEvents.replaceChildren();
  const upcoming = filterUpcomingEvents(state.events, '', 'all').slice(0, 3);
  if (state.dataError) {
    elements.dashboardEvents.append(createCompactEmpty('Upcoming events are temporarily unavailable.'));
    return;
  }
  if (!upcoming.length) {
    elements.dashboardEvents.append(createCompactEmpty('No upcoming events have been posted.'));
    return;
  }

  upcoming.forEach((event) => {
    const date = parseDate(event.event_date);
    const item = document.createElement('article');
    item.className = 'compact-event';
    const dateBox = document.createElement('time');
    dateBox.className = 'compact-date';
    dateBox.dateTime = event.event_date;
    const month = document.createElement('span');
    month.textContent = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
    const day = document.createElement('strong');
    day.textContent = String(date.getDate());
    dateBox.append(month, day);
    const copy = document.createElement('div');
    copy.className = 'compact-copy';
    const title = document.createElement('strong');
    title.textContent = event.name;
    const meta = document.createElement('span');
    meta.textContent = `${formatTime(date)} · ${event.location}`;
    copy.append(title, meta);
    item.append(dateBox, copy);
    elements.dashboardEvents.append(item);
  });
}

function renderDashboardAnnouncement() {
  elements.dashboardAnnouncement.replaceChildren();
  if (state.dataError) {
    elements.dashboardAnnouncement.append(createCompactEmpty('Announcements are temporarily unavailable.'));
    return;
  }
  const announcement = state.announcements[0];
  if (!announcement) {
    elements.dashboardAnnouncement.append(createCompactEmpty('No announcements have been posted.'));
    return;
  }
  const heading = document.createElement('h3');
  heading.textContent = announcement.title;
  const time = document.createElement('time');
  time.dateTime = announcement.posted_at;
  time.textContent = `Posted ${formatDate(announcement.posted_at)}`;
  const body = document.createElement('p');
  body.textContent = announcement.body;
  elements.dashboardAnnouncement.append(heading, time, body);
}

function createCardActions(onEdit, onDelete, itemLabel) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'card-action';
  edit.setAttribute('aria-label', `Edit ${itemLabel}`);
  edit.append(createIcon('icon-edit'));
  edit.addEventListener('click', onEdit);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'card-action danger';
  remove.setAttribute('aria-label', `Delete ${itemLabel}`);
  remove.append(createIcon('icon-trash'));
  remove.addEventListener('click', onDelete);
  actions.append(edit, remove);
  return actions;
}

function renderEvents() {
  elements.eventsList.replaceChildren();
  elements.eventsList.setAttribute('aria-busy', 'false');

  if (state.dataError) {
    elements.eventResultCount.textContent = '';
    elements.eventsList.append(createErrorState('Check the Supabase project values and database setup, then try again.'));
    return;
  }

  const events = filterUpcomingEvents(
    state.events,
    elements.eventSearch.value,
    elements.eventRange.value,
  );
  elements.eventResultCount.textContent = events.length
    ? `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}`
    : '';

  if (!events.length) {
    const isFiltering = Boolean(elements.eventSearch.value.trim()) || elements.eventRange.value !== 'all';
    elements.eventsList.append(createEmptyState(
      isFiltering ? 'No events match those filters' : 'No upcoming events yet',
      isFiltering ? 'Try a different search or date range.' : 'When an officer adds an event, it will appear here in date order.',
      'icon-calendar',
    ));
    return;
  }

  events.forEach((event) => {
    const date = parseDate(event.event_date);
    const card = document.createElement('article');
    card.className = 'event-card';

    const top = document.createElement('div');
    top.className = 'event-card-top';
    const dateLabel = document.createElement('time');
    dateLabel.className = 'event-date';
    dateLabel.dateTime = event.event_date;
    const day = document.createElement('strong');
    day.textContent = String(date.getDate()).padStart(2, '0');
    const month = document.createElement('span');
    month.textContent = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
    dateLabel.append(day, month);
    top.append(dateLabel);
    if (state.officer) {
      top.append(createCardActions(
        () => openEventDialog(event),
        () => requestDelete('event', event),
        event.name,
      ));
    }

    const title = document.createElement('h3');
    title.textContent = event.name;
    card.append(top, title);
    if (event.description) {
      const description = document.createElement('p');
      description.className = 'event-card-description';
      description.textContent = event.description;
      card.append(description);
    }

    const details = document.createElement('div');
    details.className = 'event-details';
    const when = document.createElement('span');
    when.append(createIcon('icon-clock'));
    const whenText = document.createElement('span');
    whenText.textContent = `${formatRelativeDate(date)} at ${formatTime(date)}`;
    when.append(whenText);
    const where = document.createElement('span');
    where.append(createIcon('icon-pin'));
    const whereText = document.createElement('span');
    whereText.textContent = event.location;
    where.append(whereText);
    details.append(when, where);
    card.append(details);
    const officerNotes = createOfficerNotes(event);
    if (officerNotes) card.append(officerNotes);
    elements.eventsList.append(card);
  });
}

function renderPreviousEvents() {
  elements.previousEventsList.replaceChildren();
  elements.previousEventsList.setAttribute('aria-busy', 'false');

  if (state.dataError) {
    elements.previousEventsList.append(createCompactEmpty('Previous events are temporarily unavailable.'));
    return;
  }

  const events = getPreviousEvents(state.events);
  if (!events.length) {
    elements.previousEventsList.append(createCompactEmpty('Previous schedule items will appear here after they have passed.'));
    return;
  }

  events.forEach((event) => {
    const date = parseDate(event.event_date);
    const row = document.createElement('article');
    row.className = 'previous-event-row';

    const dateLabel = document.createElement('time');
    dateLabel.className = 'previous-event-date';
    dateLabel.dateTime = event.event_date;
    dateLabel.textContent = formatDate(date);

    const content = document.createElement('div');
    content.className = 'previous-event-content';
    const heading = document.createElement('h4');
    heading.textContent = event.name;
    const meta = document.createElement('p');
    meta.className = 'previous-event-meta';
    meta.textContent = `${formatTime(date)} · ${event.location}`;
    content.append(heading, meta);
    if (event.description) {
      const description = document.createElement('p');
      description.className = 'previous-event-description';
      description.textContent = event.description;
      content.append(description);
    }
    const officerNotes = createOfficerNotes(event);
    if (officerNotes) content.append(officerNotes);

    row.append(dateLabel, content);
    if (state.officer) {
      row.append(createCardActions(
        () => openEventDialog(event),
        () => requestDelete('event', event),
        event.name,
      ));
    }
    elements.previousEventsList.append(row);
  });
}

function renderAnnouncements() {
  elements.announcementsList.replaceChildren();
  elements.announcementsList.setAttribute('aria-busy', 'false');

  if (state.dataError) {
    elements.announcementsList.append(createErrorState('Check the Supabase project values and database setup, then try again.'));
    return;
  }
  if (!state.announcements.length) {
    elements.announcementsList.append(createEmptyState(
      'No announcements yet',
      'Officer updates and reminders will appear here, with the newest post first.',
      'icon-bell',
    ));
    return;
  }

  state.announcements.forEach((announcement) => {
    const card = document.createElement('article');
    card.className = 'announcement-card';
    const time = document.createElement('time');
    time.className = 'announcement-date';
    time.dateTime = announcement.posted_at;
    time.textContent = formatDate(announcement.posted_at);
    const content = document.createElement('div');
    content.className = 'announcement-content';
    const heading = document.createElement('h3');
    heading.textContent = announcement.title;
    const body = document.createElement('p');
    body.className = 'announcement-body';
    body.textContent = announcement.body;
    content.append(heading, body);
    card.append(time, content);
    if (state.officer) {
      card.append(createCardActions(
        () => openAnnouncementDialog(announcement),
        () => requestDelete('announcement', announcement),
        announcement.title,
      ));
    }
    elements.announcementsList.append(card);
  });
}

function renderClubInformation() {
  elements.clubDescription.textContent = state.settings?.club_description
    || 'Club details will be posted here after the site is connected.';
  elements.membershipInfo.textContent = state.settings?.membership_info
    || 'Membership information has not been posted yet.';

  const email = state.settings?.contact_email;
  elements.contactInfo.textContent = email ? 'Questions about meetings or membership?' : 'A club contact has not been posted yet.';
  elements.contactLink.hidden = !email;
  if (email) {
    elements.contactLink.href = `mailto:${email}`;
    elements.contactLink.querySelector('span').textContent = email;
  } else {
    elements.contactLink.removeAttribute('href');
    elements.contactLink.querySelector('span').textContent = '';
  }
}

function renderAuthState() {
  const isSignedIn = Boolean(state.user);
  elements.signedOutPanel.hidden = isSignedIn;
  elements.signedInPanel.hidden = !isSignedIn;
  document.querySelectorAll('[data-admin-only]').forEach((element) => {
    element.hidden = !state.officer;
  });

  if (isSignedIn) {
    elements.accountEmail.textContent = state.user.email || 'Signed-in account';
    elements.accountAvatar.textContent = initialsFromEmail(state.user.email);
    elements.accountRole.textContent = state.officer
      ? state.officer.role === 'admin' ? 'Club admin' : 'Club officer'
      : 'Signed in';
    elements.accessNote.textContent = state.officer
      ? 'Publishing controls are available.'
      : 'This account is not on the officer access list.';
  }

  renderEvents();
  renderPreviousEvents();
  renderAnnouncements();
  elements.editNextEventButton.hidden = !(state.officer && getNextEvent());
}

function renderAll() {
  renderNextEvent();
  renderDashboardEvents();
  renderDashboardAnnouncement();
  renderClubInformation();
  renderAuthState();
  updateActiveNavigation();
  scheduleNextEventTransition();
}

async function refreshOfficerMeetingDetails() {
  state.meetingDetails = new Map();
  state.meetingDetailsError = null;
  if (!state.officer || !isSupabaseConfigured) return;

  try {
    const details = await loadOfficerMeetingDetails();
    state.meetingDetails = new Map(details.map((item) => [item.event_id, item]));
  } catch (error) {
    console.error('Private meeting details could not be loaded:', error);
    state.meetingDetailsError = error;
  }
}

async function refreshPublicData() {
  if (!isSupabaseConfigured) {
    state.dataError = null;
    state.events = [];
    state.announcements = [];
    state.settings = null;
    state.meetingDetails = new Map();
    state.meetingDetailsError = null;
    renderAll();
    return;
  }

  setLoadingState();
  try {
    const data = await loadPublicData();
    state.events = data.events;
    state.announcements = data.announcements;
    state.settings = data.settings;
    state.dataError = null;
    await refreshOfficerMeetingDetails();
  } catch (error) {
    console.error('Club Link data load failed:', error);
    state.dataError = error;
  }
  renderAll();
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function resetFormError(id) {
  const error = document.querySelector(id);
  error.textContent = '';
  error.hidden = true;
}

function setFormError(id, message) {
  const error = document.querySelector(id);
  error.textContent = message;
  error.hidden = false;
}

function setSubmitBusy(button, busy, busyLabel) {
  if (busy) {
    buttonContents.set(button, [...button.childNodes].map((node) => node.cloneNode(true)));
    button.replaceChildren(document.createTextNode(busyLabel));
    button.disabled = true;
  } else {
    const original = buttonContents.get(button);
    if (original) button.replaceChildren(...original);
    buttonContents.delete(button);
    button.disabled = false;
  }
}

function requireOfficer() {
  if (state.officer) return true;
  showToast('Officer permission is required for that action.', 'error');
  return false;
}

function syncEventTypeFields() {
  const isMeeting = elements.eventType.value === 'meeting';
  elements.eventNameField.hidden = isMeeting;
  elements.eventName.disabled = isMeeting;
  elements.eventName.required = !isMeeting;
  elements.meetingOfficerNotesField.hidden = !isMeeting;
  elements.meetingOfficerNotes.disabled = !isMeeting;
}

function openEventDialog(event = null) {
  if (!requireOfficer()) return;
  const form = document.querySelector('#event-form');
  form.reset();
  resetFormError('#event-error');
  document.querySelector('#event-dialog-title').textContent = event ? 'Edit schedule item' : 'Add event or meeting';
  document.querySelector('#event-submit').textContent = event ? 'Save changes' : 'Add to schedule';
  document.querySelector('#event-id').value = event?.id || '';
  elements.eventType.value = event?.event_type === 'meeting' ? 'meeting' : event ? 'other' : 'meeting';
  elements.eventName.value = event?.event_type === 'meeting' ? '' : event?.name || '';
  document.querySelector('#event-date').value = toDatetimeLocalValue(event?.event_date);
  document.querySelector('#event-location').value = event?.location || '';
  document.querySelector('#event-description').value = event?.description || '';
  elements.meetingOfficerNotes.value = event ? state.meetingDetails.get(event.id)?.notes || '' : '';
  syncEventTypeFields();
  openDialog(document.querySelector('#event-dialog'));
}

function openAnnouncementDialog(announcement = null) {
  if (!requireOfficer()) return;
  const form = document.querySelector('#announcement-form');
  form.reset();
  resetFormError('#announcement-error');
  document.querySelector('#announcement-dialog-title').textContent = announcement ? 'Edit announcement' : 'New announcement';
  document.querySelector('#announcement-submit').textContent = announcement ? 'Save changes' : 'Publish announcement';
  document.querySelector('#announcement-id').value = announcement?.id || '';
  document.querySelector('#announcement-title').value = announcement?.title || '';
  document.querySelector('#announcement-body').value = announcement?.body || '';
  openDialog(document.querySelector('#announcement-dialog'));
}

function openClubDialog() {
  if (!requireOfficer()) return;
  resetFormError('#club-error');
  document.querySelector('#club-description-input').value = state.settings?.club_description || '';
  document.querySelector('#membership-info-input').value = state.settings?.membership_info || '';
  document.querySelector('#contact-email-input').value = state.settings?.contact_email || '';
  openDialog(document.querySelector('#club-dialog'));
}

function requestDelete(type, item) {
  if (!requireOfficer()) return;
  const label = type === 'event' ? item.name : item.title;
  document.querySelector('#confirm-dialog-title').textContent = type === 'event' ? 'Delete schedule item?' : 'Delete announcement?';
  document.querySelector('#confirm-dialog-copy').textContent = `“${label}” will be permanently removed.`;
  state.pendingDelete = { type, item };
  openDialog(document.querySelector('#confirm-dialog'));
}

async function confirmDelete() {
  if (!state.pendingDelete || !requireOfficer()) return;
  const button = document.querySelector('#confirm-delete-button');
  const { type, item } = state.pendingDelete;
  setSubmitBusy(button, true, 'Deleting…');
  try {
    if (type === 'event') await removeEvent(item.id);
    else await removeAnnouncement(item.id);
    state.pendingDelete = null;
    closeDialog(document.querySelector('#confirm-dialog'));
    await refreshPublicData();
    showToast(`${type === 'event' ? 'Schedule item' : 'Announcement'} deleted.`);
  } catch (error) {
    console.error('Delete failed:', error);
    showToast(friendlyError(error, 'The item could not be deleted. Try again.'), 'error');
  } finally {
    setSubmitBusy(button, false);
  }
}

async function handleEventSubmit(event) {
  event.preventDefault();
  if (!requireOfficer()) return;
  resetFormError('#event-error');
  const form = event.currentTarget;
  const submit = document.querySelector('#event-submit');
  const data = new FormData(form);
  const eventId = data.get('id');
  const eventType = data.get('event_type');
  if (!['meeting', 'other'].includes(eventType)) {
    setFormError('#event-error', 'Choose Meeting or Other.');
    return;
  }
  const localDate = data.get('event_date');
  const parsedDate = parseDate(localDate);
  if (!parsedDate) {
    setFormError('#event-error', 'Enter a valid event date and time.');
    return;
  }
  if (!eventId && parsedDate < new Date()) {
    setFormError('#event-error', 'New schedule items need a future date and time.');
    return;
  }

  setSubmitBusy(submit, true, 'Saving…');
  try {
    const savedEvent = await saveEvent({
      id: eventId,
      event_type: eventType,
      name: data.get('name'),
      event_date: parsedDate.toISOString(),
      location: data.get('location'),
      description: data.get('description'),
    });
    const savedEventId = savedEvent.id;
    if (eventType === 'meeting') {
      await saveMeetingOfficerNotes(savedEventId, data.get('officer_notes') || '');
    } else if (eventId) {
      await removeMeetingOfficerNotes(eventId);
    }
    const wasEditing = Boolean(eventId);
    form.reset();
    closeDialog(document.querySelector('#event-dialog'));
    await refreshPublicData();
    showToast(wasEditing ? 'Schedule item updated.' : 'Schedule item added.');
  } catch (error) {
    console.error('Event save failed:', error);
    setFormError('#event-error', friendlyError(error, 'The event could not be saved. Check the fields and try again.'));
  } finally {
    setSubmitBusy(submit, false);
  }
}

async function handleAnnouncementSubmit(event) {
  event.preventDefault();
  if (!requireOfficer()) return;
  resetFormError('#announcement-error');
  const form = event.currentTarget;
  const submit = document.querySelector('#announcement-submit');
  const data = new FormData(form);
  setSubmitBusy(submit, true, 'Publishing…');
  try {
    await saveAnnouncement({
      id: data.get('id'),
      title: data.get('title'),
      body: data.get('body'),
    });
    const wasEditing = Boolean(data.get('id'));
    form.reset();
    closeDialog(document.querySelector('#announcement-dialog'));
    await refreshPublicData();
    showToast(wasEditing ? 'Announcement updated.' : 'Announcement published.');
  } catch (error) {
    console.error('Announcement save failed:', error);
    setFormError('#announcement-error', friendlyError(error, 'The announcement could not be saved. Try again.'));
  } finally {
    setSubmitBusy(submit, false);
  }
}

async function handleClubSubmit(event) {
  event.preventDefault();
  if (!requireOfficer()) return;
  resetFormError('#club-error');
  const submit = document.querySelector('#club-submit');
  const data = new FormData(event.currentTarget);
  setSubmitBusy(submit, true, 'Saving…');
  try {
    await saveClubInformation({
      club_description: data.get('club_description'),
      membership_info: data.get('membership_info'),
      contact_email: data.get('contact_email'),
    });
    closeDialog(document.querySelector('#club-dialog'));
    await refreshPublicData();
    showToast('Club information updated.');
  } catch (error) {
    console.error('Club information save failed:', error);
    setFormError('#club-error', friendlyError(error, 'The club information could not be saved. Try again.'));
  } finally {
    setSubmitBusy(submit, false);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  resetFormError('#auth-error');
  if (!isSupabaseConfigured) {
    setFormError('#auth-error', 'Connect Supabase in js/config.js before signing in.');
    return;
  }
  const form = event.currentTarget;
  const submit = document.querySelector('#auth-submit');
  const data = new FormData(form);
  setSubmitBusy(submit, true, 'Signing in…');
  try {
    const authState = await signInOfficer(data.get('email'), data.get('password'));
    state.user = authState.user;
    state.officer = authState.officer;
    await refreshOfficerMeetingDetails();
    form.reset();
    closeDialog(document.querySelector('#auth-dialog'));
    renderAll();
    if (state.officer) showToast('Officer controls are now available.');
    else showToast('Signed in, but this account is not authorized as an officer.', 'error');
  } catch (error) {
    console.error('[Club Link] Officer sign-in flow failed.', {
      code: error?.code ?? null,
      message: error?.message ?? 'Unknown sign-in error',
    });
    setFormError('#auth-error', 'The email or password was not accepted. Check both and try again.');
  } finally {
    setSubmitBusy(submit, false);
  }
}

async function handleSignOut() {
  const button = document.querySelector('#sign-out-button');
  setSubmitBusy(button, true, 'Signing out…');
  try {
    await signOutOfficer();
    state.user = null;
    state.officer = null;
    state.meetingDetails = new Map();
    state.meetingDetailsError = null;
    renderAll();
    closeMobileNav();
    showToast('Signed out.');
  } catch (error) {
    console.error('Sign out failed:', error);
    showToast('Sign out did not finish. Try again.', 'error');
  } finally {
    setSubmitBusy(button, false);
  }
}

function openMobileNav() {
  elements.sidebar.classList.add('is-open');
  elements.sidebarScrim.classList.add('is-visible');
  elements.menuButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
  document.querySelector('#sidebar-close').focus();
}

function closeMobileNav() {
  const wasOpen = elements.sidebar.classList.contains('is-open');
  elements.sidebar.classList.remove('is-open');
  elements.sidebarScrim.classList.remove('is-visible');
  elements.menuButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
  if (wasOpen && window.innerWidth <= 860) elements.menuButton.focus();
}

function initializeDialogs() {
  document.querySelectorAll('.dialog').forEach((dialog) => {
    dialog.querySelectorAll('.dialog-close, .dialog-cancel').forEach((button) => {
      button.addEventListener('click', () => closeDialog(dialog));
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => {
      if (dialog.id === 'confirm-dialog') state.pendingDelete = null;
    });
  });
}

let navigationFrame = null;

function updateActiveNavigation() {
  const sections = [...document.querySelectorAll('.page-section')];
  if (!sections.length) return;

  const atPageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  let activeSection = atPageBottom ? sections.at(-1) : sections[0];
  if (!atPageBottom) {
    const activationLine = window.innerWidth <= 860 ? 176 : 88;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= activationLine) activeSection = section;
      else break;
    }
  }

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.section === activeSection.id);
  });
}

function queueNavigationUpdate() {
  if (navigationFrame !== null) return;
  navigationFrame = window.requestAnimationFrame(() => {
    navigationFrame = null;
    updateActiveNavigation();
  });
}

function initializeNavigation() {
  elements.menuButton.addEventListener('click', openMobileNav);
  document.querySelector('#sidebar-close').addEventListener('click', closeMobileNav);
  elements.sidebarScrim.addEventListener('click', closeMobileNav);
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('is-active'));
      link.classList.add('is-active');
      closeMobileNav();
    });
  });

  window.addEventListener('scroll', queueNavigationUpdate, { passive: true });
  window.addEventListener('resize', queueNavigationUpdate);
  updateActiveNavigation();
}

function initializeActions() {
  document.querySelector('#open-auth-button').addEventListener('click', () => {
    resetFormError('#auth-error');
    const notice = document.querySelector('#auth-config-notice');
    const submit = document.querySelector('#auth-submit');
    notice.hidden = isSupabaseConfigured;
    submit.disabled = !isSupabaseConfigured;
    openDialog(document.querySelector('#auth-dialog'));
  });
  document.querySelector('#sign-out-button').addEventListener('click', handleSignOut);
  document.querySelector('#add-event-button').addEventListener('click', () => openEventDialog());
  document.querySelector('#add-announcement-button').addEventListener('click', () => openAnnouncementDialog());
  elements.editNextEventButton.addEventListener('click', () => {
    const nextEvent = getNextEvent();
    if (nextEvent) openEventDialog(nextEvent);
  });
  document.querySelector('#edit-club-button').addEventListener('click', openClubDialog);
  document.querySelector('#confirm-delete-button').addEventListener('click', confirmDelete);

  document.querySelector('#auth-form').addEventListener('submit', handleAuthSubmit);
  document.querySelector('#event-form').addEventListener('submit', handleEventSubmit);
  document.querySelector('#announcement-form').addEventListener('submit', handleAnnouncementSubmit);
  document.querySelector('#club-form').addEventListener('submit', handleClubSubmit);

  elements.eventSearch.addEventListener('input', renderEvents);
  elements.eventRange.addEventListener('change', renderEvents);
  elements.eventType.addEventListener('change', syncEventTypeFields);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) closeMobileNav();
  });
}

function initializeWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const registration = context.registerTool({
    name: 'get_club_overview',
    title: 'Get club overview',
    description: 'Read the closest scheduled event, upcoming schedule, previous events, and latest announcement from Club Link.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute() {
      const nextEvent = getNextEvent();
      return {
        nextEvent: nextEvent ? {
          type: nextEvent.event_type,
          name: nextEvent.name,
          date: nextEvent.event_date,
          location: nextEvent.location,
          description: nextEvent.description,
        } : null,
        upcomingEvents: filterUpcomingEvents(state.events, '', 'all').map((event) => ({
          type: event.event_type,
          name: event.name,
          date: event.event_date,
          location: event.location,
          description: event.description,
        })),
        previousEvents: getPreviousEvents(state.events).map((event) => ({
          type: event.event_type,
          name: event.name,
          date: event.event_date,
          location: event.location,
          description: event.description,
        })),
        latestAnnouncement: state.announcements[0] ? {
          title: state.announcements[0].title,
          body: state.announcements[0].body,
          postedAt: state.announcements[0].posted_at,
        } : null,
      };
    },
  });

  Promise.resolve(registration).catch((error) => {
    console.warn('Club Link WebMCP tool registration failed:', error);
  });
}

async function initialize() {
  elements.todayDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'long', day: 'numeric',
  }).format(new Date());
  elements.configurationBanner.hidden = isSupabaseConfigured;
  initializeDialogs();
  initializeNavigation();
  initializeActions();
  initializeWebMcp();
  setLoadingState();

  if (isSupabaseConfigured) {
    try {
      const authState = await getAuthState();
      state.user = authState.user;
      state.officer = authState.officer;
    } catch (error) {
      console.error('Authentication state could not be loaded:', error);
    }

    watchAuthState(async (authState) => {
      state.user = authState.user;
      state.officer = authState.officer;
      await refreshOfficerMeetingDetails();
      renderAll();
    });
  }
  await refreshPublicData();
}

initialize();
