// Shared setup for the test scripts: which browser to use, where the game is, and where results go.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'fs';

export const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
export const BROWSER = arg('browser', process.env.BROWSER || 'chromium');
export const BASE = arg('base', process.env.BASE || 'http://127.0.0.1:8811/index.html');
export const ORIGIN = new URL(BASE).origin;

const OUT_DIR = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT_DIR, { recursive: true });
export const outFile = name => new URL(name, OUT_DIR);

const engines = { chromium, firefox, webkit };
// Always headless and always silent. The second part is for browsers that would otherwise make noise on my Mac.
const quiet = {
  chromium: { headless: true, args: ['--mute-audio'] },
  firefox: { headless: true, firefoxUserPrefs: { 'media.volume_scale': '0.0' } },
  webkit: { headless: true },
};
export const launch = async (name = BROWSER) => {
  if (!engines[name]) throw new Error(`Unknown browser: ${name}. Use chromium, firefox, or webkit.`);
  const browser = await engines[name].launch(quiet[name]);
  // A test run must never add to the real usage counts, even when pointed at the live page.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const ctx = await newContext(options);
    await ctx.route(COLLECTOR + '/**', accepted);
    return ctx;
  };
  return browser;
};
// ---- Usage counts ----
export const LIVE_URL = 'https://fidgetcoding.github.io/terminal-academy/';
export const COLLECTOR = 'https://us.i.posthog.com';
const accepted = route => route.fulfill({
  status: 200,
  headers: { 'Access-Control-Allow-Origin': LIVE_URL.replace(/\/terminal-academy\/$/, ''), 'Access-Control-Allow-Headers': 'content-type' },
  contentType: 'application/json',
  body: '{"status":"Ok"}',
});

// The game only counts on its real address, so this shows it that address with no network involved: the page comes from
// BASE and the collector is a stand-in. Returns the list of everything sent to the collector. down: 'abort', '500', or 'hang'.
export async function asLive(ctx, { down } = {}) {
  const body = await (await fetch(BASE)).text();
  const sent = [];
  await ctx.route(url => url.href.startsWith(LIVE_URL), route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
  await ctx.route(COLLECTOR + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return accepted(route);
    sent.push({ url: req.url(), method: req.method(), body: req.postData(), headers: await req.allHeaders() });
    if (down === 'abort') return route.abort();
    if (down === '500') return route.fulfill({ status: 500, body: 'down' });
    if (down === 'hang') return undefined;
    return accepted(route);
  });
  return sent;
}

// Says what's wrong with a request to the collector, or '' if it's exactly the agreed shape.
export function badCount(count) {
  if (count.url !== COLLECTOR + '/i/v0/e/') return `wrong address: ${count.url}`;
  if (count.method !== 'POST') return `wrong method: ${count.method}`;
  for (const h of ['cookie', 'referer']) if (count.headers[h]) return `sent a ${h} header`;
  let c;
  try { c = JSON.parse(count.body); } catch (e) { return `not JSON: ${count.body}`; }
  const keys = o => Object.keys(o).sort().join(',');
  if (keys(c) !== 'api_key,distinct_id,event,properties') return `wrong fields: ${keys(c)}`;
  if (!/^phc_[A-Za-z0-9]+$/.test(c.api_key)) return 'wrong key';
  if (c.distinct_id !== 'anonymous') return `an ID: ${c.distinct_id}`;
  const shapes = { visit: null, game_finished: null, chapter_started: ['chapter', 81], chapter_finished: ['chapter', 81], quest_finished: ['quest', 10] };
  const name = c.event.replace(/^terminal_academy_/, '');
  if (!c.event.startsWith('terminal_academy_') || !Object.hasOwn(shapes, name)) return `unknown event: ${c.event}`;
  const shape = shapes[name];
  const allowed = ['$geoip_disable', '$process_person_profile', ...(shape ? [shape[0]] : [])].sort().join(',');
  if (keys(c.properties) !== allowed) return `wrong properties: ${keys(c.properties)}`;
  if (c.properties.$process_person_profile !== false || c.properties.$geoip_disable !== true) return 'privacy flags changed';
  if (shape) {
    const n = c.properties[shape[0]];
    if (!Number.isInteger(n) || n < 1 || n > shape[1]) return `not a course number: ${n}`;
  }
  return '';
}
export const countName = count => JSON.parse(count.body).event.replace(/^terminal_academy_/, '');
export const countNumber = count => { const p = JSON.parse(count.body).properties; return p.chapter ?? p.quest ?? null; };

// Only Chromium can emulate a phone's page handling. The other two get the phone's size and touch.
export const mobile = (name = BROWSER) => (name === 'chromium' ? { isMobile: true } : {});
