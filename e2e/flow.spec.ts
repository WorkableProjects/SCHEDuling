import { test, expect, type Page, type Browser } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const PW = 'correct horse battery';
test.describe.configure({ mode: 'serial' });


async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  const done = page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.ok());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await done;
  await page.waitForLoadState('networkidle');
}

let adminLink = '';
let graceLink = '';
let eventUrl = '';
let attendeeTicketToken = '';

async function newPage(browser: Browser, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test('two-admin setup flow; setup closes afterwards', async ({ browser }) => {
  const { page } = await newPage(browser);
  await page.goto('/setup');
  await page.getByLabel('Setup token').fill('wrong');
  await page.getByLabel('Admin 1 email').fill('ada@example.com');
  await page.getByLabel('Admin 2 email').fill('grace@example.com');
  await page.getByRole('button', { name: 'Create admin accounts' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong setup token');
  await page.getByLabel('Setup token').fill('e2e-token');
  await page.getByRole('button', { name: 'Create admin accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Admins created' })).toBeVisible();
  const links = await page.getByLabel(/Activation link/).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  [adminLink, graceLink] = links as [string, string];
  expect(links).toHaveLength(2);
  await page.goto('/setup');
  await expect(page.getByText('404')).toBeVisible();
});

test('admin activates, builds and publishes an event', async ({ browser }) => {
  const { page } = await newPage(browser);
  await page.goto(new URL(adminLink).pathname);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByLabel('Confirm password').fill(PW);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await shot(page, 'admin-dashboard-empty');

  await page.goto('/admin/events/new');
  await page.getByLabel('Event name').fill('DevSummit 2030');
  await page.getByLabel('Time zone').fill('America/Los_Angeles');
  await page.getByLabel('Starts').fill('2020-01-01');
  await page.getByLabel('Ends').fill('2040-01-01');
  await page.getByLabel('Location').fill('Moscone West, San Francisco');
  await page.getByLabel('Description', { exact: true }).fill('Two days of talks, workshops and hallway conversations about building software.');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name: 'DevSummit 2030' })).toBeVisible();
  eventUrl = page.url();
  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.getByText('Published').first()).toBeVisible();
  await shot(page, 'admin-event-settings');

  // sessions via CSV import
  await page.goto(`${eventUrl}/sessions`);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const csv = [
    'title,start,end,room,tracks,speakers,capacity,requires_registration,pinned,status,description',
    'Welcome & keynote,2030-05-01 09:00,2030-05-01 10:00,Main Hall,Keynote,,,,yes,published,Kick-off for the conference.',
    'Hands-on: Edge functions,2030-05-01 10:30,2030-05-01 12:00,Workshop Room,Workshop,sam@example.com,2,yes,,published,Build and deploy an API in 90 minutes.',
    'Panel: The future of tooling,2030-05-01 10:30,2030-05-01 11:30,Main Hall,Talks,,,,,published,Four leaders debate.',
    'Closing party,2030-05-02 17:00,2030-05-02 19:00,Lobby,Social,,,,,published,Drinks and demos.',
  ].join('\n');
  await page.getByLabel('CSV', { exact: true }).fill(csv);
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('File looks good: 4 rows')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported\. 4 created/)).toBeVisible();
  await expect(page.getByText('One-time invite links')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await shot(page, 'admin-sessions');
});

test('attendee: sign up, join, plan, register, waitlist, ticket', async ({ browser }) => {
  const { page } = await newPage(browser, true);
  await page.goto('/');
  await shot(page, 'home-mobile');
  await page.getByRole('link', { name: /DevSummit 2030/ }).click();
  await page.getByRole('link', { name: 'Sign up' }).first().click();
  await page.getByLabel('Full name').fill('Riley Attendee');
  await page.getByLabel('Email').fill('riley@example.com');
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Join event' })).toBeVisible();
  await shot(page, 'event-welcome-mobile');
  await page.getByRole('button', { name: 'Join event' }).click();
  await expect(page.getByText("You're registered")).toBeVisible();

  await page.getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hands-on: Edge functions' })).toBeVisible();
  await shot(page, 'schedule-mobile');
  await page.getByRole('button', { name: 'Add Panel: The future of tooling to agenda' }).click();
  await expect(page.getByRole('button', { name: 'Remove Panel: The future of tooling from agenda' })).toBeVisible();
  // pinned keynote is already there; register for the workshop (overlaps with the panel but only registrations count)
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Registered', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'My agenda', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome & keynote' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hands-on: Edge functions' })).toBeVisible();
  await shot(page, 'agenda-mobile');

  await page.getByRole('link', { name: 'My ticket', exact: true }).click();
  await expect(page.getByAltText('Your check-in QR code')).toBeVisible();
  await shot(page, 'ticket-mobile');
});

