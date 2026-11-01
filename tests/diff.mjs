// Differential test: runs taught commands in the game and in a real shell over an exact copy of the game's
// starter files in a throwaway temp dir, then compares the output. Only commands safe to run for real.
// Uses /bin/bash and whichever tools are on PATH (macOS BSD tools plus Homebrew extras).
// Fails on any difference that isn't on the known list below.
import { BASE, launch, outFile } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

const course = JSON.parse(fs.readFileSync(outFile('course.json')));

// Build the real copy of the virtual home
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-real-'));
function build(node, p) {
  if (node.type === 'dir') { fs.mkdirSync(p, { recursive: true }); for (const [n, c] of Object.entries(node.children)) build(c, path.join(p, n)); fs.chmodSync(p, 0o755); }
  else if (node.type === 'file') {
    fs.writeFileSync(p, node.content || '');
    const perm = node.permissions; const oct = s => (s[0]!=='-'?4:0)+(s[1]!=='-'?2:0)+(s[2]!=='-'?1:0);
    const mode = parseInt(`${oct(perm.slice(0,3))}${oct(perm.slice(3,6))}${oct(perm.slice(6,9))}`, 8);
    fs.chmodSync(p, mode === 0 ? 0o600 : mode); // cp -R can't read a mode-000 file
  }
}
const home = path.join(tmp, 'home', 'player');
build(course.fs['/'].children.home.children.player, home);

