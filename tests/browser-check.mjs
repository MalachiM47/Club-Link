import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:');
const appUrl = 'http://127.0.0.1:4173/';
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = chromeCandidates.find(existsSync);
if (!browserPath) throw new Error('Chrome or Edge is required for browser-check.');

let server;
let browser;
const profile = mkdtempSync(join(tmpdir(), 'club-link-browser-'));
const artifacts = join(root, 'test-artifacts');
mkdirSync(artifacts, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, message, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}

async function ensureServer() {
  try {
    const response = await fetch(appUrl);
    if (response.ok) return;
  } catch {
    // Start the project's dependency-free local server below.
  }
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitFor(async () => {
    try {
      return (await fetch(appUrl)).ok;
    } catch {
      return false;
    }
  }, 'The local Club Link server did not start.');
}

class CdpConnection {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) || []), listener]);
  }

  close() {
    this.socket.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}

async function waitForPageReady(cdp, expectedUrl = appUrl) {
  let lastState;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    lastState = await evaluate(cdp, `({
      href: location.href,
      readyState: document.readyState,
      hasEvents: Boolean(document.querySelector('#events-list')),
      busy: document.querySelector('#events-list')?.getAttribute('aria-busy') ?? null,
      bodyStart: document.body?.innerText?.slice(0, 120) ?? ''
    })`);
    if (lastState.href === expectedUrl && lastState.hasEvents && lastState.busy === 'false') return;
    await delay(100);
  }
  throw new Error(`Club Link did not finish rendering: ${JSON.stringify(lastState)}`);
}

