// Moving a save between browsers. A save is untrusted input, so most of this file is hostile saves: each goes in
// as a pasted code, as a file, and straight into browser storage, then the game is played a little to prove
// nothing ran and nothing broke. The page is only driven the way a person would; game functions are only read.
import fs from 'fs';
import http from 'http';
import zlib from 'zlib';
import { BASE, BROWSER, ORIGIN, launch, mobile, outFile } from './lib.mjs';

const browser = await launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) console.log(`FAIL  ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
};
const outbound = [];
const H = '<img src=x onerror=window.__xss=1><svg onload=window.__xss=1><script>window.__xss=1</script>';
const KEY = 'terminalAcademy';

async function open({ storage, view } = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, ...view });
  if (storage !== undefined) {
    await ctx.addInitScript(([key, raw]) => {
      try { if (localStorage.getItem(key) === null) localStorage.setItem(key, raw); } catch (e) { /* about:blank */ }
    }, [KEY, storage]);
  }
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push('page error: ' + e.message));
  page.on('dialog', d => { page.errs.push('dialog: ' + d.message()); d.dismiss(); });
  page.on('request', r => { if (!r.url().startsWith(ORIGIN + '/') && !/^(data|blob):/.test(r.url()) && !r.url().endsWith('/leak')) outbound.push(r.url()); });
  await page.goto(BASE);
  if (await page.locator('#welcome-overlay').isVisible()) await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  return { ctx, page };
}

async function send(page, line) {
  await page.evaluate(() => { window.__m = document.getElementById('terminal').lastElementChild; });
  await page.locator('#cmd-input').focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  return page.evaluate(() => {
    const all = [...document.getElementById('terminal').children];
    const i = window.__m && window.__m.isConnected ? all.indexOf(window.__m) : -1;
    return all.slice(i + 1).map(n => n.textContent).join('\n');
  });
}

const tab = (page, name) => page.locator(`.panel-tabs button[data-tab="${name}"]`).click();
const stored = page => page.evaluate(k => localStorage.getItem(k), KEY);
// What a save holds, read from the game. Aliases and functions never travel, so they aren't compared.
const snapshot = page => page.evaluate(() => {
  const s = buildSaveObject();
  delete s.aliases;
  delete s.functions;
  const sorted = v => Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  return JSON.stringify(sorted(s));
});
// Says which fields differ, so a failed round trip names what got lost.
const differs = (a, b) => {
  const x = JSON.parse(a), y = JSON.parse(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
    .map(k => `${k}: ${JSON.stringify(x[k])?.slice(0, 200)} -> ${JSON.stringify(y[k])?.slice(0, 200)}`).join(' | ');
};
const sameSave = async (name, page, before) => {
  const now = await snapshot(page);
  check(name, now === before, differs(before, now));
};

// Everything that could show a saved value on screen, then a look for anything that shouldn't be in the document.
async function playAndScan(page, extra = []) {
  const problems = [];
  for (const t of ['lessons', 'adventure', 'challenges', 'quiz', 'achievements', 'glossary', 'save', 'lessons']) await tab(page, t);
  const cmds = ['history', 'env', 'set', 'pwd', 'ls -la', 'ls -R', 'ls -la /', 'git log', 'git status', 'git branch', 'pbpaste', 'crontab -l', 'alias', 'echo $PS1', 'declare -a', 'cd -', 'cd ~', ...extra];
  for (const c of cmds) await send(page, c);
  const who = await send(page, 'whoami');
  if (!who.includes('player')) problems.push(`whoami stopped working: ${who.slice(0, 120)}`);
  const seen = await page.evaluate(() => ({
    fired: window.__xss === 1,
    tags: [...document.querySelectorAll('img,svg,iframe,object,embed,video,audio,link:not([rel=icon]),base,form,math')].map(e => e.tagName),
    scripts: document.querySelectorAll('script').length,
    handlers: [...document.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) && /__xss/.test(a.value)).map(a => a.name)),
    style: [...document.querySelectorAll('style')].length,
  }));
  if (seen.fired) problems.push('a saved value ran as code');
  if (seen.tags.length) problems.push('elements from the save reached the page: ' + seen.tags);
  if (seen.scripts !== 1) problems.push(`${seen.scripts} script elements`);
  if (seen.style !== 1) problems.push(`${seen.style} style elements`);
  if (seen.handlers.length) problems.push('event handlers from the save: ' + seen.handlers);
  problems.push(...page.errs);
  return problems;
}

async function tryImport(page, channel, text) {
  await tab(page, 'save');
  if (channel === 'file') {
    await page.setInputFiles('#save-file', { name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  } else {
    await page.locator('#save-code-in').fill(text);
    await page.getByRole('button', { name: 'Check this code' }).click();
  }
  await page.waitForFunction(() => document.getElementById('save-status').textContent !== '', null, { timeout: 60000 });
  return { accepted: await page.locator('#save-confirm').isVisible(), status: await page.locator('#save-status').textContent() };
}

async function confirmLoad(page) {
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Load this save' }).click();
  await loaded;
  await page.waitForFunction(() => document.getElementById('terminal').children.length > 0);
}

const code1 = o => 'TA1.' + zlib.deflateRawSync(Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))).toString('base64url');
const code0 = o => 'TA0.' + Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

// ---- A real save to start from ----
const { ctx: goodCtx, page: goodPage } = await open();
for (const c of ['whoami', 'hostname', 'pwd', 'mkdir -p ~/moved/deep', 'echo carried > ~/moved/deep/a.txt', 'cd ~/moved', 'export CARRY=yes', 'git init', 'git add .', 'git commit -m first', 'cd ~']) await send(goodPage, c);
const good = await goodPage.evaluate(() => JSON.parse(currentSaveJson()));
const questId = await goodPage.evaluate(() => adventureQuests[0].id);
await goodCtx.close();
const clone = () => JSON.parse(JSON.stringify(good));
const homeOf = w => w.save.fs['/'].children.home.children.player;
const setOwn = (o, k, value) => Object.defineProperty(o, k, { value, enumerable: true, writable: true, configurable: true });
const fileNode = content => ({ type: 'file', permissions: 'rw-r--r--', content });
const edit = fn => { const w = clone(); fn(w); return JSON.stringify(w); };
const field = (key, value) => edit(w => { w.save[key] = value; });

// ---- Saves that must be refused ----
const refused = [
  ['plain text', 'hello there'],
  ['nothing', '   '],
  ['broken JSON', '{"app":"terminal-academy"'],
  ['null', 'null'],
  ['a list', '[]'],
  ['a number', '123'],
  ['a string', '"terminal-academy"'],
  ['HTML', H],
  ['a code of garbage', 'TA1.!!!not-base64!!!'],
  ['a code that is not deflate', 'TA1.AAAAAAAAAAAA'],
  ['a plain code of garbage', code0('garbage')],
  ['a code holding HTML', code1(H)],
  ['a code cut in half', code1(JSON.stringify(good)).slice(0, 400)],
  ['another game', edit(w => { w.app = 'something-else'; })],
  ['no app name', edit(w => { delete w.app; })],
  ['a newer version', edit(w => { w.saveVersion = 2; })],
  ['version zero', edit(w => { w.saveVersion = 0; })],
  ['version as text', edit(w => { w.saveVersion = '1'; })],
  ['version as a fraction', edit(w => { w.saveVersion = 1.5; })],
  ['no save inside', edit(w => { delete w.save; })],
  ['save is null', edit(w => { w.save = null; })],
  ['save is a list', edit(w => { w.save = []; })],
  ['save is text', edit(w => { w.save = H; })],
  ['save is empty', edit(w => { w.save = {}; })],
  ['xp is HTML', field('xp', H)],
  ['xp is negative', field('xp', -1)],
  ['xp is a fraction', field('xp', 1.5)],
  ['xp is huge', field('xp', 1e30)],
  ['level is HTML', field('level', H)],
  ['level is zero', field('level', 0)],
  ['command count is HTML', field('commandCount', H)],
  ['chapter is HTML', field('currentLesson', H)],
  ['chapter is a fraction', field('currentLesson', 1.5)],
  ['chapter list is HTML', field('completedLessons', H)],
  ['chapter list holds HTML', field('completedLessons', [0, H])],
  ['task list holds HTML', field('completedTasks', { 0: [H] })],
  ['task list is text', field('completedTasks', H)],
  ['achievements is text', field('achievements', H)],
  ['quest number is HTML', field('advCurrentQuest', H)],
  ['quest started is text', field('advStarted', H)],
  ['quest progress holds HTML', field('advQuestProgress', { [questId]: [H] })],
  ['challenge list is text', field('challengeCompleted', H)],
  ['challenge total is HTML', field('challengeTotalCompleted', H)],
  ['best streak is HTML', field('challengeBestStreak', H)],
  ['daily streak is HTML', field('challengeDailyStreak', H)],
  ['quiz right count is HTML', field('quizAllTimeCorrect', H)],
  ['quiz total is HTML', field('quizAllTimeTotal', H)],
  ['quiz history count is HTML', field('quizSessionHistory', { basics: { correct: H, total: 1 } })],
  ['quiz history is text', field('quizSessionHistory', H)],
  ['history is text', field('history', H)],
  ['history holds an object', field('history', [{ a: 1 }])],
  ['variables is a list', field('envVars', [H])],
  ['variable value is an object', field('envVars', { A: { b: 1 } })],
  ['arrays is text', field('arrays', H)],
  ['clipboard is a number', field('clipboard', 5)],
  ['venv is a number', field('venv', 5)],
  ['current folder is a number', field('cwd', 5)],
  ['git is text', field('git', H)],
  ['git commit hash is HTML', edit(w => { w.save.git.commits[0].hash = H; })],
  ['git branches is text', edit(w => { w.save.git.branches = H; })],
  ['files is text', field('fs', H)],
  ['files has no root', field('fs', {})],
  ['root is a file', field('fs', { '/': fileNode('x') })],
  ['no home folder', edit(w => { delete w.save.fs['/'].children.home; })],
  ['home is a file', edit(w => { w.save.fs['/'].children.home.children.player = fileNode('x'); })],
  ['no /dev', edit(w => { delete w.save.fs['/'].children.dev; })],
  ['unknown node type', edit(w => { homeOf(w).children.x = { type: H, permissions: 'rw-r--r--' }; })],
  ['node with no type', edit(w => { homeOf(w).children.x = { permissions: 'rw-r--r--' }; })],
  ['node is text', edit(w => { homeOf(w).children.x = H; })],
  ['HTML in permissions', edit(w => { homeOf(w).children.x = { ...fileNode('x'), permissions: H }; })],
  ['file content is a number', edit(w => { homeOf(w).children.x = { ...fileNode('x'), content: 5 }; })],
  ['folder children is a list', edit(w => { homeOf(w).children.x = { type: 'dir', permissions: 'rwxr-xr-x', children: [] }; })],
  ['file name with a slash', edit(w => { homeOf(w).children['a/b'] = fileNode('x'); })],
  ['file name ..', edit(w => { homeOf(w).children['..'] = fileNode('x'); })],
  ['file name .', edit(w => { homeOf(w).children['.'] = fileNode('x'); })],
  ['empty file name', edit(w => { homeOf(w).children[''] = fileNode('x'); })],
  ['file name __proto__', edit(w => { setOwn(homeOf(w).children, '__proto__', fileNode('x')); })],
  ['link target is a number', edit(w => { homeOf(w).children.x = { type: 'symlink', permissions: 'rwxrwxrwx', target: 5 }; })],
  ['owner is an object', edit(w => { homeOf(w).children.x = { ...fileNode('x'), owner: {} }; })],
  ['size is negative', edit(w => { homeOf(w).children.x = { ...fileNode('x'), size: -1 }; })],
  ['archive is text', edit(w => { homeOf(w).children.x = { ...fileNode('x'), archive: H }; })],
  ['archive entry is text', edit(w => { homeOf(w).children.x = { ...fileNode('x'), archive: [H] }; })],
  ['archive listing is text', edit(w => { homeOf(w).children.x = { ...fileNode('x'), listing: H }; })],
  ['folders nested too deep', edit(w => {
    let d = homeOf(w);
    for (let i = 0; i < 60; i++) { d.children.d = { type: 'dir', permissions: 'rwxr-xr-x', children: {} }; d = d.children.d; }
  })],
  ['too many files', edit(w => {
    for (let i = 0; i < 20001; i++) homeOf(w).children['f' + i] = fileNode('');
  })],
  ['JSON nested a million deep', '['.repeat(1000000)],
  ['JSON bigger than a save can be', edit(w => { homeOf(w).children.big = fileNode('x'.repeat(4100000)); }), 'file'],
  ['more than 8 MB of text', 'x'.repeat(8100000), 'file'],
  ['a small code that unpacks to 200 MB', 'TA1.' + zlib.deflateRawSync(Buffer.alloc(200 * 1024 * 1024, 32)).toString('base64url')],
];

for (const [name, text, only] of refused) {
  for (const channel of only ? [only] : ['paste', 'file']) {
    const { ctx, page } = await open();
    await send(page, 'whoami');
    await page.waitForFunction(k => localStorage.getItem(k) !== null || true, KEY);
    const before = await snapshot(page);
    const r = await tryImport(page, channel, text);
    check(`refused (${channel}): ${name}`, !r.accepted, r.status);
    check(`refused without a change (${channel}): ${name}`, await snapshot(page) === before);
    const status = await page.locator('#save-status').innerHTML();
    check(`refusal shown as text (${channel}): ${name}`, !/<(img|svg|script)/.test(status), status);
    const fired = await page.evaluate(() => window.__xss === 1);
    check(`nothing ran (${channel}): ${name}`, !fired && page.errs.length === 0, page.errs.join(' | '));
    await ctx.close();
  }
}

// ---- Saves that load, with anything unsafe dropped or kept only as text ----
const dirNode = children => ({ type: 'dir', permissions: 'rwxr-xr-x', children });
const accepted = [
  ['an untouched save', edit(() => {})],
  ['chapter below range', field('currentLesson', -1)],
  ['chapter above range', field('currentLesson', 9999)],
  ['chapter list out of range', field('completedLessons', [9999, -1, 0])],
  ['quest number out of range', field('advCurrentQuest', 9999)],
  ['unknown fields', edit(w => { w.save.evil = H; w.save.state = { fs: H }; w[H] = H; })],
  ['__proto__ at the top', edit(w => { setOwn(w.save, '__proto__', { xp: H, fs: H }); setOwn(w, '__proto__', { save: H }); })],
  ['__proto__ in a variable', edit(w => { setOwn(w.save.envVars, '__proto__', H); })],
  ['__proto__ as a chapter', edit(w => { setOwn(w.save.completedTasks, '__proto__', [1]); })],
  ['__proto__ in arrays', edit(w => { w.save.arrays = {}; setOwn(w.save.arrays, '__proto__', [H]); })],
  ['__proto__ inside a map', edit(w => { w.save.arrays = { m: {} }; setOwn(w.save.arrays.m, '__proto__', H); })],
  ['unknown achievement', field('achievements', [H, 'first_command'])],
  ['unknown quest', field('advCompletedQuests', [H])],
  ['unknown quest progress', field('advQuestProgress', { [H]: [0] })],
  ['unknown chapter in tasks', field('completedTasks', { 99999: [0], [H]: [1] })],
  ['unknown challenge level', field('challengeCompleted', { [H]: [0], constructor: [1] })],
  ['unknown quiz category', field('quizSessionHistory', { [H]: { correct: 1, total: 1 } })],
  ['current folder is HTML', field('cwd', '/' + H)],
  ['current folder is missing', field('cwd', '/no/such/folder')],
  ['current folder is a file', field('cwd', '/home/player/documents/notes.txt')],
  ['current folder is not canonical', field('cwd', '/home/../home/./player')],
  ['previous folder is HTML', field('prevDir', '/' + H)],
  ['HTML in history', field('history', [H, 'echo ' + H])],
  ['HTML in visited folders', field('dirsVisited', [H])],
  ['HTML in files read', field('filesRead', [H])],
  ['HTML in man pages', field('manPagesRead', [H])],
  ['HTML in shortcuts', field('shortcutsLearned', [H])],
  ['HTML in explored features', edit(w => { w.save.claudeFeaturesExplored = [H]; w.save.warpFeaturesExplored = [H]; })],
  ['HTML in tool lists', edit(w => { w.save.macosCommandsUsed = [H]; w.save.modernToolsUsed = [H]; })],
  ['HTML in a variable value', field('envVars', { EVIL: H, PS1: H, HOME: H, PATH: H })],
  ['HTML as a variable name', field('envVars', { [H]: 'x' })],
  ['HTML in an array', field('arrays', { good: [H], map: { [H]: H }, [H]: [H] })],
  ['HTML in the clipboard', field('clipboard', H)],
  ['HTML as the venv', field('venv', H)],
  ['HTML in cron jobs', field('cronJobs', [H])],
  ['bad daily date', field('challengeLastDailyDate', H)],
  ['HTML in a git message', edit(w => { w.save.git.commits[0].msg = H; })],
  ['HTML in a git date', edit(w => { w.save.git.commits[0].date = H; })],
  ['HTML in a git branch', edit(w => { w.save.git.branch = H; w.save.git.branches = [H]; })],
  ['HTML in git files', edit(w => { w.save.git.staged = [H]; w.save.git.tracked = [H]; })],
  ['HTML as the git folder', edit(w => { w.save.git.root = H; })],
  ['HTML as a file name', edit(w => { homeOf(w).children[H.replace(/\//g, '')] = fileNode('x'); })],
  ['HTML in a file', edit(w => { homeOf(w).children.evil = fileNode(H); }), ['cat ~/evil', 'head ~/evil', 'grep img ~/evil', 'wc ~/evil']],
  ['HTML as an owner', edit(w => { homeOf(w).children.evil = { ...fileNode('x'), owner: H, group: H }; })],
  ['HTML as a link target', edit(w => { homeOf(w).children.evil = { type: 'symlink', permissions: 'rwxrwxrwx', target: H }; }), ['cat ~/evil', 'readlink ~/evil']],
  ['a link that points at itself', edit(w => {
    homeOf(w).children.a = { type: 'symlink', permissions: 'rwxrwxrwx', target: '/home/player/b' };
    homeOf(w).children.b = { type: 'symlink', permissions: 'rwxrwxrwx', target: '/home/player/a' };
  }), ['cat ~/a', 'cd ~/a', 'ls ~/a']],
  ['HTML in an archive', edit(w => {
    homeOf(w).children['evil.tar.gz'] = { ...fileNode('x'), archive: [{ name: H.replace(/\//g, ''), node: fileNode(H) }], listing: [H] };
  }), ['tar -tzf ~/evil.tar.gz', 'tar -xzf ~/evil.tar.gz']],
  ['HTML as compressed text', edit(w => { homeOf(w).children['evil.gz'] = { ...fileNode('x'), original: H }; }), ['gunzip ~/evil.gz', 'cat ~/evil']],
  ['files named like built-ins', edit(w => {
    for (const n of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) homeOf(w).children[n] = fileNode('plain');
  }), ['cat ~/constructor', 'ls ~/toString']],
  ['aliases and functions', edit(w => { w.save.aliases = { ls: 'echo taken', whoami: 'echo taken' }; w.save.functions = { pwd: 'echo taken' }; })],
  ['a 2 MB file', edit(w => { homeOf(w).children.big = fileNode('x'.repeat(2000000)); })],
];

for (const [name, text, cmds] of accepted) {
  if (process.env.VERBOSE) console.log('loading:', name);
  const { ctx: fileCtx, page: filePage } = await open();
  const viaFile = await tryImport(filePage, 'file', text);
  check(`accepted (file): ${name}`, viaFile.accepted, viaFile.status);
  await fileCtx.close();

  const { ctx, page } = await open();
  const r = await tryImport(page, 'paste', code1(text));
  check(`accepted (code): ${name}`, r.accepted, r.status);
  if (r.accepted) {
    const summary = await page.locator('#save-summary').textContent();
    check(`summary is only numbers from here: ${name}`, !/<|onerror/.test(summary), summary);
    await confirmLoad(page);
    const problems = await playAndScan(page, cmds);
    check(`played after loading: ${name}`, problems.length === 0, problems.join(' | '));
    await page.reload();
    const again = await playAndScan(page);
    check(`played after a reload: ${name}`, again.length === 0, again.join(' | '));
  }
  await ctx.close();
}

{
  const { ctx, page } = await open();
  await tryImport(page, 'paste', accepted.find(a => a[0] === 'aliases and functions')[1]);
  await confirmLoad(page);
  const ls = await send(page, 'ls');
  const who = await send(page, 'whoami');
  const pwd = await send(page, 'pwd');
  check('a save cannot change what commands do', !/taken/.test(ls + who + pwd), ls + who + pwd);
  const alias = await send(page, 'alias');
  check('no aliases arrive with a save', !/taken/.test(alias), alias);
  await ctx.close();
}

// ---- The same saves, already sitting in browser storage (another page on this origin could have put them there) ----
const storedSaves = [
  ...[...refused, ...accepted].filter(([, text, only]) => only !== 'file').map(([name, text, third]) => {
    let raw = text;
    try { const w = JSON.parse(text); if (w && w.save !== undefined) raw = JSON.stringify(w.save); } catch (e) { /* not JSON, stays as it is */ }
    return [name, raw, Array.isArray(third) ? third : []];
  }),
  ['aliases that hold HTML', JSON.stringify({ ...good.save, aliases: { [H]: H, ok: H }, functions: { [H]: H, fn: H } }), ['ok', 'fn', 'type ok']],
];
for (const [name, raw, cmds] of storedSaves) {
  if (raw.length > 5000000) continue; // browsers won't store this much
  const { ctx, page } = await open({ storage: raw });
  const problems = await playAndScan(page, cmds);
  check(`in browser storage: ${name}`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---- A real round trip ----
async function playSome(page) {
  for (const c of ['whoami', 'hostname', 'pwd', 'echo "Hello Terminal"']) await send(page, c);
  await page.locator('#panel-lessons .chapter-label', { hasText: /Chapter 2 of/i }).first().waitFor(); // the game moves on by itself after a moment
  for (const c of ['mkdir -p ~/moved/deep', 'echo carried > ~/moved/deep/a.txt', 'cd ~/moved', 'export CARRY=yes',
    "alias zz='echo hi'", 'git init', 'git add .', 'git commit -m first', 'cd ~', 'tar -czf ~/a.tar.gz moved', 'gzip -k ~/documents/todo.txt', 'ln -s moved/deep/a.txt lnk', 'chmod 600 ~/moved/deep/a.txt', 'echo hi | pbcopy', 'mkfifo ~/pipe', 'arr=(one two)', 'cd ~/moved/deep']) await send(page, c);
  await tab(page, 'quiz');
  await page.locator('#panel-quiz .quiz-category-btn').first().click();
  await page.locator('#panel-quiz .quiz-option').first().click();
  await page.getByRole('button', { name: /Quit Quiz/ }).click();
  await tab(page, 'adventure');
  await tab(page, 'lessons');
}

{
  const { ctx, page } = await open();
  await playSome(page);
  const before = await snapshot(page);
  const beforeChapter = await page.locator('#panel-lessons .chapter-label').first().innerText();
  const beforeXp = await page.locator('#xp-text').innerText();
  check('some progress exists to move', JSON.parse(before).completedLessons.length === 1, before.slice(0, 200));

  // By file
  await tab(page, 'save');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download save file' }).click()]);
  check('save file has a clear name', /^terminal-academy-save-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const fileText = fs.readFileSync(await dl.path(), 'utf8');
  const parsed = JSON.parse(fileText);
  check('save file says what it is', parsed.app === 'terminal-academy' && parsed.saveVersion === 1 && !!parsed.save);
  check('save file leaves out aliases and functions', !('aliases' in parsed.save) && !('functions' in parsed.save));
  const { ctx: a, page: pa } = await open();
  const ra = await tryImport(pa, 'file', fileText);
  check('file loads in a fresh browser', ra.accepted, ra.status);
  const sumA = await pa.locator('#save-summary').textContent();
  check('summary says what is in the save', /1 of 81 chapters done, on chapter 2/.test(sumA), sumA);
  check('summary warns it replaces progress', /replaces the progress/.test(sumA) && /Aliases and shell functions stay behind/.test(sumA), sumA);
  await confirmLoad(pa);
  await sameSave('file round trip keeps everything', pa, before);
  check('chapter arrives', (await pa.locator('#panel-lessons .chapter-label').first().innerText()) === beforeChapter);
  check('XP arrives', (await pa.locator('#xp-text').innerText()) === beforeXp);
  check('files arrive', /carried/.test(await send(pa, 'cat ~/moved/deep/a.txt')));
  check('current folder arrives', /moved\/deep/.test(await send(pa, 'pwd')));
  check('variables arrive', /yes/.test(await send(pa, 'echo $CARRY')));
  check('git history arrives', /first/.test(await send(pa, 'cd ~/moved && git log --oneline')));
  check('a loaded game keeps playing', pa.errs.length === 0, pa.errs.join(' | '));
  await pa.reload();
  check('a loaded game survives a reload', /moved\/deep|moved/.test(await send(pa, 'pwd')) && /carried/.test(await send(pa, 'cat ~/moved/deep/a.txt')));
  await a.close();

  // By code
  await page.getByRole('button', { name: 'Show save code' }).click();
  await page.waitForFunction(() => /^TA[01]\./.test(document.getElementById('save-code-out').value));
  const code = await page.locator('#save-code-out').inputValue();
  check('code is compressed', code.startsWith('TA1.'), code.slice(0, 10));
  console.log(`Code for a save early in the course: ${code.length} characters`);
  await page.getByRole('button', { name: 'Copy code' }).click();
  await page.waitForFunction(() => /copied|blocked/i.test(document.getElementById('save-status').textContent));
  check('copy says it worked', /Code copied/.test(await page.locator('#save-status').textContent()), await page.locator('#save-status').textContent());
  const { ctx: b, page: pb } = await open();
  const rb = await tryImport(pb, 'paste', code);
  check('code loads in a fresh browser', rb.accepted, rb.status);
  await confirmLoad(pb);
  await sameSave('code round trip keeps everything', pb, before);
  await b.close();
  const { ctx: b2, page: pb2 } = await open();
  const wrapped = code.replace(/(.{60})/g, '$1\n');
  const rb2 = await tryImport(pb2, 'paste', `  ${wrapped}\n`);
  check('a code broken across lines by a messenger still loads', rb2.accepted, rb2.status);
  await b2.close();
  const { ctx: b3, page: pb3 } = await open();
  const rb3 = await tryImport(pb3, 'paste', code0(fileText));
  check('an uncompressed code loads', rb3.accepted, rb3.status);
  await confirmLoad(pb3);
  await sameSave('uncompressed code keeps everything', pb3, before);
  await b3.close();

  // Replacing progress that already exists, and backing out
  const { ctx: c, page: pc } = await open();
  await send(pc, 'whoami');
  await send(pc, 'touch ~/mine.txt');
  await pc.waitForTimeout(100);
  const own = await snapshot(pc);
  const rc = await tryImport(pc, 'paste', code);
  check('checking a save changes nothing', rc.accepted && await snapshot(pc) === own);
  await pc.getByRole('button', { name: 'Cancel' }).click();
  check('cancel says nothing changed', /Nothing changed/.test(await pc.locator('#save-status').textContent()));
  check('cancel hides the question', !(await pc.locator('#save-confirm').isVisible()));
  check('cancel changes nothing', await snapshot(pc) === own);
  await pc.reload();
  check('cancelled game is still there', /mine\.txt/.test(await send(pc, 'ls ~')));
  await tryImport(pc, 'paste', code);
  await confirmLoad(pc);
  await sameSave('loading replaces existing progress', pc, before);
  check('the replaced game is gone', !/mine\.txt/.test(await send(pc, 'ls ~')));
  await c.close();

  // Bigger than Safari will keep: it may be refused, but only ever with a clear message and the game still running
  const { ctx: big, page: pBig } = await open();
  await send(pBig, 'whoami');
  const rBig = await tryImport(pBig, 'paste', code1(edit(w => { homeOf(w).children.big = fileNode('x'.repeat(3500000)); })));
  check('a 3.5 MB save passes the checks', rBig.accepted, rBig.status);
  await tab(pBig, 'save');
  const bigLoaded = pBig.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false);
  await pBig.getByRole('button', { name: 'Load this save' }).click();
  if (await bigLoaded) check('a 3.5 MB save loads', /player/.test(await send(pBig, 'whoami')));
  else {
    check('a 3.5 MB save the browser refuses says so', /wouldn't store it/.test(await pBig.locator('#save-status').textContent()), await pBig.locator('#save-status').textContent());
    check('the game keeps running after that refusal', /player/.test(await send(pBig, 'whoami')));
  }
  await big.close();

  // Browser storage that won't take it
  const { ctx: d, page: pd } = await open();
  await send(pd, 'whoami');
  const rd = await tryImport(pd, 'paste', code);
  check('a good code is accepted before storage fails', rd.accepted, rd.status);
  await pd.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await pd.getByRole('button', { name: 'Load this save' }).click();
  check('full storage gives a clear message', /wouldn't store it/.test(await pd.locator('#save-status').textContent()), await pd.locator('#save-status').textContent());
  check('full storage keeps the current game', /player/.test(await send(pd, 'whoami')));
  await d.close();
  await ctx.close();
}

// ---- Phone ----
{
  const view = { viewport: { width: 390, height: 844 }, hasTouch: true, ...mobile() };
  const { ctx, page } = await open({ view });
  await send(page, 'whoami');
  await page.locator('.panel-tabs button[data-tab="save"]').tap();
  await page.locator('#panel-save').waitFor();
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    boxFont: getComputedStyle(document.getElementById('save-code-in')).fontSize,
    wide: [...document.querySelectorAll('#panel-save *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.tagName + '#' + e.id),
  }));
  check('save tab fits a phone', layout.scroll <= layout.inner && layout.wide.length === 0, JSON.stringify(layout));
  check('paste box will not zoom the page on iPhone', layout.boxFont === '16px', layout.boxFont);
  await page.getByRole('button', { name: 'Show save code' }).tap();
  await page.waitForFunction(() => /^TA[01]\./.test(document.getElementById('save-code-out').value));
  await page.screenshot({ path: outFile(`save-phone-${BROWSER}.png`).pathname });
  const code = await page.locator('#save-code-out').inputValue();
  const { ctx: c2, page: p2 } = await open({ view });
  await p2.locator('.panel-tabs button[data-tab="save"]').tap();
  await p2.locator('#save-code-in').fill(code);
  await p2.getByRole('button', { name: 'Check this code' }).tap();
  await p2.locator('#save-confirm').waitFor();
  const loaded = p2.waitForEvent('load');
  await p2.getByRole('button', { name: 'Load this save' }).tap();
  await loaded;
  check('code moves between phones', /Chapter 1 of/i.test(await p2.locator('#panel-lessons .chapter-label').first().innerText()));
  await ctx.close();
  await c2.close();
}

// ---- The only connection the page can make is the usage counter, enforced by the browser ----
{
  const { ctx, page } = await open();
  await page.screenshot({ path: outFile(`save-desktop-${BROWSER}.png`).pathname });
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  check('the page carries a security policy', /default-src 'none'/.test(csp) && !/unsafe-eval/.test(csp) && /connect-src https:\/\/us\.i\.posthog\.com;/.test(csp), csp);
  const source = await page.evaluate(() => document.querySelector('script').textContent);
  check('the page has no eval or new Function', !/\beval\(|\bFunction\(/.test(source));
  // A server the page could reach if the policy let it. What counts is what arrives here, since a browser may report a blocked request as started.
  let arrived = 0;
  const leak = http.createServer((req, res) => { arrived++; res.setHeader('Access-Control-Allow-Origin', '*'); res.end('ok'); });
  await new Promise(resolve => leak.listen(0, '127.0.0.1', resolve));
  const leakUrl = `http://127.0.0.1:${leak.address().port}/leak`;
  const tried = await page.evaluate(async url => {
    const out = {};
    try { await fetch(url); out.fetch = 'sent'; } catch (e) { out.fetch = 'blocked'; }
    try {
      await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.onload = res; x.onerror = rej; x.send(); });
      out.xhr = 'sent';
    } catch (e) { out.xhr = 'blocked'; }
    await new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = url; });
    try { navigator.sendBeacon(url, 'x'); } catch (e) { /* blocked is fine */ }
    try { new WebSocket(url.replace('http', 'ws')); } catch (e) { /* blocked is fine */ }
    try { new Function('return 1')(); out.fn = 'ran'; } catch (e) { out.fn = 'blocked'; }
    return out;
  }, leakUrl);
  await page.waitForTimeout(500);
  leak.close();
  check('the browser blocks fetch and XHR from this page', tried.fetch === 'blocked' && tried.xhr === 'blocked', JSON.stringify(tried));
  check('the browser blocks text being run as code', tried.fn === 'blocked', JSON.stringify(tried));
  check('nothing reached a server, by fetch, XHR, image, beacon, or socket', arrived === 0, `${arrived} requests arrived`);
  const help = await send(page, 'help');
  check('help points at the Save tab', /Save tab/.test(help));
  await ctx.close();
}
check('nothing was sent anywhere during this whole run', outbound.length === 0, outbound.join(', '));

await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} save checks passed on ${BROWSER} (${refused.length} saves refused, ${accepted.length} loaded and played, ${storedSaves.length} already in storage)`);
fs.writeFileSync(outFile(`save-results-${BROWSER}.json`), JSON.stringify(results, null, 1));
process.exit(bad.length ? 1 : 0);
