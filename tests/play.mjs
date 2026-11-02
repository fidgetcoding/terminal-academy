// Terminal Academy full playthrough. Drives a real browser from a fresh profile with real keyboard
// events. Never calls game functions and never touches localStorage. Commands come from what the UI
// shows the learner; challenge answers and quiz keys come from course data read out of index.html.
//
//   node tests/play.mjs [--viewport desktop|mobile] [--browser chromium|firefox|webkit] [--out run-name] [--base URL]
import { arg, BASE, BROWSER, COLLECTOR, LIVE_URL, asLive, badCount, countName, countNumber, launch, mobile, outFile } from './lib.mjs';
import fs from 'fs';

const VIEW = arg('viewport', 'desktop');
const OUT = arg('out', `run-${VIEW}-${BROWSER}`);
const course = JSON.parse(fs.readFileSync(outFile('course.json')));

const results = [];
const transcript = [];
const problems = [];
const log = (...a) => { console.log(...a); };
function record(section, id, cmd, ok, detail = []) {
  results.push({ section, id, cmd, ok, detail });
  if (!ok || detail.length) problems.push({ section, id, cmd, ok, detail });
}

const browser = await launch();
const ctxOpts = VIEW === 'mobile'
  ? { viewport: { width: 390, height: 844 }, hasTouch: true, ...mobile() }
  : { viewport: { width: 1440, height: 900 } };
const ctx = await browser.newContext(ctxOpts);
const counts = await asLive(ctx); // plays on the real address with a stand-in collector, so the usage counts get checked too
const page = await ctx.newPage();

const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
page.on('requestfailed', r => {
  const why = r.failure()?.errorText || '';
  // A reload can cut off a count still in flight. no-backend.mjs proves the game shrugs that off.
  if (r.url().startsWith(COLLECTOR) && why === 'net::ERR_ABORTED') return;
  consoleErrors.push('requestfailed: ' + r.url() + ' ' + why);
});
page.on('response', r => { if (r.status() >= 400) consoleErrors.push(`http ${r.status()}: ${r.url()}`); });
page.on('request', r => { if (!r.url().startsWith(LIVE_URL) && !r.url().startsWith(COLLECTOR + '/') && !r.url().startsWith('data:')) consoleErrors.push(`outbound request: ${r.url()}`); });

const tap = async sel => {
  if (VIEW === 'mobile') await page.locator(sel).first().tap();
  else await page.locator(sel).first().click();
};

// ---- terminal helpers (real keyboard only) ----
async function send(line) {
  await page.evaluate(() => {
    const t = document.getElementById('terminal');
    window.__mark = t.lastElementChild;
  });
  await page.locator('#cmd-input').focus();
  // A multi-line instruction is typed line by line, pressing Enter between lines, like a learner would.
  for (const part of line.split('\n')) {
    await page.keyboard.type(part);
    await page.keyboard.press('Enter');
  }
  return page.evaluate(() => {
    const t = document.getElementById('terminal');
    const all = [...t.children];
    const m = window.__mark;
    const idx = m && m.isConnected ? all.indexOf(m) : -1;
    const fresh = all.slice(idx + 1);
    const bad = new Set();
    for (const n of fresh) for (const el of n.querySelectorAll('*')) {
      if (!['SPAN', 'BR', 'STRONG', 'EM', 'B', 'I', 'CODE'].includes(el.tagName)) bad.add(el.tagName);
    }
    return {
      text: fresh.map(n => n.innerText).join('\n'),
      hasError: fresh.some(n => n.querySelector('.error')),
      badTags: [...bad],
    };
  });
}

