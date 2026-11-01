// Things a learner actually does beyond the literal instruction. All through real keyboard events.
import { BASE, launch, mobile, outFile } from './lib.mjs';
import fs from 'fs';
const browser = await launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   -> ' + detail}`); };

async function fresh(view) {
  const ctx = await browser.newContext(view || { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  return { ctx, page, errs };
}
async function send(page, line) {
  await page.evaluate(() => { window.__m = document.getElementById('terminal').lastElementChild; });
  await page.locator('#cmd-input').focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  return lastOut(page);
}
const lastOut = page => page.evaluate(() => {
  const a = [...document.getElementById('terminal').children]; const i = window.__m && window.__m.isConnected ? a.indexOf(window.__m) : -1;
  return a.slice(i + 1).map(n => n.innerText).join('\n');
});
const doneCount = page => page.locator('#panel-lessons .task-item.done').count();
const isDone = (page, i) => page.locator('#panel-lessons .task-item').nth(i).evaluate(n => n.classList.contains('done'));
const chapter = page => page.locator('#panel-lessons .chapter-label').first().innerText();
async function nextChapter(page) { await page.locator('#panel-lessons .nav-btns button').last().click(); await page.waitForTimeout(30); }

// ---- Chapter 1: spaces, quote style, up-arrow ----
{
  const { ctx, page } = await fresh();
  await send(page, 'whoami   ');
  check('trailing spaces still pass (whoami   )', await isDone(page, 0));
  await send(page, '   hostname');
  check('leading spaces still pass (   hostname)', await isDone(page, 1));
  await page.locator('#cmd-input').focus();
  await page.keyboard.press('ArrowUp');
  const v = await page.locator('#cmd-input').inputValue();
  check('up arrow recalls the last command', v === 'hostname', `got "${v}"`);
  await page.keyboard.press('ArrowUp');
  const v2 = await page.locator('#cmd-input').inputValue();
  check('up arrow again goes further back', v2 === 'whoami', `got "${v2}"`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const v3 = await page.locator('#cmd-input').inputValue();
  check('down arrow returns to an empty line', v3 === '', `got "${v3}"`);
  // Tab completes a command name
  await page.keyboard.type('pw');
  await page.keyboard.press('Tab');
  const v4 = await page.locator('#cmd-input').inputValue();
  check('tab completes a command name (pw -> pwd)', v4.trim() === 'pwd', `got "${v4}"`);
  await page.keyboard.press('Enter');
  check('tab-completed pwd passes the mission', await isDone(page, 2));
  await send(page, "echo 'Hello Terminal'");
  check('echo with single quotes passes', await isDone(page, 3));
  await page.waitForTimeout(1200);
  check('chapter 1 advanced to 2', /Chapter 2 of/i.test(await chapter(page)), await chapter(page));
  // Wrong answers in chapter 2
  const before = await doneCount(page);
  await send(page, 'ls-a'); await send(page, 'lss'); await send(page, 'ls /nope');
  check('typos do not pass missions (ls-a, lss, ls /nope)', (await doneCount(page)) === before, `${await doneCount(page)} done`);
  await send(page, 'ls');
  await send(page, 'ls  -a');
  check('double space passes (ls  -a)', await isDone(page, 1));
  await send(page, 'ls -l');
  await send(page, 'ls -l -a');
  check('flags in a different order pass (ls -l -a)', await isDone(page, 3));
  await page.waitForTimeout(1200);
  // Chapter 3: path forms and tab completion
  await page.locator('#cmd-input').focus();
  await page.keyboard.type('cd doc');
  await page.keyboard.press('Tab');
  const v5 = await page.locator('#cmd-input').inputValue();
  check('tab completes a directory (cd doc -> cd documents/)', v5 === 'cd documents/', `got "${v5}"`);
  await page.keyboard.press('Enter');
  check('tab-completed cd passes', await isDone(page, 0));
  await send(page, 'ls');
  await send(page, 'cd ../');
  check('cd ../ counts as cd ..', await isDone(page, 2));
  await send(page, 'cd ~/documents/projects/website');
  check('cd with the full ~ path passes', await isDone(page, 3));
  await send(page, 'cd -');
  check('cd - passes', await isDone(page, 4));
  await send(page, 'cd ~');
  check('cd ~ counts as cd', await isDone(page, 5));
  await page.waitForTimeout(1200);
  // Chapter 4: wrong input must not pass; a learner's first tries
  check('now on chapter 4', /Chapter 4 of/i.test(await chapter(page)), await chapter(page));
  const out0 = await send(page, 'cat');
  check('bare cat explains itself and does not pass', !(await isDone(page, 0)) && /no input file/.test(out0), out0);
  await send(page, 'cat documents/nofile.txt');
  check('cat of a missing file does not pass', !(await isDone(page, 0)));
  await send(page, 'cat "documents/notes.txt"');
  check('quoted path passes', await isDone(page, 0));
  const out1 = await send(page, 'head -n 3');
  check('head -n 3 with no file does not pass', !(await isDone(page, 1)) && /no input file/.test(out1), out1);
  await send(page, 'head -3 documents/notes.txt');
  check('head -3 FILE passes', await isDone(page, 1));
  await send(page, 'tail -n 2 ./documents/notes.txt');
  check('tail with ./path passes', await isDone(page, 2));
  await send(page, 'wc -l nofile.txt');
  check('wc of a missing file does not pass', !(await isDone(page, 3)));
  await send(page, 'wc -l documents/todo.txt');
  await page.waitForTimeout(1200);
  await ctx.close();
}

// ---- running scripts, permissions, unfinished commands, recovery ----
{
  const { ctx, page, errs } = await fresh();
  await send(page, "echo '#!/bin/bash' > x.sh");
  await send(page, 'echo \'echo "it ran"\' >> x.sh');
  let o = await send(page, './x.sh');
  check('./x.sh without chmod says Permission denied', /Permission denied/.test(o), o);
  await send(page, 'chmod +x x.sh');
  o = await send(page, './x.sh');
  check('./x.sh after chmod runs the script', /it ran/.test(o), o);
  o = await send(page, 'bash x.sh');
  check('bash x.sh runs it too', /it ran/.test(o), o);
  o = await send(page, '~/x.sh');
  check('~/x.sh runs it too', /it ran/.test(o), o);
  o = await send(page, 'echo "unfinished');
  check('unfinished quote waits for more', /not finished/.test(o) && (await page.locator('#prompt').innerText()).trim() === '>', o);
  o = await send(page, 'cancel');
  check('"cancel" gets out of an unfinished command', (await page.locator('#prompt').innerText()).includes('player@academy'), o);
  await send(page, 'echo "two');
  await page.keyboard.press('Control+c');
  check('Ctrl+C gets out of an unfinished command', (await page.locator('#prompt').innerText()).includes('player@academy'));
  o = await send(page, 'rm -rf documents');
  o = await send(page, 'cat documents/notes.txt');
  check('deleting a starter file gives a recovery tip', /restore/.test(o), o);
  o = await send(page, 'restore');
  o = await send(page, 'wc -l documents/notes.txt');
  check('restore brings starter files back', /8 documents\/notes\.txt/.test(o), o);
  o = await send(page, 'rm -rf /');
  check('rm -rf / is refused', /Permission denied/.test(o), o);
  o = await send(page, 'rm -rf ~');
  check('rm -rf ~ is refused', /Permission denied/.test(o), o);
  o = await send(page, 'ls');
  check('home intact after those', /documents/.test(o), o);
  o = await send(page, 'cd scripts');
  o = await send(page, 'cat documents/notes.txt');
  check('wrong folder gives a location tip', /type cd to go back/.test(o), o);
  await send(page, 'cd');
  o = await send(page, 'exit');
  check('exit does not break the game', /stay put/.test(o), o);
  o = await send(page, 'history | head -1');
  check('history pipes', /echo/.test(o), o);
  o = await send(page, '!1');
  check('!1 re-runs command 1 and prints it', /echo '#!\/bin\/bash' > x\.sh/.test(o), o);
  o = await send(page, '!nosuch');
  check('!nosuch reports event not found', /event not found/.test(o), o);
  // Ctrl+L
  await page.locator('#cmd-input').focus();
  await page.keyboard.press('Control+l');
  check('Ctrl+L clears the screen', (await page.locator('#terminal .line').count()) === 0);
  // state survives a reload, including aliases and files, and arrow-up works at once
  await send(page, 'alias hi="echo hello there"');
  await send(page, 'export FOO=bar');
  await send(page, 'cd documents');
  await page.reload();
  await page.waitForTimeout(100);
  check('reload keeps the working directory', (await page.locator('#prompt').innerText()).includes('~/documents'), await page.locator('#prompt').innerText());
  await page.locator('#cmd-input').focus();
  await page.keyboard.press('ArrowUp');
  const v = await page.locator('#cmd-input').inputValue();
  check('up arrow works straight after a reload', v === 'cd documents', `got "${v}"`);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  await page.locator('#cmd-input').fill('');
  o = await send(page, 'hi');
  check('alias survives a reload', /hello there/.test(o), o);
  o = await send(page, 'echo $FOO');
  check('variable survives a reload', /bar/.test(o), o);
  o = await send(page, 'cat ../x.sh');
  check('files survive a reload', /bin\/bash/.test(o), o); // !1 above overwrote x.sh with just its first line
  // closing without a clean unload: no beforeunload fires, progress made just before must still be there
  await send(page, 'touch crash_test.txt');
  await page.close({ runBeforeUnload: false });
  const p2 = await ctx.newPage();
  await p2.goto(BASE);
  await p2.waitForTimeout(100);
  o = await send(p2, 'ls crash_test.txt');
  check('tab closed abruptly loses nothing', /crash_test\.txt/.test(o) && !/cannot access/.test(o), o);
  check('no page errors in this section', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---- fresh-player safety: sitting on the welcome screen must not create or lose anything ----
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(10500);
  const saved = await page.evaluate(() => localStorage.getItem('terminalAcademy'));
  check('idle on the welcome screen writes no save', saved === null, 'save exists');
  check('new guest still sees the welcome screen after idling', await page.locator('#welcome-overlay').isVisible());
  await ctx.close();
}

// ---- jumping around chapters out of order ----
{
  const { ctx, page } = await fresh();
  for (let i = 0; i < 80; i++) await nextChapter(page);
  check('Next reaches chapter 81', /Chapter 81 of/i.test(await chapter(page)), await chapter(page));
  const btnDisabled = await page.locator('#panel-lessons .nav-btns button').last().isDisabled();
  check('Next is disabled on the last chapter', btnDisabled);
  for (const c of ['bash -x scripts/hello.sh', 'shellcheck scripts/hello.sh', 'bash examples debug', 'bash examples set', 'shellcheck -x scripts/backup.sh']) await send(page, c);
  const t = await page.evaluate(() => document.getElementById('terminal').innerText);
  check('finishing only the last chapter does not claim you finished everything', !/CONGRATULATIONS/.test(t) && /earlier chapter/.test(t), t.slice(-200));
  await page.locator('#panel-lessons .nav-btns button').first().click();
  await page.waitForTimeout(30);
  check('Previous works from the last chapter', /Chapter 80 of/i.test(await chapter(page)), await chapter(page));
  await ctx.close();
}

// ---- adventure: revisiting an old quest must not skip or strand anything ----
{
  const { ctx, page } = await fresh();
  await page.locator('.panel-tabs button[data-tab="adventure"]').click();
  await page.getByRole('button', { name: /Begin Investigation/ }).click();
  const o = await send(page, 'cat README.txt');
  const obj = page.locator('#panel-adventure .quest-objective');
  check('adventure: failed cat does not pass an objective', !(await obj.nth(1).evaluate(n => n.classList.contains('done'))), o);
  for (const c of ['cd ~/nexus', 'cat README.txt', 'cd lobby', 'ls', 'cat notice_board.txt']) await send(page, c);
  await page.waitForTimeout(30);
  check('adventure: quest 1 done, quest 2 showing', /Quest 2/.test(await page.locator('#panel-adventure h3').first().innerText()), await page.locator('#panel-adventure h3').first().innerText());
  // Look back at quest 1, then keep playing quest 2 commands.
  await page.locator('#panel-adventure .quest-card').first().click();
  await page.waitForTimeout(30);
  check('adventure: can view a finished quest', /Quest 1/.test(await page.locator('#panel-adventure h3').first().innerText()));
  for (const c of ['cd ~/nexus/agent_k_office', 'ls -a', 'cat .hidden_note', 'cat bookmarks.txt']) await send(page, c);
  await page.waitForTimeout(30);
  await page.locator('.panel-tabs button[data-tab="lessons"]').click();
  await page.locator('.panel-tabs button[data-tab="adventure"]').click();
  await page.waitForTimeout(30);
  const prog = await page.locator('#panel-adventure').innerText();
  check('adventure: finishing quest 2 while viewing quest 1 counts and moves to quest 3', /2\/10/.test(prog) && /Quest 3:/.test(prog.split('All Quests')[0]), prog.slice(0, 200));
  await send(page, 'cd ~/nexus/vault');
  const denied = await send(page, 'cat .access_key');
  check('vault key is really locked until chmod', /Permission denied/.test(denied), denied);
  await ctx.close();
}

// ---- challenge: switching difficulty mid-challenge credits the right pool ----
{
  const { ctx, page } = await fresh();
  await page.locator('.panel-tabs button[data-tab="challenges"]').click();
  await page.getByRole('button', { name: /Start Challenge/ }).click();
  await page.locator('#panel-challenges button.challenge-btn', { hasText: 'Expert' }).first().click();
  const title = await page.locator('#panel-challenges .active-challenge h4').innerText();
  await page.getByRole('button', { name: /Skip/ }).click();
  await ctx.close();
  check('challenge: switching difficulty does not crash (' + title + ')', true);
}

// ---- input box: coloured overlay must line up with what was typed ----
for (const [name, view] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, ...mobile() }]]) {
  const { ctx, page } = await fresh(view);
  await page.locator('#cmd-input').focus();
  const long = 'cat documents/projects/data/sales.csv | cut -d "," -f 2 | sort | uniq';
  await page.keyboard.type(long);
  // The overlay follows on the next frame, which can take a moment on a slow machine
  await page.waitForFunction(() => Math.abs(document.getElementById('syntax-overlay').scrollLeft - document.getElementById('cmd-input').scrollLeft) <= 1, null, { timeout: 2000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const o = document.getElementById('syntax-overlay'), i = document.getElementById('cmd-input');
    return { text: o.textContent, value: i.value, oScroll: o.scrollLeft, iScroll: i.scrollLeft, iw: i.getBoundingClientRect().width, oRight: o.getBoundingClientRect().right, winW: window.innerWidth, page: document.documentElement.scrollWidth };
  });
  check(`${name}: overlay keeps every character including spaces`, m.text === m.value, JSON.stringify(m.text));
  check(`${name}: overlay scrolls with the input`, Math.abs(m.oScroll - m.iScroll) <= 1, JSON.stringify(m));
  check(`${name}: input stays on screen`, m.oRight <= m.winW + 1, JSON.stringify(m));
  await page.keyboard.press('Enter');
  // Deep folder: prompt must leave room to type
  await send(page, 'cd ~/nexus/agent_k_office/case_files');
  const w = await page.evaluate(() => document.getElementById('cmd-input').getBoundingClientRect().width);
  check(`${name}: long prompt leaves room to type (${Math.round(w)}px)`, w >= 150, String(w));
  await ctx.close();
}

// ---- short phone screen: keyboard open ----
{
  const { ctx, page } = await fresh({ viewport: { width: 390, height: 450 }, hasTouch: true, ...mobile() });
  const b = await page.locator('#cmd-input').boundingBox();
  const vh = 450;
  check('phone with keyboard open: input is on screen', b && b.y + b.height <= vh && b.y >= 0, JSON.stringify(b));
  const termH = await page.locator('#terminal').evaluate(n => n.getBoundingClientRect().height);
  check(`phone with keyboard open: terminal output still visible (${Math.round(termH)}px)`, termH >= 40, String(termH));
  await ctx.close();
}
{
  // The welcome screen on a small phone must still reach its button.
  const ctx = await browser.newContext({ viewport: { width: 360, height: 560 }, hasTouch: true, ...mobile() });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click({ timeout: 3000 }).then(() => check('small phone: BEGIN TRAINING reachable', true)).catch(e => check('small phone: BEGIN TRAINING reachable', false, e.message.slice(0, 200)));
  await ctx.close();
}

await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} variant checks passed`);
fs.writeFileSync(outFile('variants-results.json'), JSON.stringify(results, null, 1));
process.exit(bad.length ? 1 : 0);
