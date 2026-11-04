// Takes a save out of each browser engine and loads it into each of the others, by file and by code.
import fs from 'fs';
import { BASE, launch } from './lib.mjs';

const names = ['chromium', 'firefox', 'webkit'];
let browser = null;
let engine = null;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 300)}`);
};
const read = page => page.evaluate(() => {
  const s = buildSaveObject();
  delete s.aliases;
  delete s.functions;
  const sorted = v => Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  return JSON.stringify(sorted(s));
});
async function open(name) {
  if (engine !== name) {
    if (browser) await browser.close();
    browser = await launch(name);
    engine = name;
  }
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
  return { ctx, page };
}
async function send(page, line) {
  await page.locator('#cmd-input').focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

const exported = {};
for (const from of names) {
  const { ctx, page } = await open(from);
  for (const c of ['whoami', 'hostname', 'pwd', 'echo "Hello Terminal"']) await send(page, c);
  await page.locator('#panel-lessons .chapter-label', { hasText: /Chapter 2 of/i }).first().waitFor();
  for (const c of ['mkdir -p ~/moved', 'echo "café ✓ 日本語" > ~/moved/a.txt', 'cd ~/moved']) await send(page, c);
  await page.locator('.panel-tabs button[data-tab="save"]').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download save file' }).click()]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  await page.getByRole('button', { name: 'Show save code' }).click();
  await page.waitForFunction(() => /^TA[01]\./.test(document.getElementById('save-code-out').value));
  exported[from] = { file, code: await page.locator('#save-code-out').inputValue(), state: await read(page) };
  await ctx.close();
}
for (const from of names) {
  for (const to of names) {
    for (const how of ['file', 'code']) {
      const { ctx, page } = await open(to);
      await page.locator('.panel-tabs button[data-tab="save"]').click();
      if (how === 'file') await page.setInputFiles('#save-file', { name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(exported[from].file) });
      else {
        await page.locator('#save-code-in').fill(exported[from].code);
        await page.getByRole('button', { name: 'Check this code' }).click();
      }
      await page.locator('#save-confirm').waitFor();
      const loaded = page.waitForEvent('load');
      await page.getByRole('button', { name: 'Load this save' }).click();
      await loaded;
      await page.locator('#panel-lessons .chapter-label').first().waitFor();
      const state = await read(page);
      check(`${from} to ${to} by ${how}`, state === exported[from].state, state.slice(0, 200));
      await ctx.close();
    }
  }
}
if (browser) await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} cross-browser moves passed`);
process.exit(bad.length ? 1 : 0);