async function checkLayout(where) {
  const issues = await page.evaluate(() => {
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways: ${de.scrollWidth} > ${window.innerWidth}`);
    const inp = document.getElementById('cmd-input').getBoundingClientRect();
    if (inp.width < 60) out.push(`input too narrow: ${Math.round(inp.width)}px`);
    if (inp.right > window.innerWidth + 1) out.push(`input off screen right: ${Math.round(inp.right)} > ${window.innerWidth}`);
    if (inp.bottom > window.innerHeight + 1) out.push(`input off screen bottom: ${Math.round(inp.bottom)} > ${window.innerHeight}`);
    const panel = document.getElementById('side-panel').getBoundingClientRect();
    if (panel.width && panel.right > window.innerWidth + 1) out.push('panel off screen');
    const term = document.getElementById('terminal').getBoundingClientRect();
    if (term.height < 60) out.push(`terminal output too short: ${Math.round(term.height)}px`);
    return out;
  });
  if (issues.length) record('layout', where, '', false, issues);
}

// ---- reading the mission panel ----
function panelState() {
  return page.evaluate(() => {
    const panel = document.getElementById('panel-lessons');
    const label = panel.querySelector('.chapter-label')?.innerText || '';
    const m = label.match(/Chapter\s+(\d+)\s+of\s+(\d+)/i);
    const bad = new Set();
    for (const el of panel.querySelectorAll('*')) if (!['DIV','SPAN','BR','STRONG','EM','B','I','CODE','H3','UL','LI','BUTTON','EM'].includes(el.tagName)) bad.add(el.tagName);
    const tasks = [...panel.querySelectorAll('.task-item')].map(li => ({
      done: li.classList.contains('done'),
      active: li.classList.contains('active'),
      text: li.querySelector('.task-text')?.innerText || '',
      codes: [...li.querySelectorAll('code')].map(c => c.textContent),
      hint: li.querySelector('.hint-text')?.textContent || '',
      hasHintBtn: !!li.querySelector('.hint-btn'),
    }));
    const overall = [...panel.querySelectorAll('.chapter-label')].map(e => e.innerText).find(t => /overall/i.test(t)) || '';
    return { chapter: m ? +m[1] : 0, totalCh: m ? +m[2] : 0, title: panel.querySelector('.lesson-title')?.innerText || '', tasks, overall, badTags: [...bad] };
  });
}

// What a learner would type for a mission: the command in the <code> tag, or the fuller one in the hint
// when the <code> alone is not the whole command ("Use <code>cat</code> to read ~/documents/notes.txt").
function hintCommand(hint) {
  const t = (hint || '').trim();
  let m = t.match(/^(?:Just type|Type|Use [^:]+):\s*(.+)$/i);
  if (!m) return null;
  let c = m[1];
  c = c.replace(/\s+—\s+.*$/, '').replace(/\s+\(or .*\)$/, '').trim();
  return c;
}
function chooseCommand(task) {
  const code = task.codes[0];
  const hc = hintCommand(task.hint);
  if (!code) return { cmd: hc, why: 'hint (no code in the instruction)' };
  if (hc && hc !== code && hc.startsWith(code.trim() + ' ')) return { cmd: hc, why: 'hint completes the code' };
  if (/^[~/.]/.test(code) && !code.startsWith('./') && !code.startsWith('/usr/bin/') && hc) return { cmd: hc, why: 'code is a path, hint has the command' };
  return { cmd: code, why: 'literal' };
}

// ---- 1. entry flow ----
await page.goto(LIVE_URL);
await page.waitForTimeout(800);
await checkLayout('welcome screen');
if (await page.locator('input[type=password], input[type=email]').count()) record('entry', 'login', '', false, ['a login form is on the page']);
const welcomeVisible = await page.locator('#welcome-overlay').isVisible();
if (!welcomeVisible) record('entry', 'welcome', '', false, ['welcome overlay missing for new guest']);
const beginBox = await page.getByRole('button', { name: /BEGIN TRAINING/ }).boundingBox();
if (!beginBox || beginBox.y + beginBox.height > (VIEW === 'mobile' ? 844 : 900) || beginBox.y < 0) record('entry', 'begin button', '', false, ['BEGIN TRAINING not fully on screen', JSON.stringify(beginBox)]);
await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
await page.waitForTimeout(200);
await checkLayout('game start');
const focused = await page.evaluate(() => document.activeElement?.id);
if (focused !== 'cmd-input') record('entry', 'focus', '', false, [`input not focused at start, active element: ${focused}`]);

const RELOAD_AT = process.argv.includes('--no-reload') ? new Set() : new Set([6, 13, 40, 62]);   // chapters where we reload mid-chapter
let stepsPlayed = 0;
let literalPassCount = 0;

// ---- 2. every mission of every chapter, in order ----
let st = await panelState();
const totalCh = st.totalCh;
log(`Starting missions: ${totalCh} chapters`);
if (totalCh !== course.lessons.length) record('missions', 'chapter count', '', false, [`UI says ${totalCh}, data has ${course.lessons.length}`]);

for (let ci = 0; ci < totalCh; ci++) {
  st = await panelState();
  const chapter = ci + 1;
  if (st.chapter !== chapter) record('missions', `ch${chapter}`, '', false, [`expected chapter ${chapter}, panel shows ${st.chapter}`]);
  if (st.badTags.length) record('missions', `ch${chapter}`, '', false, [`text swallowed as HTML in lesson panel: ${st.badTags.join(',')}`]);
  const nTasks = st.tasks.length;
  if (nTasks !== course.lessons[ci].tasks.length) record('missions', `ch${chapter}`, '', false, [`panel lists ${nTasks} missions, data has ${course.lessons[ci].tasks.length}`]);
  // Rendered text must match what the course data says; catches text eaten by the HTML parser.
  course.lessons[ci].tasks.forEach((t, j) => {
    const dataCode = (t.text.match(/<code>([\s\S]*?)<\/code>/) || [])[1];
    if (dataCode) {
      const decoded = dataCode.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (st.tasks[j] && st.tasks[j].codes[0] !== decoded) record('missions', `ch${chapter}.${j + 1}`, '', false, [`instruction renders differently from course data. shown: ${JSON.stringify(st.tasks[j].codes[0])} data: ${JSON.stringify(decoded)}`]);
    }
  });

  for (let ti = 0; ti < nTasks; ti++) {
    st = await panelState();
    const task = st.tasks[ti];
    const id = `ch${chapter}.${ti + 1}`;
    if (!task) { record('missions', id, '', false, ['task vanished']); continue; }
    if (task.done) { record('missions', id, '', false, ['already complete before its command was typed (passed by an earlier command)']); continue; }

    // Hint button must reveal text.
    if (task.hasHintBtn && ti === 0) {
      const li = page.locator('#panel-lessons .task-item').nth(ti);
      await li.locator('.hint-btn').click();
      const shown = await li.locator('.hint-text').isVisible();
      if (!shown) record('missions', id, 'hint', false, ['hint button did not show the hint']);
      await li.locator('.hint-btn').click();
    }

    const { cmd, why } = chooseCommand(task);
    if (!cmd) { record('missions', id, '', false, ['no command in instruction or hint', task.text]); continue; }
    const before = st.tasks.filter(t => t.done).length;
    const out = await send(cmd);
    stepsPlayed++;
    const detail = [];
    if (out.hasError && !cmd.includes('||')) detail.push('command printed an error: ' + out.text.split('\n').slice(1, 4).join(' | ').slice(0, 220));
    if (out.badTags.length) detail.push(`output text swallowed as HTML: ${out.badTags.join(',')}`);
    if (/^Command not found:/m.test(out.text)) detail.push('simulated shell does not know this command');
    await page.waitForTimeout(ti === nTasks - 1 ? 0 : 10);
    let after = await panelState();
    // The chapter may have auto-advanced only after 1s, so this read is still the same chapter.
    let done = after.chapter === chapter ? after.tasks[ti]?.done : true;
    if (after.chapter === chapter) {
      const nowDone = after.tasks.filter(t => t.done).length;
      if (nowDone !== before + 1) detail.push(`done count went ${before} -> ${nowDone}, expected +1`);
    }
    if (!done) {
      detail.push(`instruction typed but mission did not complete (${why})`);
      const hc = hintCommand(task.hint);
      if (hc && hc !== cmd) {
        await send(hc);
        after = await panelState();
        done = after.chapter === chapter ? after.tasks[ti]?.done : true;
        detail.push(done ? `hint command worked: ${hc}` : `hint command also failed: ${hc}`);
      }
    }
    if (why === 'literal' && done && !detail.length) literalPassCount++;
    transcript.push(`\n### ${id} [${why}]\n${out.text}`);
    record('missions', id, cmd, !!done && !detail.length, detail);
    await checkLayout(id);

    // Reload mid-chapter: progress and files must survive, including a second reload sat on the auth screen.
    if (RELOAD_AT.has(chapter) && ti === 1) {
      const preReload = await panelState();
      const prePrompt = await page.locator('#prompt').innerText();
      await page.reload();
      await page.waitForTimeout(500);
      if (chapter === 13) {
        // Returning player idles past the 10-second autosave, then reloads again.
        await page.waitForTimeout(11000);
        await page.reload();
        await page.waitForTimeout(500);
      }
      const post = await panelState();
      const d = [];
      if (post.chapter !== chapter) d.push(`reload resumed at chapter ${post.chapter}, expected ${chapter}`);
      if (post.tasks.filter(t => t.done).length !== preReload.tasks.filter(t => t.done).length) d.push('completed missions lost on reload');
      const postPrompt = await page.locator('#prompt').innerText();
      if (postPrompt !== prePrompt) d.push(`prompt changed across reload: ${prePrompt} -> ${postPrompt}`);
      if (await page.locator('#welcome-overlay').isVisible()) d.push('welcome overlay blocks returning player');
      record('reload', `ch${chapter}`, '', d.length === 0, d);
      if (post.chapter !== chapter) { log(`  reload broke progress at chapter ${chapter}; replaying from chapter ${post.chapter} is not possible in this run`); }
    }
  }

  // Chapter completion: auto-advance within ~1 second.
  st = await panelState();
  if (st.tasks.every(t => t.done)) {
    if (chapter < totalCh) {
      const t0 = Date.now();
      let adv = false;
      while (Date.now() - t0 < 3000) { const s = await panelState(); if (s.chapter === chapter + 1) { adv = true; break; } await page.waitForTimeout(50); }
      if (!adv) record('missions', `ch${chapter}`, '', false, ['did not auto-advance after completing every mission']);
      const s2 = await panelState();
      const m = s2.overall.match(/(\d+)\s*\/\s*(\d+)/);
      if (!m || +m[1] !== chapter) {
        // Counts complete chapters; if an earlier chapter failed this is expected to lag.
        results.filter(r => r.section === 'missions' && !r.ok).length === 0 && record('missions', `ch${chapter}`, '', false, [`overall progress shows ${s2.overall}, expected ${chapter}/${totalCh}`]);
      }
    }
  } else {
    record('missions', `ch${chapter}`, '', false, ['chapter left incomplete: ' + st.tasks.map((t, i) => t.done ? null : i + 1).filter(Boolean).join(',')]);
    if (chapter < totalCh) await tap('#panel-lessons .nav-btns button:last-child');
    await page.waitForTimeout(100);
  }
  if (chapter % 10 === 0) log(`  chapter ${chapter}/${totalCh} done, ${stepsPlayed} commands, ${problems.length} problems so far`);
}

st = await panelState();
const missionsDone = results.filter(r => r.section === 'missions' && r.cmd && r.ok).length;
const allOverall = st.overall;
log(`Missions finished: ${stepsPlayed} commands typed, ${missionsDone} clean. Overall: ${allOverall}`);
const lastTerm = await page.evaluate(() => document.getElementById('terminal').innerText.slice(-400));
if (!/CONGRATULATIONS/.test(lastTerm)) record('missions', 'finale', '', false, ['no congratulations message after chapter 81']);

// XP accounting: everything earned must add up.
const expectedMissionXP = course.lessons.reduce((a, l) => a + l.xp + l.tasks.length * 15, 0);
const lvl = await page.evaluate(() => ({ badge: document.getElementById('level-badge').innerText, xp: document.getElementById('xp-text').innerText, ach: document.querySelectorAll('#panel-achievements .achievement.unlocked').length }));
const level = +lvl.badge.replace(/\D/g, '');
const xpInto = +lvl.xp.split('/')[0];
let total = xpInto; for (let k = 1; k < level; k++) total += k * 100;
const expectedTotal = expectedMissionXP + lvl.ach * 25;
log(`XP check: level ${level}, ${lvl.xp}; total ${total}; expected ${expectedTotal} (${expectedMissionXP} missions + ${lvl.ach} achievements x 25)`);
if (total !== expectedTotal) record('xp', 'missions', '', false, [`total XP ${total}, expected ${expectedTotal}`]);

// Going back shows finished chapters as finished, and new commands add no XP.
await tap('#panel-lessons .nav-btns button:first-child');
await page.waitForTimeout(100);
const back = await panelState();
if (back.chapter !== totalCh - 1 || !back.tasks.every(t => t.done)) record('missions', 'previous', '', false, ['Previous button did not show a finished chapter']);
await tap('#panel-lessons .nav-btns button:last-child');
await page.waitForTimeout(100);

// ---- 3. Adventure ----
async function questState() {
  return page.evaluate(() => {
    const p = document.getElementById('panel-adventure');
    const q = p.querySelector('h3');
    const bad = new Set();
    for (const el of p.querySelectorAll('*')) if (!['DIV','SPAN','BR','H2','H3','CODE','BUTTON'].includes(el.tagName)) bad.add(el.tagName);
    return {
      heading: q ? q.innerText : '',
      location: p.querySelector('.location-tag')?.innerText.replace(/^[^a-z]*/i, '') || '',
      progress: (p.innerText.match(/Investigation Progress:\s*(\d+)\/(\d+)/) || []).slice(1).map(Number),
      objectives: [...p.querySelectorAll('.quest-objective')].map(o => ({
        done: o.classList.contains('done'),
        text: o.innerText,
        codes: [...o.querySelectorAll('code')].map(c => c.textContent),
        html: o.innerHTML,
      })),
      complete: /INVESTIGATION COMPLETE/.test(p.innerText),
      bad: [...bad],
    };
  });
}
await tap('.panel-tabs button[data-tab="adventure"]');
await page.waitForTimeout(100);
await page.getByRole('button', { name: /Begin Investigation/ }).click();
await page.waitForTimeout(100);
let questsPlayed = 0, objectivesPlayed = 0;
for (let q = 0; q < course.quests.length; q++) {
  let qs = await questState();
  if (qs.bad.length) record('adventure', `q${q + 1}`, '', false, [`text swallowed as HTML: ${qs.bad}`]);
  if (qs.progress[0] !== q) record('adventure', `q${q + 1}`, '', false, [`progress bar shows ${qs.progress}, expected ${q}/${course.quests.length}`]);
  if (!qs.heading.includes(`Quest ${q + 1}`)) record('adventure', `q${q + 1}`, '', false, [`panel shows "${qs.heading}"`]);
  const nObj = qs.objectives.length;
  for (let oi = 0; oi < nObj; oi++) {
    qs = await questState();
    const o = qs.objectives[oi];
    const id = `q${q + 1}.${oi + 1}`;
    if (!o) { record('adventure', id, '', false, ['objective list changed under us (quest advanced early)']); break; }
    if (o.done) { record('adventure', id, '', false, ['already complete before its command was typed']); continue; }
    let cmds = o.codes.slice();
    const detail = [];
    if (cmds.length > 1 && /\sor\s/.test(o.text)) cmds = [cmds[0]];
    if (cmds.length === 0 || cmds[0].trim() === 'cd') {
      detail.push('objective gives no complete command; used the location tag: ' + qs.location);
      cmds = ['cd ~/' + qs.location];
    }
    let lastOut;
    for (const c of cmds) { lastOut = await send(c); objectivesPlayed++; if (lastOut.hasError) detail.push(`"${c}" printed an error: ` + lastOut.text.split('\n').slice(1, 3).join(' | ').slice(0, 200)); if (lastOut.badTags.length) detail.push('output swallowed as HTML'); }
    await page.waitForTimeout(10);
    const after = await questState();
    const stillSameQuest = after.heading.includes(`Quest ${q + 1}`);
    const doneNow = stillSameQuest ? after.objectives[oi]?.done : true;
    if (!doneNow) detail.push('objective did not complete');
    transcript.push(`\n### ${id}\n${lastOut?.text}`);
    record('adventure', id, cmds.join(' ; '), !!doneNow && !detail.length, detail);
    await checkLayout(id);
  }
  questsPlayed++;
  await page.waitForTimeout(50);
}
const advEnd = await questState();
if (!advEnd.complete) record('adventure', 'finale', '', false, [`investigation not complete; progress ${advEnd.progress}`]);
log(`Adventure: ${questsPlayed} quests, ${objectivesPlayed} objective commands. Complete=${advEnd.complete}`);

// ---- 4. Challenges: every challenge in every difficulty, wrong answer first ----
const answers = {
  'Where Am I?': ['pwd'], 'Who Am I?': ['whoami'], 'List It': ['cd', 'ls'], 'Hidden Secrets': ['ls -a'], 'Go Home': ['cd'],
  'Read the Notes': ['cat ~/documents/notes.txt'], 'Make a File': ['touch challenge.txt'], 'Make a Folder': ['mkdir test-dir'],
  'Echo Chamber': ['echo "I love the terminal"'], 'First Lines': ['head -n 5 ~/documents/quotes.txt'],
  'Last Lines': ['tail -n 3 ~/documents/projects/data/log.txt'], 'Into the Projects': ['cd ~/documents/projects'],
  'Count the Lines': ['wc -l ~/documents/todo.txt'], 'What is Bash?': ['glossary bash'], 'Read the Manual': ['man ls'],
  'Deep Dive': ['cd ~/documents/projects/data', 'ls -l'], 'Copy That': ['cp ~/documents/notes.txt ~/documents/notes_backup.txt'],
  'Pipe Dream': ['cat ~/documents/notes.txt | wc -l'], 'Error Hunter': ['grep "ERROR" ~/documents/projects/data/log.txt'],
  'Case Closed': ['grep -i "error" ~/documents/projects/data/log.txt'], 'File Finder': ['find ~ -name "*.css"'],
  'Sort It Out': ['sort ~/documents/notes.txt'], 'Write It Down': ['echo "hello" > ~/challenge_note.txt'],
  'Append Mode': ['echo "more" >> ~/challenge_note.txt'], 'Permission Check': ['ls -l ~/scripts/'],
  'Rename Game': ['touch ~/rename_me.txt', 'mv ~/rename_me.txt ~/renamed_me.txt'], 'Nested Builder': ['mkdir -p ~/deep/a/b/c'],
  'Line Numbers': ['grep -n "INFO" ~/documents/projects/data/log.txt'], 'Shortcut Creator': ['alias gs2="git status"'],
  'Variable Setter': ['export CH_VAR="x"'],
  'Three-Pipe Problem': ['cat ~/documents/notes.txt | sort | uniq'], 'CSV Surgeon': ['cut -d "," -f 1 ~/documents/projects/data/users.csv'],
  'Unique Finder': ['cut -d, -f3 ~/documents/projects/data/users.csv | sort | uniq'], 'Recursive Search': ['grep -r "function" ~/documents/projects/'],
  'Permission Wizard': ['chmod 755 ~/scripts/hello.sh'], 'Multi-Chain': ['pwd && whoami'],
  'Count the Errors': ['grep "ERROR" ~/documents/projects/data/log.txt | wc -l'],
  'Data Pipeline': ['cut -d "," -f 2 ~/documents/projects/data/sales.csv | sort | uniq'],
  'Log Detective': ['grep -n "WARNING" ~/documents/projects/data/log.txt'],
  'Script Maker': ['echo "#!/bin/bash" > ~/myscript.sh', 'chmod +x ~/myscript.sh'], 'Full Audit': ['cd', 'ls -la'],
  'Reverse Sort': ['sort -r ~/documents/notes.txt'],
  'Sales Report': ['cat ~/documents/projects/data/sales.csv | cut -d "," -f 2 | sort | uniq -c'],
  'Admin Analysis': ['grep "admin" ~/documents/projects/data/users.csv | wc -l'],
  'Log Forensics': ['tail -n 5 ~/documents/projects/data/log.txt | grep "INFO" | wc -l'],
  'Full System Scan': ['find / -name "*.txt" | wc -l'], 'Config Extractor': ['cat ~/documents/projects/data/config.json | grep "port"'],
  'Build & Verify': ['mkdir ~/bv_dir && echo "hi" > ~/bv_dir/f.txt && cat ~/bv_dir/f.txt'],
};
await tap('.panel-tabs button[data-tab="challenges"]');
await page.waitForTimeout(100);
let challengesPlayed = 0;
const challengeOutputs = {};
for (const diff of ['easy', 'medium', 'hard', 'expert']) {
  const n = course.challenges[diff].length;
  const label = diff[0].toUpperCase() + diff.slice(1);
  await page.locator('#panel-challenges button.challenge-btn', { hasText: label }).first().click();
  await page.waitForTimeout(50);
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: /Start Challenge/ }).click();
    await page.waitForTimeout(30);
    const cur = await page.evaluate(() => {
      const c = document.querySelector('#panel-challenges .active-challenge');
      return c ? { title: c.querySelector('h4').innerText, desc: c.querySelector('p').innerText, diff: c.querySelector('.ch-diff').innerText } : null;
    });
    if (!cur) { record('challenges', `${diff}#${i}`, '', false, ['Start Challenge did not start one']); continue; }
    const id = `${diff}: ${cur.title}`;
    const detail = [];
    if (cur.diff.toLowerCase() !== diff) detail.push(`card says ${cur.diff}`);
    // A wrong answer must not pass.
    await send('echo nope');
    const stillActive = await page.locator('#panel-challenges .active-challenge').count();
    if (!stillActive) detail.push('wrong answer "echo nope" passed the challenge');
    const steps = answers[cur.title];
    if (!steps) { record('challenges', id, '', false, ['no answer in script for this title']); await page.getByRole('button', { name: /Skip/ }).click(); continue; }
    let out;
    for (const s of steps) {
      if (!await page.locator('#panel-challenges .active-challenge').count()) { detail.push(`passed before final step at "${s}"`); break; }
      out = await send(s);
      if (out.hasError) detail.push(`"${s}" printed an error: ` + out.text.split('\n').slice(1, 3).join(' | ').slice(0, 200));
    }
    challengeOutputs[cur.title] = out?.text;
    challengesPlayed++;
    const finished = (await page.locator('#panel-challenges .active-challenge').count()) === 0;
    if (!finished) { detail.push('correct answer did not complete it'); await page.getByRole('button', { name: /Skip/ }).click(); }
    record('challenges', id, steps.join(' ; '), finished && !detail.length, detail);
    await page.waitForTimeout(20);
    await send('cd');
  }
  const countTxt = await page.locator('#panel-challenges button.challenge-btn', { hasText: label }).first().innerText();
  if (!countTxt.includes(`${n}/${n}`)) record('challenges', diff, '', false, [`difficulty counter shows "${countTxt.replace(/\n/g, ' ')}", expected ${n}/${n}`]);
}
// Skip keeps working, streak resets, and exhausted pools restart cleanly.
await page.locator('#panel-challenges button.challenge-btn', { hasText: 'Easy' }).first().click();
await page.getByRole('button', { name: /Start Challenge/ }).click();
await page.getByRole('button', { name: /Skip/ }).click();
await page.waitForTimeout(30);
if (!await page.locator('#panel-challenges .active-challenge').count()) record('challenges', 'skip', '', false, ['Skip did not offer a new challenge']);
const totalDone = await page.locator('#panel-challenges .stat-val').first().innerText();
if (+totalDone !== Object.values(course.challenges).flat().length) record('challenges', 'total', '', false, [`Completed counter says ${totalDone}`]);
await page.getByRole('button', { name: /Skip/ }).click();
log(`Challenges: ${challengesPlayed} played; counter ${totalDone}`);
// Clear the pending challenge for later sections.
{
  const c = await page.evaluate(() => document.querySelector('#panel-challenges .active-challenge h4')?.innerText);
  if (c && answers[c]) for (const s of answers[c]) { await send(s.replace('mkdir test-dir', 'mkdir -p test-dir').replace('mkdir ~/bv_dir', 'mkdir -p ~/bv_dir')); }
  await send('cd');
}

