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
export const launch = (name = BROWSER) => {
  if (!engines[name]) throw new Error(`Unknown browser: ${name}. Use chromium, firefox, or webkit.`);
  return engines[name].launch();
};
// Only Chromium can emulate a phone's page handling. The other two get the phone's size and touch.
export const mobile = (name = BROWSER) => (name === 'chromium' ? { isMobile: true } : {});
