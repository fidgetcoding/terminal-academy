// Confirms a visitor can never hit a login or sync failure: no login UI, works with the whole network cut off, and
// saves from before the login was removed still load. Also holds the usage counts to exactly what the page promises:
// one host, fixed shapes, nothing typed, and an opt-out that works. No real counts are sent.
import { BASE, COLLECTOR, LIVE_URL, ORIGIN, asLive, badCount, countName, countNumber, launch } from './lib.mjs';
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
  check('a copy on any other address sends nothing', outbound.length === 0, outbound.join(', '));
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

// 6. On the real address: exactly the agreed counts, to one host, and nothing typed
const SECRET = 'ZZSECRET7731';
const list = sent => sent.map(c => `${countName(c)}${countNumber(c) ? ' ' + countNumber(c) : ''}`);
// The last command holds the marker, so it's the very command that triggers a count.
const playChapterOne = async page => {
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  for (const c of ['whoami', 'hostname', 'pwd', `echo "Hello Terminal ${SECRET}"`]) await send(page, c);
};
const settled = async (page, sent, count) => {
  for (let i = 0; i < 40 && sent.length < count; i++) await page.waitForTimeout(50);
};
{
  const ctx = await browser.newContext();
  const sent = await asLive(ctx);
  const page = await ctx.newPage();
  const otherHosts = [], everything = [], errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('request', async r => {
    const url = r.url();
    if (!url.startsWith(LIVE_URL) && !url.startsWith(COLLECTOR + '/') && !url.startsWith('data:')) otherHosts.push(url);
    everything.push(url, r.postData() || '', JSON.stringify(await r.allHeaders().catch(() => ({}))));
  });
  await page.goto(LIVE_URL);
  await settled(page, sent, 1);
  check('opening the page counts one visit', list(sent).join() === 'visit', list(sent).join());
  await playChapterOne(page);
  await settled(page, sent, 3);
  check('chapter 1 counts started and finished', list(sent).join() === 'visit,chapter_started 1,chapter_finished 1', list(sent).join());
  await page.locator('#panel-lessons .chapter-label', { hasText: /Chapter 2 of/i }).first().waitFor();
  const before = sent.length;
  for (const c of [`echo ${SECRET}`, `touch ${SECRET}.txt`, `export K=${SECRET}`, SECRET, 'git init', 'git add .', `git commit -m ${SECRET}`, `echo ${SECRET} | pbcopy`, `alias ${SECRET}=ls`, `cat ${SECRET}.txt`, `mkdir ${SECRET}`, `cd ${SECRET}`, 'cd ~', `grep ${SECRET} *`]) await send(page, c);
  await page.locator('.panel-tabs button[data-tab="save"]').click();
  await page.locator('#save-code-in').fill(SECRET);
  await page.getByRole('button', { name: 'Check this code' }).click();
  await page.locator('#save-status', { hasText: /save/i }).waitFor();
  await page.waitForTimeout(300);
  check('typing commands adds no counts of its own', sent.slice(before).every(c => /chapter_/.test(countName(c))), list(sent.slice(before)).join());
  check('a typed command never appears in any request', !everything.join('\n').includes(SECRET));
  check('a typed command never appears in a count', !JSON.stringify(sent).includes(SECRET));
  check('every count is exactly the agreed shape', sent.every(c => !badCount(c)), sent.map(badCount).filter(Boolean).join(' | '));
  check('nothing goes to any other host', otherHosts.length === 0, otherHosts.join(', '));
  check('no cookies are set', (await ctx.cookies()).length === 0);
  const stored = await page.evaluate(() => Object.keys(localStorage).sort().join());
  check('browser storage holds only the save', stored === 'terminalAcademy', stored);
  check('no errors while counting', errs.length === 0, errs.join(' | '));
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://example.com/?leak=1'); return 'sent'; } catch (e) { return 'blocked'; }
  });
  check('the browser blocks every other host', blocked === 'blocked', blocked);

  // A finished save with a secret in it counts nothing on arrival, and sends nothing from inside it
  const code = await page.evaluate(([secret, chapters]) => {
    const w = JSON.parse(currentSaveJson());
    w.save.completedLessons = Array.from({ length: chapters }, (_, i) => i);
    w.save.history = [secret];
    w.save.fs['/'].children.home.children.player.children[secret] = { type: 'file', permissions: 'rw-r--r--', content: secret };
    return JSON.stringify(w);
  }, [SECRET, 81]);
  const fromSave = sent.length;
  await page.locator('#save-code-in').fill(code);
  await page.getByRole('button', { name: 'Check this code' }).click();
  await page.locator('#save-confirm').waitFor();
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Load this save' }).click();
  await loaded;
  await settled(page, sent, fromSave + 1);
  await page.waitForTimeout(200);
  check('loading a finished save counts only the page opening', list(sent.slice(fromSave)).join() === 'visit', list(sent.slice(fromSave)).join());
  check('nothing from a save appears in a request', !JSON.stringify(sent).includes(SECRET) && !everything.join('\n').includes(SECRET));
  await ctx.close();
}