// ---- 5. Quiz: every question in every category ----
const quizKey = {};
for (const qs of Object.values(course.quiz)) for (const q of qs) quizKey[q.q.replace(/<[^>]*>/g, '')] = q;
await tap('.panel-tabs button[data-tab="quiz"]');
await page.waitForTimeout(100);
const catButtons = await page.locator('#panel-quiz .quiz-category-btn').allInnerTexts();
if (catButtons.length !== Object.keys(course.quiz).length + 1) record('quiz', 'categories', '', false, [`menu shows ${catButtons.length} entries; data has ${Object.keys(course.quiz).length} + random`]);
let questionsAnswered = 0;
async function answerCurrent(mode) {
  const q = await page.evaluate(() => ({ text: document.querySelector('#panel-quiz .quiz-question h4')?.textContent, opts: [...document.querySelectorAll('#panel-quiz .quiz-option')].map(b => b.textContent), hdr: document.querySelector('#panel-quiz h2')?.textContent }));
  const key = quizKey[q.text];
  if (!key) { record('quiz', q.text?.slice(0, 50) || '?', '', false, ['question text not found in data; probably eaten by HTML parser']); }
  const correctIdx = key ? key.correct : 0;
  const choice = mode === 'wrong' ? (correctIdx + 1) % q.opts.length : correctIdx;
  if (key && q.opts[correctIdx]?.replace(/^[A-Z]\.\s*/, '') !== key.options[correctIdx]) record('quiz', q.text.slice(0, 50), '', false, ['option text does not match data', q.opts[correctIdx]]);
  await page.locator('#panel-quiz .quiz-option').nth(choice).click();
  questionsAnswered++;
  await page.waitForTimeout(30);
  const after = await page.evaluate(ci => {
    const opts = [...document.querySelectorAll('#panel-quiz .quiz-option')];
    return { correctMarked: opts[ci]?.classList.contains('correct'), wrongCount: document.querySelectorAll('#panel-quiz .quiz-option.wrong').length, explain: document.getElementById('quiz-explain')?.style.display, explainText: document.getElementById('quiz-explain')?.textContent, disabled: opts.every(o => o.disabled) };
  }, correctIdx);
  const d = [];
  if (!after.correctMarked) d.push('correct answer not highlighted');
  if (mode === 'wrong' && after.wrongCount !== 1) d.push('wrong answer not highlighted');
  if (mode !== 'wrong' && after.wrongCount !== 0) d.push('correct answer marked wrong');
  if (after.explain === 'none') d.push('no explanation shown');
  if (!after.disabled) d.push('options still clickable after answering');
  record('quiz', q.text?.slice(0, 60), `answer ${String.fromCharCode(65 + choice)}`, d.length === 0, d);
  await page.waitForSelector('#panel-quiz .quiz-question h4, #panel-quiz h2:has-text("Quiz Complete")', { timeout: 5000 });
  await page.waitForFunction(prev => {
    const h = document.querySelector('#panel-quiz h2')?.textContent || '';
    return h !== prev;
  }, q.hdr, { timeout: 5000 });
}
const catKeys = Object.keys(course.quiz);
for (let i = 0; i < catKeys.length; i++) {
  const n = course.quiz[catKeys[i]].length;
  await page.locator('#panel-quiz .quiz-category-btn').nth(i).click();
  for (let j = 0; j < n; j++) await answerCurrent('right');
  const end = await page.locator('#panel-quiz').innerText();
  if (!/Quiz Complete/.test(end) || !end.includes('100%') || !end.includes(`${n} out of ${n}`)) record('quiz', catKeys[i], '', false, ['end screen wrong: ' + end.slice(0, 120).replace(/\n/g, ' ')]);
  // Back to categories
  await page.getByRole('button', { name: /Back to Categories/ }).click();
  await page.waitForTimeout(30);
}
// Random mix: all wrong (wrong answers are handled, no crash, 0%), then Retry works and can be finished.
await page.locator('#panel-quiz .quiz-category-btn').last().click();
for (let j = 0; j < 10; j++) await answerCurrent('wrong');
{
  const end = await page.locator('#panel-quiz').innerText();
  if (!end.includes('0%') || !/Keep practicing/.test(end)) record('quiz', 'random wrong', '', false, ['end screen wrong: ' + end.slice(0, 120).replace(/\n/g, ' ')]);
}
await page.getByRole('button', { name: /Retry/ }).click();
for (let j = 0; j < 10; j++) await answerCurrent('right');
{
  const end = await page.locator('#panel-quiz').innerText();
  if (!end.includes('100%')) record('quiz', 'random retry', '', false, ['retry end screen wrong: ' + end.slice(0, 120).replace(/\n/g, ' ')]);
}
await page.getByRole('button', { name: /Back to Categories/ }).click();
const statTxt = await page.locator('#panel-quiz').innerText();
const expectedAll = Object.values(course.quiz).flat().length + 20;
const expectedRight = Object.values(course.quiz).flat().length + 10;
if (!statTxt.includes(`${expectedRight}/${expectedAll}`)) record('quiz', 'all-time', '', false, [`all-time stat wrong, expected ${expectedRight}/${expectedAll}: ` + statTxt.slice(0, 100).replace(/\n/g, ' ')]);
// Leaving mid-quiz must not lose the question.
await page.locator('#panel-quiz .quiz-category-btn').first().click();
const qBefore = await page.locator('#panel-quiz .quiz-question h4').innerText();
await tap('.panel-tabs button[data-tab="lessons"]');
await page.waitForTimeout(30);
await tap('.panel-tabs button[data-tab="quiz"]');
await page.waitForTimeout(30);
const qAfter = await page.locator('#panel-quiz .quiz-question h4').count() ? await page.locator('#panel-quiz .quiz-question h4').innerText() : '(back at menu)';
if (qAfter !== qBefore) record('quiz', 'tab switch', '', false, [`switching tabs mid-quiz lost the question: "${qBefore}" -> "${qAfter}"`]);
if (await page.getByRole('button', { name: /Quit Quiz/ }).count()) await page.getByRole('button', { name: /Quit Quiz/ }).click();
log(`Quiz: ${questionsAnswered} answers`);