test('desktop views: schedule, session detail', async ({ browser }) => {
  const { page } = await newPage(browser);
  await login(page, 'riley@example.com');
  await page.goto('/e/devsummit-2030/schedule');
  await expect(page.getByRole('heading', { name: 'Hands-on: Edge functions' })).toBeVisible();
  await shot(page, 'schedule-desktop');
  await page.getByRole('link', { name: 'Hands-on: Edge functions' }).click();
  await expect(page.getByRole('heading', { name: 'About this session' })).toBeVisible();
  await shot(page, 'session-desktop');
  // filter by search
  await page.goto('/e/devsummit-2030/schedule');
  await page.getByLabel('Search').fill('party');
  await expect(page.getByRole('heading', { name: 'Closing party' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome & keynote' })).toHaveCount(0);
});

test('admin checks the attendee in by ticket code and manual search', async ({ browser }) => {
  const rileyCtx = await newPage(browser);
  await login(rileyCtx.page, 'riley@example.com');
  const m = await rileyCtx.page.evaluate(async () => (await (await fetch('/api/events/devsummit-2030')).json()).membership);
  attendeeTicketToken = m.qrToken;
  expect(attendeeTicketToken).toBeTruthy();

  const { page } = await newPage(browser, true);
  await login(page, 'ada@example.com');
  await page.goto('/checkin/devsummit-2030');
  await expect(page.getByLabel('Live counts')).toBeVisible();
  await page.getByLabel('Ticket code').fill(`sched:${attendeeTicketToken}`);
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Riley Attendee' })).toContainText('Checked in to the event');
  await shot(page, 'checkin-success-mobile');
  await page.getByLabel('Ticket code').fill(attendeeTicketToken);
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Riley Attendee' })).toContainText('Already checked in');
  await page.getByRole('tab', { name: 'Find person' }).click();
  await page.getByLabel('Search by name or email').fill('riley');
  await expect(page.getByText('Checked in ✓')).toBeVisible();
  await shot(page, 'checkin-search-mobile');
});

test('waitlist fills, then admin pages render', async ({ browser }) => {
  // two more attendees take the last seat and a waitlist spot in the 2-seat workshop
  for (const n of ['Sky', 'Tam']) {
    const { page } = await newPage(browser);
    await page.goto('/signup');
    await page.getByLabel('Full name').fill(`${n} Person`);
    await page.getByLabel('Email').fill(`${n.toLowerCase()}@example.com`);
    await page.getByLabel('Password').fill(PW);
    const signedUp = page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.ok());
    await page.getByRole('button', { name: 'Create account' }).click();
    await signedUp;
    await page.goto('/e/devsummit-2030');
    await page.getByRole('button', { name: 'Join event' }).click();
    await page.getByRole('link', { name: 'Schedule', exact: true }).click();
    const reg = page.getByRole('button', { name: n === 'Sky' ? 'Register' : 'Join waitlist' });
    await reg.click();
    await expect(page.getByText(n === 'Sky' ? 'Registered' : 'Waitlist #1', { exact: true })).toBeVisible();
  }
  const { page } = await newPage(browser);
  await login(page, 'ada@example.com');
  for (const [path, heading] of [['', 'Dashboard'], ['/events', 'Events'], ['/users', 'Users & admins'], ['/audit', 'Audit log']] as const) {
    await page.goto(`/admin${path}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await shot(page, `admin${path.replace('/', '-') || '-dashboard'}`);
  }
  await page.goto(`${eventUrl}/registrations`);
  await shot(page, 'admin-registrations');
  await page.goto(`${eventUrl}/reports`);
  await expect(page.getByText('Hands-on: Edge functions')).toBeVisible();
  await shot(page, 'admin-reports');
  await page.goto(`${eventUrl}/checkin`);
  await shot(page, 'admin-checkin');
  await page.goto(`${eventUrl}/people`);
  await expect(page.getByText('Riley Attendee')).toBeVisible();
  await shot(page, 'admin-people');
});

test('a third admin is refused in the UI', async ({ browser }) => {
  const { page } = await newPage(browser);
  await login(page, 'ada@example.com');
  await page.goto('/admin/users');
  await page.getByLabel('Role for Riley Attendee').selectOption('admin');
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Only 2 admin accounts are allowed' })).toBeVisible();
});

test('speaker activates via invite, edits profile and own session', async ({ browser }) => {
  const admin = await newPage(browser);
  await login(admin.page, 'ada@example.com');
  await expect(admin.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const link = await admin.page.evaluate(async () => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const users = (await (await fetch('/api/people/users?q=sam@')).json()).users;
    const r = await fetch(`/api/people/users/${users[0].id}/link`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' });
    return (await r.json()).link as string;
  });
  const { page } = await newPage(browser);
  await page.goto(new URL(link).pathname);
  await page.getByLabel('Your name').fill('Sam Speaker');
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByLabel('Confirm password').fill(PW);
  const activated = page.waitForResponse((r) => r.url().endsWith('/api/auth/activate') && r.ok());
  await page.getByRole('button', { name: 'Activate account' }).click();
  await activated;
  await page.goto('/account');
  await page.getByLabel('Title').fill('Principal Engineer');
  await page.getByLabel('Organization').fill('Acme Cloud');
  await page.getByLabel('Bio').fill('Sam builds developer platforms.');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();
  await page.goto('/e/devsummit-2030/schedule');
  await page.getByRole('link', { name: 'Hands-on: Edge functions' }).click();
  await page.getByRole('button', { name: 'Edit description' }).click();
  await page.getByLabel('Description').fill('Updated by the speaker: bring a laptop.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Updated by the speaker: bring a laptop.')).toBeVisible();
  await page.goto('/e/devsummit-2030/speakers');
  await expect(page.getByText('Sam Speaker')).toBeVisible();
  await shot(page, 'speakers');
  void graceLink;
});