// Commands from the lessons plus obvious variants. Order matters; each runs from a fresh state in both shells.
const cases = [
  'ls', 'ls -a', 'ls -1', 'ls documents', 'ls documents scripts', 'ls -d documents', 'ls nonexistent',
  'cat documents/notes.txt', 'cat -n documents/todo.txt', 'cat documents/notes.txt documents/todo.txt', 'cat nofile', 'cat documents',
  'head -n 3 documents/notes.txt', 'head -3 documents/notes.txt', 'head documents/quotes.txt', 'head -n 1 documents/notes.txt documents/todo.txt',
  'tail -n 2 documents/notes.txt', 'tail -2 documents/notes.txt', 'tail -n +7 documents/notes.txt', 'tail documents/projects/data/log.txt',
  'wc -l documents/todo.txt', 'wc documents/notes.txt', 'wc -w documents/notes.txt', 'wc -c documents/notes.txt', 'wc -l documents/notes.txt documents/todo.txt',
  'cat documents/quotes.txt | wc -l', 'cat documents/quotes.txt | sort',
  'cat documents/projects/data/users.csv | cut -d "," -f 1 | sort',
  'cat documents/projects/data/sales.csv | cut -d "," -f 2 | sort | uniq',
  'grep "ERROR" documents/projects/data/log.txt', 'grep -i "warning" documents/projects/data/log.txt', 'grep -n "INFO" documents/projects/data/log.txt',
  'grep -c "INFO" documents/projects/data/log.txt', 'grep -v "INFO" documents/projects/data/log.txt',
  'grep -r "function" documents/projects/', 'cat documents/projects/data/log.txt | grep "ERROR" | wc -l', 'grep "nomatch" documents/notes.txt; echo "rc=$?"',
  'grep "^[A-Z]" documents/notes.txt', 'grep "\\.$" documents/notes.txt', 'grep "h.t" documents/notes.txt', 'grep "[0-9]" documents/projects/data/log.txt',
  'grep -E "ERROR|WARNING" documents/projects/data/log.txt', 'grep "ERROR\\|WARNING" documents/projects/data/log.txt', 'grep -l "INFO" documents/projects/data/log.txt documents/notes.txt', 'grep -o "user[^ ]*" documents/projects/data/log.txt',
  'find . -name "*.csv" | sort', 'find . -name "*.js" | sort', 'find . -name "note*" | sort', 'find documents -type d | sort', 'find documents -maxdepth 1 -type f | sort', 'find . -name ".*" -maxdepth 1 | sort',
  'echo hello', 'echo "hello world"', "echo 'single $HOME'", 'echo "double $NOPE"', 'echo a   b', 'echo -n hi', 'echo -e "a\\tb"', 'echo $((2+3))', 'echo {a,b,c}', 'echo {1..3}', 'echo *.nomatch',
  'X=5; echo $X', 'X="a b"; echo "$X"', 'X=hello; echo ${#X}', 'X=hello; echo ${X:0:3}', 'F=doc.tar.gz; echo ${F%.gz} ${F%%.*} ${F#*.} ${F##*.}', 'N="Hello World"; echo ${N/World/Bash} ${N//l/L}',
  'for i in 1 2 3; do echo $i; done', 'for ((i=0; i<3; i++)); do echo $i; done', 'i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done', 'while read l; do echo "L:$l"; done < documents/todo.txt',
  'if [ -f documents/notes.txt ]; then echo yes; else echo no; fi', 'if [ -d nofile ]; then echo yes; elif [ -f documents/notes.txt ]; then echo elif; fi', '[[ abc == a* ]] && echo match',
  'case abc in a*) echo A;; *) echo other;; esac', 'greet() { echo "Hello, $1"; }; greet Ada', 'arr=(one two three); echo ${arr[0]} ${arr[@]} ${#arr[@]}', 'arr=(a b c d e f); echo ${arr[@]:2:3}',
  'ls && echo "Success"', 'cat nofile || echo "Failed"', 'false; echo $?', 'true; echo $?', 'cat nofile 2>/dev/null; echo "rc=$?"', 'cat nofile 2> err.txt; cat err.txt | wc -l', 'echo hi > f.txt; cat f.txt; echo more >> f.txt; cat f.txt; rm f.txt',
  'ls nofile 2>&1 | wc -l', 'echo "gone" > /dev/null', 'echo "I am $(echo me)"', 'echo `echo back`', 'cat documents/todo.txt | tee t.txt | wc -l; cat t.txt | wc -l; rm t.txt',
  'sed "s/Day/Week/" documents/notes.txt', 'sed "s/e/E/g" documents/notes.txt', 'sed -n "1,3p" documents/notes.txt', 'sed "/ERROR/d" documents/projects/data/log.txt', 'cat documents/notes.txt | sed "s/ /-/g"', 'sed "3d" documents/notes.txt', 'sed -n "/Day 2/,/Day 4/p" documents/notes.txt', 'sed "s/\\(Day\\) \\([0-9]\\)/\\2 \\1/" documents/notes.txt',
  `awk '{print $1}' documents/projects/data/users.csv`, `awk -F "," '{print $1}' documents/projects/data/users.csv`, `awk '{print NR, $0}' documents/notes.txt`, `awk -F "," '{print $1, $2}' documents/projects/data/sales.csv`, `awk 'END {print NR}' documents/notes.txt`, `awk -F, 'NR>1 {sum+=$3} END {print sum}' documents/projects/data/sales.csv`, `awk -F, '$3 > 200 {print $2}' documents/projects/data/sales.csv`, `awk '/Day 3/' documents/notes.txt`, `awk -F, '{print NF}' documents/projects/data/users.csv | sort -u`,
  'sort documents/notes.txt', 'sort -r documents/notes.txt', 'sort -t, -k3 -n documents/projects/data/sales.csv', 'cut -d, -f2 documents/projects/data/sales.csv | sort | uniq -c', 'cut -d, -f1,3 documents/projects/data/users.csv', 'sort -u documents/projects/data/sales.csv', 'cut -d, -f2- documents/projects/data/users.csv', 'cut -c1-3 documents/todo.txt',
  'column -t -s, documents/projects/data/users.csv', 'paste documents/notes.txt documents/todo.txt', 'tr "a-z" "A-Z" < documents/todo.txt', 'echo "hello world" | tr "a-z" "A-Z"', 'echo "hello" | tr -d "l"', 'echo aabbcc | tr -s "a-c"',
  'diff documents/notes.txt documents/todo.txt', 'diff -u documents/notes.txt documents/todo.txt | tail -n +3', 'diff documents/notes.txt documents/notes.txt; echo "rc=$?"', 'diff <(sort documents/notes.txt) <(sort documents/todo.txt)', 'grep "hello" <<< "hello world"', 'cat <<EOF\nhello\nworld\nEOF', 'wc -l < documents/todo.txt',
  'find . -name "*.txt" | sort | xargs wc -l', 'echo "alpha beta gamma" | xargs mkdir && ls -d alpha beta gamma && rmdir alpha beta gamma', 'echo "a b c" | xargs -n 1 echo', 'echo "a b c" | xargs -I {} echo "[{}]"',
  'echo "hello" | base64', 'echo "aGVsbG8=" | base64 -d', 'base64 documents/todo.txt', 'xxd documents/todo.txt', 'hexdump -C documents/todo.txt', 'od -A x -t x1 documents/todo.txt', 'od documents/todo.txt',
  'shasum -a 256 documents/notes.txt | cut -d" " -f1 > /dev/null; sha256sum documents/notes.txt', 'md5 documents/notes.txt', 'cat documents/todo.txt | sha256sum', 'file documents/notes.txt', 'file scripts/*', 'file documents', 'file documents/projects/website/index.html',
  'basename /a/b/c.txt', 'dirname /a/b/c.txt', 'basename /a/b/c.txt .txt', 'seq 3', 'seq 2 4', 'printf "%s-%s\\n" a b', 'printf "%05.2f\\n" 3.14159', 'printf "%d items\\n" 3',
  'bash scripts/hello.sh | head -1', './scripts/hello.sh Ada | head -1', 'scripts/hello.sh | tail -1 | wc -w', 'chmod 644 documents/todo.txt; ls -l documents/todo.txt | cut -c1-10', 'chmod +x documents/todo.txt; ls -l documents/todo.txt | cut -c1-10; chmod 644 documents/todo.txt', 'chmod u+x,g-r documents/todo.txt; ls -l documents/todo.txt | cut -c1-10; chmod 644 documents/todo.txt',
  'mkdir -p a/b/c && ls -R a; rm -r a', 'touch z.txt; ls z.txt; rm z.txt; ls z.txt', 'cp documents/todo.txt t2.txt; cat t2.txt | wc -l; mv t2.txt t3.txt; ls t3.txt; rm t3.txt', 'mkdir d1; cp -r documents d1/; ls d1/documents; rm -rf d1', 'mkdir d; rmdir d; ls d', 'rm documents; echo "rc=$?"',
  'ln -s documents/notes.txt my_link; cat my_link | head -1; readlink my_link; ls -l my_link | cut -c1-1; rm my_link', 'ln documents/todo.txt hard; wc -l hard; rm hard',
  'tar -czf b.tar.gz documents/; tar -tzf b.tar.gz | sort | head -3; rm b.tar.gz', 'gzip -k documents/todo.txt; ls documents/todo.txt.gz; gunzip -f documents/todo.txt.gz; wc -l documents/todo.txt',
  'alias ll="ls -a"; shopt -s expand_aliases 2>/dev/null; echo ok', 'export MYNAME="Terminal Cadet"; echo $MYNAME', 'unset NOPE; echo "${NOPE:-default}"', 'type cd', 'type echo', 'type for', 'which nosuchcommand; echo "rc=$?"', 'nosuchcommand 2>/dev/null; echo "rc=$?"',
];