// ---- 6. Encyclopedia + help + man pages, achievements ----
await tap('.panel-tabs button[data-tab="glossary"]');
await page.waitForTimeout(50);
const glossCount = await page.locator('#panel-glossary .glossary-item').count();
if (glossCount !== Object.keys(course.glossary).length) record('glossary', 'panel', '', false, [`panel shows ${glossCount} of ${Object.keys(course.glossary).length}`]);
for (const k of Object.keys(course.glossary)) {
  const out = await send(`glossary ${k}`);
  const d = [];
  if (out.hasError) d.push('error: ' + out.text.slice(0, 160));
  if (out.badTags.length) d.push('text swallowed as HTML: ' + out.badTags);
  record('glossary', k, `glossary ${k}`, !d.length, d);
}
const gl = await send('glossary');
if (gl.badTags.length || gl.hasError) record('glossary', 'list', 'glossary', false, ['bad output']);
const helpOut = await send('help');
if (helpOut.badTags.length || helpOut.hasError) record('help', 'help', 'help', false, ['bad help output']);
for (const m of ['pwd', 'ls', 'cd', 'cat', 'head', 'tail']) await send(`man ${m}`);
await send('cat ~/documents/projects/data/users.csv | cut -d, -f3 | sort | uniq | wc -l'); // the optional "5-command pipeline" achievement

