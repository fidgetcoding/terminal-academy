// Self-XSS check: every command the game knows gets an HTML payload through real keyboard events, as an argument,
// a subcommand argument, a file name, and a saved value. Nothing may run, and no element but <span> may appear.
import { BASE, launch } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const fails = [];
let runs = 0;
page.on('pageerror', e => fails.push(`page error: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') fails.push(`console error: ${m.text()}`); if (m.text().startsWith('UNESCAPED')) fails.push(`relied on the sink, not escaped at source: ${m.text()}`); });
page.on('dialog', d => { fails.push(`dialog fired: ${d.message()}`); d.dismiss(); });
await page.goto(BASE);
await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
// Also catch anything that only stayed safe because of the sink: raw tags reaching printToTerminal unescaped.
await page.evaluate(() => {
  const orig = window.safeOutput;
  window.safeOutput = html => { if (/<(?!\/?span[\s>])[a-z/!]/i.test(html)) console.warn('UNESCAPED ' + html.slice(0, 200)); return orig(html); };
});

const fired = () => page.evaluate(() => window.__xss === 1);
const P = '"<img src=x onerror=window.__xss=1>"';
const P2 = '"<svg onload=window.__xss=1>"';
const P3 = '"<span onclick=window.__xss=1 onmouseover=window.__xss=1>x</span>"';
const P4 = `"'><script>window.__xss=1</script>"`;

async function run(cmd) {
  await page.evaluate(() => { window.__m = document.getElementById('terminal').lastElementChild; });
  await page.locator('#cmd-input').focus();
  await page.locator('#cmd-input').fill('');
  await page.keyboard.type(cmd);
  await page.keyboard.press('Enter');
  // Unfinished input must not wedge the fuzz
  if ((await page.locator('#prompt').innerText()).trim() === '>') { await page.keyboard.type('cancel'); await page.keyboard.press('Enter'); }
  runs++;
  const r = await page.evaluate(() => {
    const t = document.getElementById('terminal');
    const a = [...t.children];
    const i = window.__m && window.__m.isConnected ? a.indexOf(window.__m) : -1;
    const bad = new Set(), handlers = new Set();
    for (const n of a.slice(i + 1)) for (const el of n.querySelectorAll('*')) {
      if (el.tagName !== 'SPAN') bad.add(el.tagName);
      for (const at of el.attributes) if (at.name !== 'class' && at.name !== 'style') handlers.add(at.name);
    }
    return { bad: [...bad], handlers: [...handlers], internal: a.slice(i + 1).some(n => /could not be run here/.test(n.innerText)) };
  });
  if (r.bad.length) fails.push(`$ ${cmd} -> element ${r.bad}`);
  if (r.handlers.length) fails.push(`$ ${cmd} -> attribute ${r.handlers}`);
  if (r.internal) fails.push(`$ ${cmd} -> internal error`);
  if (await fired()) { fails.push(`$ ${cmd} -> SCRIPT RAN`); await page.evaluate(() => { window.__xss = 0; }); }
}

const commands = await page.evaluate(() => [...validCommands].filter(c => !['do', 'done', 'then', 'else', 'elif', 'fi', 'esac', 'for', 'while', 'until', 'if', 'case', 'select', 'clear', 'exit', 'return', 'break', 'continue', 'rm', 'restore', '.', 'source'].includes(c)));
const subcommands = {
  git: ['init', 'add', 'commit -m', 'branch', 'checkout -b', 'checkout', 'merge', 'clone', 'nope'],
  brew: ['install', 'install --cask', 'uninstall', 'search', 'info', 'tap', 'nope'],
  apt: ['search', 'nope'], pip: ['install', 'uninstall', 'nope'], npm: ['install', 'run', 'search', 'nope'],
  docker: ['run', 'stop', 'rm', 'exec', 'pull', 'compose', 'nope'], tmux: ['new -s', 'attach -t', 'kill-session -t', 'nope'],
  gh: ['repo create', 'repo clone', 'workflow run', 'api', 'nope'], sudo: ['echo', 'nope'], time: ['echo', 'nope'], xargs: ['echo'],
  crontab: ['add', 'nope'], curl: ['-o /tmp/x', '-X', '-d'], nc: ['-z', '-l', '-u'], gpg: ['-c', '-d', '--sign'], asciinema: ['rec', 'play', 'upload', 'nope'],
  bash: ['examples', '-c', '-x'], python3: ['-c', '-m venv'], node: ['-e'], watch: ['-n 1'], man: [''], tldr: [''], glossary: [''], claude: [''], warp: [''], shortcut: [''], ghostty: [''], sysctl: [''], hyperfine: [''], open: ['-a'], parallel: ['echo :::'], ln: ['-s'], chown: ['-R'], chmod: ['+x', '644'],
};
console.log(`Fuzzing ${commands.length} commands`);
for (const c of commands) for (const p of [P, P3]) await run(`${c} ${p}`);
for (const [c, subs] of Object.entries(subcommands)) for (const sub of subs) for (const p of [P, P2, P4]) await run(`${c} ${sub} ${p}`.replace(/\s+/g, ' '));

// File names and saved values replayed later
const saved = [
  `touch ${P}`, 'ls', 'ls -l', 'ls -la', 'ls -R documents', 'find . -maxdepth 1', 'fd img', 'stat *img*', 'file *img*', 'wc -l *img*', 'cat *img*', 'du -a',
  `mkdir ${P2}`, 'ls', 'ls -F', 'tar -czf a.tgz *svg*', 'tar -tzf a.tgz', 'git init', 'git status', 'git add .', 'git status', 'git commit -m x', 'git log', 'tree',
  `ln -s ${P} lnk`, 'ls -l lnk', 'readlink lnk', 'file lnk', `ln -s ${P4} lnk2`, 'ls -l lnk2',
  `chown ${P} lnk`, 'ls -l lnk', 'stat lnk',
  `export ${P}=1`, `export FOO=${P}`, 'env', 'printenv', 'export', 'set', 'echo $FOO', `X=${P}; echo $X; echo "$X"`,
  `alias a1=${P}`, 'alias', 'alias a1', 'a1', 'type a1', `alias ${P}=ls`, 'alias',
  `${P}`, `echo ${P}`, 'history', '!!', `cd ${P}`, `arr=(${P}); echo \${arr[@]}`, `f() { echo ${P}; }; f`, `f2() { ${P}; }; f2`,
  `echo ${P} > out.txt`, 'cat out.txt', 'head out.txt', 'tail out.txt', 'sort out.txt', 'uniq out.txt', 'cut -c1-40 out.txt', 'sed "s/x/y/" out.txt', 'awk "{print}" out.txt', 'grep img out.txt', 'grep -n img out.txt', 'rg img', 'tr a b < out.txt', 'bat out.txt', 'xxd out.txt', 'hexdump -C out.txt', 'paste out.txt out.txt', 'column -t out.txt', 'cat out.txt | tee t.txt', 'diff out.txt documents/todo.txt', 'diff -u out.txt documents/todo.txt', 'vim out.txt', 'nano out.txt', 'echo x | pbcopy', `echo ${P} | pbcopy`, 'pbpaste',
  `${P} | cat`, `echo hi > ${P}`, `cat ${P}`, `echo -e ${P}`, `printf ${P}`, `printf "%s" ${P}`, `sleep 100 & `, `jobs`, 'wait', `${P} &`, 'jobs', 'wait',
  // Names that exist on Object.prototype must not reach it
  'constructor', 'toString', '__proto__', 'hasOwnProperty', 'man constructor', 'which constructor', 'type constructor', 'glossary constructor', 'tldr constructor', 'claude constructor', 'warp __proto__', 'shortcut toString', 'sysctl constructor', 'echo $constructor', 'alias constructor', 'help', 'colors', '__proto__[a]=b', 'echo ${__proto__[a]}',
];
for (const c of saved) await run(c);

// Replay after reload: saved values come back through the terminal
await page.reload();
await page.waitForTimeout(200);
if (await fired()) fails.push('SCRIPT RAN on reload');
for (const c of ['history', 'env', 'alias', 'ls', 'ls -l', 'ls -la', 'echo $FOO', 'cat out.txt', 'pbpaste']) await run(c);
const polluted = await page.evaluate(() => ({}).a);
if (polluted !== undefined) fails.push('Object.prototype was polluted');

// The payload shows as the text it is
await run(`su ${P}`);
const shown = await page.evaluate(() => document.getElementById('terminal').lastElementChild.innerText);
if (!shown.includes('<img src=x onerror=window.__xss=1>')) fails.push(`su does not show its argument as text: ${shown}`);

await browser.close();
console.log(`${runs} commands run through the terminal`);
const unique = [...new Set(fails)];
for (const f of unique.slice(0, 120)) console.log('FAIL ', f);
console.log(unique.length ? `\n${unique.length} problems` : '\n0 problems: nothing ran, and only <span> reached the page');
process.exit(unique.length ? 1 : 0);