async function testViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 500,
  });
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForPageReady(cdp);

  const result = await evaluate(cdp, `(() => ({
    title: document.title,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainVisible: Boolean(document.querySelector('#main-content')),
    eventsReady: document.querySelector('#events-list').getAttribute('aria-busy') === 'false',
    previousEventsReady: document.querySelector('#previous-events-list').getAttribute('aria-busy') === 'false',
    featuredEvent: document.querySelector('#meeting-card-title').textContent,
    previousEventsText: document.querySelector('#previous-events-list').textContent,
    privateMeetingNotes: document.querySelector('#next-event-officer-notes').textContent,
    unauthorizedControls: [...document.querySelectorAll('[data-admin-only]')].filter((node) => !node.hidden).length,
    menuVisible: document.querySelector('#menu-button').getClientRects().length > 0
  }))()`);

  assert(result.title === 'Club Link | Club Dashboard', `${width}px: page title is incorrect.`);
  assert(result.innerWidth === width, `${width}px: emulated viewport width is ${result.innerWidth}.`);
  assert(result.scrollWidth <= width, `${width}px: horizontal overflow detected (${result.scrollWidth}px).`);
  assert(result.mainVisible && result.eventsReady && result.previousEventsReady, `${width}px: public schedule did not finish rendering.`);
  assert(result.featuredEvent === 'Meeting', `${width}px: the closest schedule item is not featured as the next event.`);
  assert(result.previousEventsText.includes('Completed workshop'), `${width}px: passed schedule items are missing from Previous events.`);
  assert(!result.privateMeetingNotes.includes('Discuss volunteer assignments.'), `${width}px: private meeting notes leaked into the public view.`);
  assert(result.unauthorizedControls === 0, `${width}px: officer controls are visible while logged out.`);
  assert(result.menuVisible === (width <= 860), `${width}px: navigation breakpoint is incorrect.`);

  if (width <= 500) {
    await evaluate(cdp, `document.querySelector('#menu-button').click()`);
    const nav = await evaluate(cdp, `({
      expanded: document.querySelector('#menu-button').getAttribute('aria-expanded'),
      open: document.querySelector('#sidebar').classList.contains('is-open'),
      noScroll: document.body.classList.contains('no-scroll')
    })`);
    assert(nav.expanded === 'true' && nav.open && nav.noScroll, `${width}px: mobile navigation did not open.`);
    await evaluate(cdp, `document.querySelector('#sidebar-close').click()`);
  }

  await evaluate(cdp, `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0)`);
  await delay(180);
  const dashboardActive = await evaluate(cdp, `document.querySelector('.nav-link.is-active')?.dataset.section`);
  assert(dashboardActive === 'dashboard', `${width}px: dashboard is not selected at the top of the page.`);

  await evaluate(cdp, `document.querySelector('#events').scrollIntoView()`);
  await delay(180);
  const eventsPosition = await evaluate(cdp, `({
    active: document.querySelector('.nav-link.is-active')?.dataset.section,
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    dashboardTop: document.querySelector('#dashboard').getBoundingClientRect().top,
    eventsTop: document.querySelector('#events').getBoundingClientRect().top,
    announcementsTop: document.querySelector('#announcements').getBoundingClientRect().top,
    aboutTop: document.querySelector('#about').getBoundingClientRect().top
  })`);
  assert(eventsPosition.active === 'events', `${width}px: events navigation is not selected while viewing the schedule (${JSON.stringify(eventsPosition)}).`);

  await evaluate(cdp, `window.scrollTo(0, document.documentElement.scrollHeight)`);
  await delay(180);
  const aboutActive = await evaluate(cdp, `document.querySelector('.nav-link.is-active')?.dataset.section`);
  assert(aboutActive === 'about', `${width}px: club information is not selected at the bottom of the page.`);
  if (width === 390) {
    const aboutScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(artifacts, 'club-link-about-390.png'), Buffer.from(aboutScreenshot.data, 'base64'));
  }
  await evaluate(cdp, `window.scrollTo(0, 0)`);
  await delay(120);

  await evaluate(cdp, `document.querySelector('#open-auth-button').click()`);
  await delay(240);
  const auth = await evaluate(cdp, `({
    open: document.querySelector('#auth-dialog').open,
    setupNotice: !document.querySelector('#auth-config-notice').hidden,
    submitDisabled: document.querySelector('#auth-submit').disabled,
    viewportHeight: window.innerHeight,
    left: document.querySelector('#auth-dialog .dialog-card').getBoundingClientRect().left,
    right: document.querySelector('#auth-dialog .dialog-card').getBoundingClientRect().right,
    bottom: document.querySelector('#auth-dialog .dialog-card').getBoundingClientRect().bottom
  })`);
  assert(auth.open, `${width}px: sign-in dialog did not open.`);
  assert(auth.submitDisabled === auth.setupNotice, `${width}px: sign-in availability does not match configuration state.`);
  if (width === 375) {
    const debugAuthScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(artifacts, 'club-link-auth-375.png'), Buffer.from(debugAuthScreenshot.data, 'base64'));
  }
  assert(
    auth.left >= 0 && auth.right <= width && auth.bottom <= auth.viewportHeight,
    `${width}px: sign-in dialog does not fit the viewport (${JSON.stringify(auth)}).`,
  );
  if (width === 390) {
    const authScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(artifacts, 'club-link-auth-390.png'), Buffer.from(authScreenshot.data, 'base64'));
  }
  await evaluate(cdp, `document.querySelector('#auth-dialog .dialog-cancel').click()`);

  if (width <= 430) {
    const stressWidth = await evaluate(cdp, `(() => {
      const meeting = document.querySelector('#meeting-card-title');
      const originalMeeting = meeting.textContent;
      meeting.textContent = 'ExtremelyLongUnbrokenMeetingTitle'.repeat(18);

      const event = document.createElement('article');
      event.className = 'event-card';
      const eventHeading = document.createElement('h3');
      eventHeading.textContent = 'ExtremelyLongUnbrokenEventTitle'.repeat(18);
      event.append(eventHeading);
      document.querySelector('#events-list').append(event);

      const announcement = document.createElement('article');
      announcement.className = 'announcement-card';
      const content = document.createElement('div');
      content.className = 'announcement-content';
      const heading = document.createElement('h3');
      heading.textContent = 'ExtremelyLongUnbrokenAnnouncementTitle'.repeat(18);
      const body = document.createElement('p');
      body.className = 'announcement-body';
      body.textContent = 'ExtremelyLongUnbrokenAnnouncementBody'.repeat(30);
      content.append(heading, body);
      announcement.append(content);
      document.querySelector('#announcements-list').append(announcement);

      const previousHeading = document.querySelector('.previous-event-content h4');
      const originalPreviousHeading = previousHeading?.textContent;
      if (previousHeading) previousHeading.textContent = 'ExtremelyLongUnbrokenPreviousEventTitle'.repeat(18);

      const measured = document.documentElement.scrollWidth;
      meeting.textContent = originalMeeting;
      event.remove();
      announcement.remove();
      if (previousHeading) previousHeading.textContent = originalPreviousHeading;
      return measured;
    })()`);
    assert(stressWidth <= width, `${width}px: long database content causes horizontal overflow (${stressWidth}px).`);
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(artifacts, `club-link-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  return result;
}

async function testOfficerSchedule(cdp) {
  const url = `${appUrl}?officer-test=1`;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.send('Page.navigate', { url });
  await waitForPageReady(cdp, url);

  const officerView = await evaluate(cdp, `({
    controls: [...document.querySelectorAll('[data-admin-only]')].filter((node) => !node.hidden).length,
    privateNotes: document.querySelector('#next-event-officer-notes').textContent,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  assert(officerView.controls > 0, 'Officer schedule controls did not become available.');
  assert(officerView.privateNotes.includes('Discuss volunteer assignments.'), 'Officer-only meeting notes were not loaded for the officer.');
  assert(officerView.scrollWidth <= 390, 'Officer meeting details cause horizontal overflow at 390px.');

  await evaluate(cdp, `document.querySelector('#next-event-officer-notes summary').click()`);
  const officerNotesScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(artifacts, 'club-link-officer-notes-390.png'), Buffer.from(officerNotesScreenshot.data, 'base64'));

  await evaluate(cdp, `document.querySelector('#add-event-button').click()`);
  await delay(220);
  const meetingForm = await evaluate(cdp, `({
    open: document.querySelector('#event-dialog').open,
    type: document.querySelector('#event-type').value,
    otherHidden: document.querySelector('#event-name-field').hidden,
    otherDisabled: document.querySelector('#event-name').disabled,
    notesHidden: document.querySelector('#meeting-officer-notes-field').hidden,
    notesDisabled: document.querySelector('#meeting-officer-notes').disabled,
    cardBottom: document.querySelector('#event-dialog .dialog-card').getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight
  })`);
  assert(meetingForm.open && meetingForm.type === 'meeting', 'The schedule form does not default to Meeting.');
  assert(meetingForm.otherHidden && meetingForm.otherDisabled, 'The custom event name is active for Meeting.');
  assert(!meetingForm.notesHidden && !meetingForm.notesDisabled, 'Private officer notes are unavailable for Meeting.');
  assert(meetingForm.cardBottom <= meetingForm.viewportHeight, `The meeting form does not fit the 390px mobile viewport (${JSON.stringify(meetingForm)}).`);
  const meetingFormScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(artifacts, 'club-link-meeting-form-390.png'), Buffer.from(meetingFormScreenshot.data, 'base64'));

  await evaluate(cdp, `(() => {
    const type = document.querySelector('#event-type');
    type.value = 'other';
    type.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const otherForm = await evaluate(cdp, `({
    otherHidden: document.querySelector('#event-name-field').hidden,
    otherDisabled: document.querySelector('#event-name').disabled,
    otherRequired: document.querySelector('#event-name').required,
    notesHidden: document.querySelector('#meeting-officer-notes-field').hidden,
    notesDisabled: document.querySelector('#meeting-officer-notes').disabled
  })`);
  assert(!otherForm.otherHidden && !otherForm.otherDisabled && otherForm.otherRequired, 'Other does not reveal the required event name field.');
  assert(otherForm.notesHidden && otherForm.notesDisabled, 'Meeting-only notes remain available for Other.');
  await evaluate(cdp, `document.querySelector('#event-dialog .dialog-close').click()`);

  await evaluate(cdp, `document.querySelector('#edit-next-event-button').click()`);
  await delay(220);
  const editedMeeting = await evaluate(cdp, `({
    id: document.querySelector('#event-id').value,
    type: document.querySelector('#event-type').value,
    notes: document.querySelector('#meeting-officer-notes').value
  })`);
  assert(editedMeeting.id === 'future-1' && editedMeeting.type === 'meeting', 'Editing the next meeting does not restore its schedule type.');
  assert(editedMeeting.notes === 'Discuss volunteer assignments.', 'Editing a meeting does not restore its private officer notes.');
  await evaluate(cdp, `document.querySelector('#event-dialog .dialog-close').click()`);
}

async function testLegalPage(cdp, path, expectedTitle, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 500,
  });
  const url = new URL(path, appUrl).href;
  await cdp.send('Page.navigate', { url });
  await waitFor(async () => evaluate(cdp, `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`), `${path} did not finish loading.`);
  const result = await evaluate(cdp, `({
    title: document.title,
    heading: document.querySelector('h1')?.textContent,
    scrollWidth: document.documentElement.scrollWidth,
    dashboardTarget: document.querySelector('.legal-back')?.getAttribute('href')
  })`);
  assert(result.title === `${expectedTitle} | Club Link`, `${path}: page title is incorrect.`);
  assert(result.heading === expectedTitle, `${path}: heading is incorrect.`);
  assert(result.scrollWidth <= width, `${path} at ${width}px: horizontal overflow detected.`);
  assert(result.dashboardTarget === 'index.html', `${path}: dashboard navigation target is incorrect.`);
}

try {
  await ensureServer();
  browser = spawn(browserPath, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    appUrl,
  ], { stdio: 'ignore', windowsHide: true });

  const portFile = join(profile, 'DevToolsActivePort');
  await waitFor(() => existsSync(portFile), 'The browser debugging connection did not start.');
  const [port] = readFileSync(portFile, 'utf8').split(/\r?\n/);
  const targets = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }, 'No browser page was available.');
  const page = targets.find((target) => target.type === 'page');
  assert(page?.webSocketDebuggerUrl, 'No debuggable browser page was found.');

  const cdp = new CdpConnection(page.webSocketDebuggerUrl);
  await cdp.open();
  const browserErrors = [];
  cdp.on('Runtime.exceptionThrown', (params) => browserErrors.push(params.exceptionDetails?.text || 'Uncaught exception'));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://cdn.jsdelivr.net/*'] });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.supabase = {
      createClient() {
        const query = {
          select() { return this; },
          order() {
            const day = 86400000;
            const events = [
              { id: 'future-1', event_type: 'meeting', name: 'Meeting', event_date: new Date(Date.now() + day).toISOString(), location: 'Library', description: 'Review the next activity.' },
              { id: 'future-2', event_type: 'other', name: 'Service event', event_date: new Date(Date.now() + day * 5).toISOString(), location: 'Courtyard', description: null },
              { id: 'past-1', event_type: 'other', name: 'Completed workshop', event_date: new Date(Date.now() - day).toISOString(), location: 'Room 4', description: 'Archived automatically.' }
            ];
            const meetingDetails = [{ event_id: 'future-1', notes: 'Discuss volunteer assignments.', updated_at: new Date().toISOString() }];
            const data = this.table === 'events' ? events : this.table === 'event_officer_details' ? meetingDetails : [];
            return Promise.resolve({ data, error: null });
          },
          eq() { return this; },
          maybeSingle() {
            const isOfficer = new URLSearchParams(location.search).has('officer-test');
            const data = this.table === 'admins' && isOfficer ? { user_id: 'officer-1', role: 'officer' } : null;
            return Promise.resolve({ data, error: null });
          }
        };
        return {
          from(table) {
            const instance = Object.create(query);
            instance.table = table;
            return instance;
          },
          auth: {
            getSession() {
              const isOfficer = new URLSearchParams(location.search).has('officer-test');
              const user = isOfficer ? { id: 'officer-1', email: 'officer@example.com' } : null;
              return Promise.resolve({ data: { session: user ? { user } : null }, error: null });
            },
            onAuthStateChange() {
              return { data: { subscription: { unsubscribe() {} } } };
            }
          }
        };
      }
    };`,
  });

  const results = [];
  for (const [width, height] of [[1440, 1000], [375, 812], [390, 844], [430, 900]]) {
    results.push(await testViewport(cdp, width, height));
  }
  await testOfficerSchedule(cdp);
  assert(browserErrors.length === 0, `Browser exceptions: ${browserErrors.join('; ')}`);

  await testLegalPage(cdp, '/privacy', 'Privacy Policy', 375, 812);
  await testLegalPage(cdp, '/terms', 'Terms of Use', 1440, 1000);

  const privacy = await fetch('http://127.0.0.1:4173/privacy');
  const terms = await fetch('http://127.0.0.1:4173/terms');
  assert(privacy.ok && terms.ok, 'Privacy or Terms navigation target is unavailable.');

  cdp.close();
  console.log(`Browser checks passed at ${results.map((item) => `${item.innerWidth}px`).join(', ')} with no horizontal overflow or uncaught exceptions.`);
} finally {
  if (browser && !browser.killed) browser.kill();
  if (server && !server.killed) server.kill();
  await delay(350);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  } catch {
    // Windows may keep browser profile files locked briefly after Chrome exits.
  }
}