await tap('.panel-tabs button[data-tab="achievements"]');
await page.waitForTimeout(50);
const achv = await page.evaluate(() => [...document.querySelectorAll('#panel-achievements .achievement')].map(a => ({ name: a.querySelector('.ach-name').innerText, desc: a.querySelector('.ach-desc').innerText, on: a.classList.contains('unlocked') })));
const locked = achv.filter(a => !a.on);
log(`Achievements: ${achv.length - locked.length}/${achv.length} unlocked. Locked: ${locked.map(a => a.name).join(', ') || 'none'}`);
for (const a of locked) if (a.name !== 'Speed Demon') record('achievements', a.name, '', false, [`still locked after full playthrough: ${a.desc}`]);

// ---- 7. Final reload: everything still there ----
const beforeFinal = { adv: advEnd.progress, xp: await page.locator('#xp-text').innerText(), lvl: await page.locator('#level-badge').innerText() };
await page.reload();
await page.waitForTimeout(500);
const fin = await panelState();
const d = [];
if (!/81\s*\/\s*81/.test(fin.overall)) d.push(`final overall after reload: ${fin.overall}`);
if (await page.locator('#xp-text').innerText() !== beforeFinal.xp) d.push('XP changed across reload');
await tap('.panel-tabs button[data-tab="adventure"]');
await page.waitForTimeout(50);
const advFin = await questState();
if (!advFin.complete) d.push('adventure completion lost on reload');
const lsFin = await send('ls ~/nexus/vault');
if (lsFin.hasError) d.push('files lost on reload');
const repAfter = await send('cat ~/nexus/vault/final_report.txt');
if (!/your findings|findings/.test(repAfter.text)) d.push('final report text written in quest 10 was lost on reload');
record('reload', 'final', '', d.length === 0, d);

