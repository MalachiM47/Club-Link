const DATE_OPTIONS = { month: 'short', day: 'numeric', year: 'numeric' };
const DATE_TIME_OPTIONS = { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };

export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat(undefined, DATE_OPTIONS).format(date) : '';
}

export function formatDateTime(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat(undefined, DATE_TIME_OPTIONS).format(date) : '';
}

export function formatTime(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date) : '';
}

export function formatRelativeDate(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return '';
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target - start) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return formatDate(date);
}

export function toDatetimeLocalValue(value) {
  const date = parseDate(value);
  if (!date) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function normalizeSearch(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

// Archive at the start of the following calendar day in the displayed local timezone.
export function getEventArchiveDate(value) {
  const date = parseDate(value);
  return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) : null;
}

export function filterUpcomingEvents(events, searchTerm, rangeDays, now = new Date()) {
  const search = normalizeSearch(searchTerm);
  const upperBound = rangeDays === 'all'
    ? null
    : new Date(now.getTime() + Number(rangeDays) * 86400000);

  return events.filter((event) => {
    const eventDate = parseDate(event.event_date);
    if (!eventDate || getEventArchiveDate(event.event_date) <= now) return false;
    if (upperBound && eventDate > upperBound) return false;
    if (!search) return true;
    return [event.name, event.location, event.description]
      .some((field) => normalizeSearch(field).includes(search));
  });
}

export function getPreviousEvents(events, now = new Date()) {
  return events
    .filter((event) => {
      const eventDate = parseDate(event.event_date);
      return eventDate && getEventArchiveDate(event.event_date) <= now;
    })
    .sort((first, second) => parseDate(second.event_date) - parseDate(first.event_date));
}

export function initialsFromEmail(email) {
  const value = String(email ?? '').trim();
  return value ? value.charAt(0).toUpperCase() : 'O';
}