// 7. Copies on other addresses never count, and only one line in the page talks to the collector
{
  const ctx = await browser.newContext();
  const sent = await asLive(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(200);
  check('the game counts nothing from another address', sent.length === 0, list(sent).join());
  const source = await page.evaluate(() => document.querySelector('script').textContent);
  check('the page calls the collector in exactly one place', source.match(/\bfetch\(/g).length === 1 && !/sendBeacon|XMLHttpRequest|WebSocket|posthog-js/.test(source));
  await ctx.close();
}

// 8. The opt-out
{
  const ctx = await browser.newContext();
  const sent = await asLive(ctx);
  const page = await ctx.newPage();
  await page.goto(LIVE_URL);
  await settled(page, sent, 1);
  check('the welcome screen says what is counted', /never what you type/.test(await page.locator('#welcome-box').innerText()));
  await page.getByRole('button', { name: "Don't count me" }).click();
  check('the welcome screen confirms the opt-out', /Nothing is counted/.test(await page.locator('#welcome-box').innerText()));
  await playChapterOne(page);
  await page.waitForTimeout(300);
  check('opting out on the welcome screen stops the counts', list(sent).join() === 'visit', list(sent).join());
  await page.reload();
  await send(page, 'ls');
  await page.waitForTimeout(300);
  check('the opt-out survives a reload', list(sent).join() === 'visit', list(sent).join());
  await page.locator('.panel-tabs button[data-tab="save"]').click();
  const panel = await page.locator('#panel-save').innerText();
  check('the Save tab lists what is counted', /each time this page opens/.test(panel) && /each chapter started and finished/.test(panel) && /each adventure quest finished/.test(panel) && /finishing every chapter/.test(panel));
  check('the Save tab says what never is', /never sends what you type, your files, your save, or your name/.test(panel));
  check('the Save tab names who holds the counts and the IP address', /PostHog/.test(panel) && /IP address/.test(panel));
  check('the Save tab shows counting is off', !(await page.locator('#usage-toggle').isChecked()) && /Counting is off/.test(panel));
  await page.locator('#usage-toggle').check();
  check('counting can be turned back on', await page.evaluate(() => localStorage.getItem('terminalAcademyCounts')) === null);
  await send(page, 'pwd');
  await page.reload();
  await settled(page, sent, 2);
  check('turned back on, it counts again', list(sent).join() === 'visit,visit', list(sent).join());
  await page.locator('.panel-tabs button[data-tab="save"]').click();
  await page.locator('#usage-toggle').uncheck();
  check('the Save tab can opt out too', await page.evaluate(() => localStorage.getItem('terminalAcademyCounts')) === 'off');
  await ctx.close();
}

// 9. Browsers that ask not to be tracked are never counted, not even the first visit
for (const [name, prop, value] of [['Global Privacy Control', 'globalPrivacyControl', true], ['Do Not Track', 'doNotTrack', '1']]) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([p, v]) => Object.defineProperty(Navigator.prototype, p, { get: () => v, configurable: true }), [prop, value]);
  const sent = await asLive(ctx);
  const page = await ctx.newPage();
  await page.goto(LIVE_URL);
  await playChapterOne(page);
  await page.waitForTimeout(300);
  check(`${name} means no counts at all`, sent.length === 0, list(sent).join());
  await page.locator('.panel-tabs button[data-tab="save"]').click();
  check(`${name} is explained and can't be overridden`, /asks sites not to track/.test(await page.locator('#usage-note').innerText()) && await page.locator('#usage-toggle').isDisabled());
  await ctx.close();
}

// 10. The collector blocked, failing, or hanging: the game doesn't notice
for (const down of ['abort', '500', 'hang']) {
  const ctx = await browser.newContext();
  await asLive(ctx, { down });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(LIVE_URL);
  await playChapterOne(page);
  await page.locator('#panel-lessons .chapter-label', { hasText: /Chapter 2 of/i }).first().waitFor();
  await page.reload();
  const label = await page.locator('#panel-lessons .chapter-label').first().innerText();
  check(`collector ${down}: progress is kept`, /Chapter 2 of/i.test(label), label);
  check(`collector ${down}: no page errors`, errs.length === 0, errs.join(' | '));
  check(`collector ${down}: nothing shown to the player`, !/posthog|failed to fetch|could not be run/i.test(await page.locator('#terminal').innerText()));
  await ctx.close();
}

// 11. Browser storage blocked on the real address: still plays, and the opt-out holds for the page
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const sent = await asLive(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(LIVE_URL);
  await settled(page, sent, 1);
  await page.getByRole('button', { name: "Don't count me" }).click();
  await playChapterOne(page);
  await page.waitForTimeout(300);
  check('with storage blocked the opt-out still holds for the page', list(sent).join() === 'visit', list(sent).join());
  check('with storage blocked counting causes no errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} no-backend checks passed`);
process.exit(bad.length ? 1 : 0);