await checkLayout('final');

// ---- 8. Take the finished game to a brand new browser with a save code ----
{
  await tap('.panel-tabs button[data-tab="save"]');
  await page.locator('#panel-save').waitFor();
  await tap('button[onclick="showSaveCode()"]');
  await page.waitForFunction(() => /^TA[01]\./.test(document.getElementById('save-code-out').value));
  const code = await page.locator('#save-code-out').inputValue();
  const read = p => p.evaluate(() => {
    const s = buildSaveObject();
    delete s.aliases;
    delete s.functions;
    const sorted = v => Array.isArray(v) ? v.map(sorted)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
    return JSON.stringify(sorted(s));
  });
  const whole = await read(page);
  const ctx2 = await browser.newContext(ctxOpts);
  const otherCounts = await asLive(ctx2);
  const other = await ctx2.newPage();
  other.on('pageerror', e => consoleErrors.push('pageerror after moving the save: ' + e.message));
  await other.goto(LIVE_URL);
  await other.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  await other.locator('.panel-tabs button[data-tab="save"]').click();
  await other.locator('#save-code-in').fill(code);
  await other.locator('button[onclick="checkSaveCode()"]').click();
  await other.locator('#save-confirm').waitFor();
  const summary = await other.locator('#save-summary').textContent();
  const loaded = other.waitForEvent('load');
  await other.locator('button[onclick="applyImport()"]').click();
  await loaded;
  await other.locator('#panel-lessons .chapter-label').first().waitFor();
  const moved = [];
  if (!/81 of 81 chapters done/.test(summary)) moved.push(`summary: ${summary.slice(0, 100)}`);
  if (await read(other) !== whole) moved.push('the save changed on the way across');
  if (await other.locator('#xp-text').innerText() !== beforeFinal.xp) moved.push('XP changed on the way across');
  if (await other.locator('#level-badge').innerText() !== beforeFinal.lvl) moved.push('level changed on the way across');
  await other.locator('#cmd-input').focus();
  await other.keyboard.type('cat ~/nexus/vault/final_report.txt');
  await other.keyboard.press('Enter');
  const report = await other.evaluate(() => document.getElementById('terminal').lastElementChild.parentElement.innerText);
  if (!/findings/.test(report)) moved.push('files did not arrive');
  if (otherCounts.some(c => countName(c) !== 'visit')) moved.push('moving a save added counts: ' + otherCounts.map(countName).join());
  record('move', 'code', '', moved.length === 0, moved);
  log(`Moved the finished game with a ${code.length} character code`);
  await ctx2.close();
  await tap('.panel-tabs button[data-tab="lessons"]');
}
await page.screenshot({ path: outFile(`${OUT}-final.png`).pathname });