// Small differences I've looked at and kept: the game's base64 takes a file name the way Linux does where macOS
// wants -i, it prints the first ls -R header that macOS skips, and it words two errors to help a beginner.
const KNOWN = new Set(['base64 documents/todo.txt', 'mkdir -p a/b/c && ls -R a; rm -r a', 'rm documents; echo "rc=$?"', 'which nosuchcommand; echo "rc=$?"']);

function normalize(text) {
  return text.replace(/\u00a0/g, ' ').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n+$/, '').trim();
}
// Known, deliberate differences: wording of errors varies by platform, so compare those loosely.
function looseError(a) { return a.replace(/^.*(No such file or directory|Is a directory|Permission denied|not found).*$/gim, '<err:$1>'); }

const browser = await launch();
const results = [];
for (const raw of cases) {
  const cmd = raw.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  const typed = raw.includes('<<EOF') ? raw.split('\\n') : [raw];
  // Real
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-case-'));
  execSync(`cp -R ${JSON.stringify(home + '/.')} ${JSON.stringify(work)}`);
  const r = spawnSync('/bin/bash', ['-c', raw.includes('<<EOF') ? raw.split('\\n').join('\n') : raw], { cwd: work, env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: work, LC_ALL: 'C', LANG: 'C' }, encoding: 'utf8', timeout: 10000 });
  fs.rmSync(work, { recursive: true, force: true });
  const realOut = normalize((r.stderr || '').split('\n').filter(l => !/^(\/bin\/bash|bash): line \d+: /.test('') || true).join('\n') + (r.stderr ? '\n' : '') + (r.stdout || ''));
  // Game
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  await page.evaluate(() => { window.__m = document.getElementById('terminal').lastElementChild; });
  await page.locator('#cmd-input').focus();
  for (const line of typed) { await page.keyboard.type(line); await page.keyboard.press('Enter'); }
  const gameOut = await page.evaluate(() => {
    const t = document.getElementById('terminal'); const a = [...t.children]; const i = a.indexOf(window.__m);
    const clone = a.slice(i + 1).filter(n => !n.querySelector('.prompt-text'));
    return clone.map(n => { const c = n.cloneNode(true); c.querySelectorAll('.dim').forEach(d => d.remove()); return c.innerText; }).join('\n');
  });
  await ctx.close();
  const g = normalize(gameOut);
  // ls prints columns on a terminal and one per line when captured, and stderr and stdout interleave differently
  // here, so a difference in only those two things is a match.
  const tokens = t => looseError(t).split(/\s+/).filter(Boolean).sort().join(' ');
  const same = looseError(g) === looseError(realOut) || (/^ls\b|\bls -d\b|&& ls|; ls|\|\|/.test(raw) && tokens(g) === tokens(realOut));
  results.push({ cmd: raw, same, game: g, real: realOut });
  if (!same) console.log(`DIFF $ ${raw}\n--- game\n${g.slice(0, 500)}\n--- real\n${realOut.slice(0, 500)}\n`);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
const bad = results.filter(r => !r.same);
console.log(`\n${results.length - bad.length}/${results.length} match a real shell`);
fs.writeFileSync(outFile('diff-results.json'), JSON.stringify(results, null, 1));
const surprises = bad.filter(r => !KNOWN.has(r.cmd));
console.log(surprises.length ? `${surprises.length} unexpected: ${surprises.map(r => r.cmd).join(' | ')}` : 'Every difference is on the known list.');
process.exit(surprises.length ? 1 : 0);
