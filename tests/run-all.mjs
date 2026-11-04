// Runs the browser suites against the index.html in this repo and prints the counts.
//
//   node tests/run-all.mjs [--browser chromium|firefox|webkit] [--quick] [--suite name,name]
//
// --html /path/to/index.html serves an explicit snapshot for before/after checks.
// --quick skips the two full playthroughs, which take most of the time.
// --stored-only resumes save validation at browser storage and round trips.
// --suite runs only the named scripts, for example --suite cross-browser or --suite diff.
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import { arg, BROWSER } from './lib.mjs';

const here = new URL('.', import.meta.url).pathname;
const page = fs.readFileSync(arg('html') || new URL('../index.html', import.meta.url));
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
console.log(`Isolated test server: ${base}`);

const run = (script, args = []) => new Promise(resolve => {
  const child = spawn(process.execPath, [here + script + '.mjs', '--browser', BROWSER, '--base', base, ...args], { stdio: 'inherit' });
  child.on('exit', code => resolve(code === null ? 1 : code));
});

const chosen = arg('suite');
const suites = chosen
  ? chosen.split(',').map(name => [name])
  : [['maintenance'], ['variants'], ['no-backend'], ['xss'], ['save']];
if (!chosen && !process.argv.includes('--quick')) {
  suites.push(['play', ['--viewport', 'desktop', '--out', `play-desktop-${BROWSER}`]]);
  suites.push(['play', ['--viewport', 'mobile', '--out', `play-phone-${BROWSER}`]]);
}
const failed = [];
for (const [script, args] of [['dump'], ...suites]) {
  console.log(`\n=== ${script} ${(args || []).join(' ')} on ${BROWSER} ===`);
  const scriptArgs = script === 'save' && process.argv.includes('--stored-only') ? [...(args || []), '--stored-only'] : args;
  if (await run(script, scriptArgs)) failed.push(script + (args ? ' ' + args[1] : ''));
}
server.close();
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : `\nAll suites passed on ${BROWSER}.`);
process.exit(failed.length ? 1 : 0);