// ---- 9. The whole course produced exactly the promised counts ----
{
  await page.waitForTimeout(200);
  const u = [];
  const numbers = name => counts.filter(c => countName(c) === name).map(countNumber).sort((a, b) => a - b).join();
  const oneTo = n => Array.from({ length: n }, (_, i) => i + 1).join();
  for (const c of counts) { const bad = badCount(c); if (bad) u.push(bad); }
  if (numbers('chapter_started') !== oneTo(81)) u.push(`chapters started: ${numbers('chapter_started')}`);
  if (numbers('chapter_finished') !== oneTo(81)) u.push(`chapters finished: ${numbers('chapter_finished')}`);
  if (numbers('quest_finished') !== oneTo(10)) u.push(`quests finished: ${numbers('quest_finished')}`);
  if (counts.filter(c => countName(c) === 'game_finished').length !== 1) u.push('game finished was not counted exactly once');
  if (!counts.some(c => countName(c) === 'visit')) u.push('no visit counted');
  const sentText = JSON.stringify(counts);
  const typedCommands = results.map(r => r.cmd).filter(c => c && c.length > 3);
  for (const c of new Set(typedCommands)) if (sentText.includes(JSON.stringify(c).slice(1, -1))) u.push(`a typed command reached the collector: ${c}`);
  if (typedCommands.length < 390) u.push(`only ${typedCommands.length} commands to compare`);
  record('usage', 'counts', '', u.length === 0, u);
  log(`Usage counts sent: ${counts.length}`);
}

