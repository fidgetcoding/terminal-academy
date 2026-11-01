// Confirms a visitor can never hit a login or sync failure: no login UI, no outbound requests, works with the
// whole network cut off, and saves from before the login was removed still load.
import { BASE, ORIGIN, launch } from './lib.mjs';
const browser = await launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   -> ' + detail}`); };
const send = async (page, c) => { await page.locator('#cmd-input').focus(); await page.keyboard.type(c); await page.keyboard.press('Enter'); };

// 1. Fresh visitor: straight to the welcome screen, nothing leaves the page
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const outbound = [], errs = [];
  page.on('request', r => { if (!r.url().startsWith(ORIGIN + '/') && !r.url().startsWith('data:')) outbound.push(r.url()); });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('requestfailed', r => errs.push('failed ' + r.url()));
  await page.goto(BASE);
  await page.waitForTimeout(300);
  check('fresh visitor sees the welcome screen first', await page.locator('#welcome-overlay').isVisible());
  const text = await page.evaluate(() => document.body.innerText + ' ' + document.documentElement.innerHTML);
  check('no login, sign up, password, or email field anywhere', (await page.locator('input[type=password], input[type=email]').count()) === 0 && !/Log In|Sign Up|Play as Guest|Logout/.test(await page.evaluate(() => document.body.innerText)));
  check('page source has no trace of the backend', !/supabase/i.test(text));
  check('page loads no external scripts or stylesheets', (await page.locator('script[src], link[href]:not([href^="data:"])').count()) === 0);
  check('welcome says where progress lives', /saves in this browser/.test(await page.locator('#welcome-box').innerText()));
  await page.waitForTimeout(10500);
  check('idle on the welcome screen writes no save', await page.evaluate(() => localStorage.getItem('terminalAcademy')) === null);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  for (const c of ['whoami', 'hostname', 'pwd', 'echo hi']) await send(page, c);
  await page.waitForTimeout(1200);
  await page.waitForTimeout(6000); // longer than the old 5-second sync delay
  check('no outbound request while playing', outbound.length === 0, outbound.join(', '));
  check('no console errors or failed requests', errs.length === 0, errs.join(' | '));
  // 2. Returning visitor goes straight in, even after several reloads
  await page.reload();
  await page.waitForTimeout(200);
  check('returning visitor goes straight to the game', !(await page.locator('#welcome-overlay').isVisible()));
  const label = await page.locator('#panel-lessons .chapter-label').first().innerText();
  check('returning visitor keeps their chapter', /Chapter 2 of/i.test(label), label);
  await page.reload();
  await page.waitForTimeout(11000);
  await page.reload();
  await page.waitForTimeout(200);
  const label2 = await page.locator('#panel-lessons .chapter-label').first().innerText();
  check('repeated reloads and idling lose nothing', /Chapter 2 of/i.test(label2), label2);
  await ctx.close();
}

// 3. Whole network blocked: the game does not care
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => r.request().url().startsWith(ORIGIN + '/') ? r.continue() : r.abort());
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  await send(page, 'whoami');
  check('plays with every outside host blocked', await page.locator('#panel-lessons .task-item').first().evaluate(n => n.classList.contains('done')));
  check('no page errors with outside hosts blocked', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 4. A save from before this change, including the old timestamp key and a stale login token
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('terminalAcademy', JSON.stringify({ cwd: '/home/player', xp: 50, level: 3, currentLesson: 4, completedLessons: [0, 1, 2, 3], completedTasks: { 0: [0, 1, 2, 3] }, achievements: ['first_cmd'], history: ['pwd'], aliases: { ll: 'ls -la' }, envVars: { FOO: 'bar' } }));
    localStorage.setItem('terminalAcademy_ts', '1700000000000');
    localStorage.setItem('sb-asfwpzwvvhbqovxfxhhu-auth-token', '{"access_token":"stale"}');
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE);
  await page.waitForTimeout(200);
  const label = await page.locator('#panel-lessons .chapter-label').first().innerText();
  check('old save loads at the right chapter', /Chapter 5 of/i.test(label), label);
  check('old save keeps level', /LVL 3/.test(await page.locator('#level-badge').innerText()));
  await send(page, 'ls documents');
  check('old save with no files gets the starter files', /notes\.txt/.test(await page.locator('#terminal').innerText()));
  check('no page errors loading an old save', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 5. Storage blocked (some private modes): still playable
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  await send(page, 'whoami');
  check('plays with browser storage blocked', await page.locator('#panel-lessons .task-item').first().evaluate(n => n.classList.contains('done')));
  check('no page errors with storage blocked', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} no-backend checks passed`);
process.exit(bad.length ? 1 : 0);