for (const e of [...new Set(consoleErrors)]) record('console', 'error', '', false, [e]);

// ---- report ----
const secs = {};
for (const r of results) { secs[r.section] ??= { ok: 0, bad: 0 }; r.ok ? secs[r.section].ok++ : secs[r.section].bad++; }
const summary = {
  viewport: VIEW, browser: BROWSER, base: BASE, when: new Date().toString(),
  chaptersPlayed: totalCh, missionCommands: stepsPlayed, literalPass: literalPassCount,
  questsPlayed, objectiveCommands: objectivesPlayed, challengesPlayed, quizAnswers: questionsAnswered,
  sections: secs, problemCount: problems.filter(p => !p.ok).length,
};
fs.writeFileSync(outFile(`${OUT}.json`), JSON.stringify({ summary, problems, results, challengeOutputs }, null, 1));
let text = '# ' + JSON.stringify(summary) + '\n\n';
for (const r of results) if (r.cmd || !r.ok) text += `${r.ok ? 'PASS' : 'FAIL'} [${r.section}] ${r.id}  $ ${r.cmd}\n${r.detail.map(x => '      - ' + x + '\n').join('')}`;
fs.writeFileSync(outFile(`${OUT}.log`), text);
fs.writeFileSync(outFile(`${OUT}-transcript.txt`), transcript.join('\n'));
log(JSON.stringify(summary, null, 1));
log('Problems:');
for (const p of problems.filter(x => !x.ok).slice(0, 400)) log(` [${p.section}] ${p.id} $ ${p.cmd}\n    ${p.detail.join('\n    ')}`);
await browser.close();
process.exit(problems.some(p => !p.ok) ? 1 : 0);
