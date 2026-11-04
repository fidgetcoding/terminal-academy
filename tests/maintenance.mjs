// Regressions for filesystem safety, async state, persistence and keyboard operation.
import fs from 'node:fs';
import { BASE, BROWSER, launch, outFile } from './lib.mjs';
const browser = await launch();
const results = [];
async function test(name, fn, { clock = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    if (clock) {
      // Freeze before the app creates timers; host scheduling must not put pauseAt in the past.
      await page.clock.install({ time: new Date('2026-01-01T00:00:00+04:00') });
      await page.clock.pauseAt(new Date('2026-01-02T00:00:00+04:00'));
    }
    await page.goto(BASE);
    await page.getByRole('button', { name: /BEGIN TRAINING/ }).click();
    await fn(page, context);
    results.push({ name, ok: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log('FAIL', name, error.message);
  } finally { await context.close(); }
}
function assert(ok, message) { if (!ok) throw new Error(message); }
const evaluate = (page, fn) => page.evaluate(fn);
await test('mv to the source parent preserves the source', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir keep; echo safe > keep/note; mv keep .');
    return getNode(state.fs, '/home/player/keep/note')?.content === 'safe\n' && state.lastExit !== 0;
  }), 'source was deleted or command silently succeeded');
});
await test('copying directories merges existing destination files', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir -p src dest/src; echo new > src/new; echo keep > dest/src/keep; cp -r src dest');
    return getNode(state.fs, '/home/player/dest/src/keep')?.content === 'keep\n' && getNode(state.fs, '/home/player/dest/src/new')?.content === 'new\n';
  }), 'existing destination content was lost');
});
await test('mv refuses to replace a nonempty directory', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir -p src dest/src; echo keep > dest/src/keep; mv src dest');
    return state.lastExit !== 0 && !!getNode(state.fs, '/home/player/src') && !!getNode(state.fs, '/home/player/dest/src/keep');
  }), 'move destroyed destination content');
});
await test('paths traverse directory symlinks and reject cycles', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir actual; echo linked > actual/note; ln -s actual shortcut; cat shortcut/note');
    const content = getNode(state.fs, '/home/player/shortcut/note')?.content;
    execCommand('ln -s loop loop');
    return content === 'linked\n' && getNode(state.fs, '/home/player/loop/note') === null;
  }), 'intermediate directory symlink did not resolve');
});
await test('failed redirections stop && and set a failing status', async page => {
  assert(await evaluate(page, () => ['> /missing/file', 'echo x &> /missing/file', 'echo x 2> /missing/file'].every(cmd => {
    const output = execCommand(cmd + ' && echo SHOULD_NOT_RUN');
    return state.lastExit !== 0 && !output.includes('SHOULD_NOT_RUN');
  })), 'redirection failure was treated as success');
});
await test('exit restores temporary command variables', async page => {
  assert(await evaluate(page, () => {
    execCommand('TEMP_ONLY=leaked exit');
    return !Object.hasOwn(state.envVars, 'TEMP_ONLY') && pipingOut === false;
  }), 'temporary command environment leaked');
});
await test('cancel invalidates an in-flight import', async page => {
  assert(await evaluate(page, async () => {
    const original = readSaveText;
    let resolve;
    readSaveText = () => new Promise(r => { resolve = r; });
    const checking = checkImport('deferred');
    cancelImport();
    resolve(buildSaveObject());
    await checking;
    readSaveText = original;
    return pendingImport === null && document.getElementById('save-confirm').style.display === 'none';
  }), 'canceled import reappeared');
});
await test('newest import wins when reads resolve out of order', async page => {
  assert(await evaluate(page, async () => {
    const original = readSaveText, resolvers = {};
    readSaveText = name => new Promise(r => { resolvers[name] = r; });
    const first = checkImport('first'), second = checkImport('second');
    resolvers.second({ ...buildSaveObject(), level: 3 }); await second;
    resolvers.first({ ...buildSaveObject(), level: 2 }); await first;
    readSaveText = original;
    return pendingImport?.level === 3;
  }), 'older read replaced the selected save');
});
await test('invalid file selection clears the previous import', async page => {
  assert(await evaluate(page, async () => {
    await checkImport(currentSaveJson());
    loadSaveFile({ files: [{ size: SAVE_MAX_CHARS * 2 + 1 }], value: 'file' });
    return pendingImport === null && document.getElementById('save-confirm').style.display === 'none';
  }), 'old save remained loadable after invalid file');
});
await test('manual navigation cancels delayed chapter advance', async page => {
  await evaluate(page, () => {
    for (const cmd of ['whoami', 'hostname', 'pwd', 'echo "Hello Terminal"']) handleCommand(cmd);
    nextLesson(); prevLesson();
  });
  await page.clock.fastForward(1200);
  assert(await evaluate(page, () => state.currentLesson === 0), 'stale timer moved the learner again');
}, { clock: true });
await test('quiz completion XP persists before the autosave interval', async page => {
  const correct = await evaluate(page, () => {
    showTab('quiz'); startQuiz('basics'); quizState.pool = [quizState.pool[0]]; showQuizQuestion();
    return quizState.pool[0].correct;
  });
  await page.locator('#qopt-' + correct).click();
  await page.clock.runFor(1); // flush click-triggered saving before the completion callback
  await page.clock.runFor(2600);
  assert(await evaluate(page, () => {
    const saved = JSON.parse(localStorage.getItem('terminalAcademy'));
    return saved.xp === state.xp && saved.level === state.level && saved.quizAllTimeTotal === 1;
  }), 'quiz XP was not saved when the timer completed');
}, { clock: true });
await test('unmatched commands preserve mission hints and DOM', async page => {
  assert(await evaluate(page, () => {
    toggleHint(0);
    const panel = document.getElementById('panel-lessons'), hint = panel.querySelector('#hint-0');
    handleCommand('true');
    return hint?.isConnected && hint.classList.contains('show');
  }), 'unchanged mission panel was replaced');
});
await test('command input has a name and Shift+Tab escapes it', async page => {
  await page.locator('#cmd-input').focus();
  assert(await page.getByRole('textbox', { name: 'Terminal command', exact: true }).count() === 1, 'command field has no accessible name');
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(() => document.activeElement.id !== 'cmd-input'), 'keyboard focus trapped in terminal');
});
await test('IME confirmation does not submit a command', async page => {
  assert(await evaluate(page, () => {
    inputEl.value = 'echo composing';
    const count = state.history.length;
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    return state.history.length === count && inputEl.value === 'echo composing';
  }), 'composition Enter executed the partial input');
});
await test('unchanged saves do not write storage repeatedly', async page => {
  assert(await evaluate(page, () => {
    saveState();
    const original = Storage.prototype.setItem; let writes = 0;
    Storage.prototype.setItem = function (...args) { writes++; return original.apply(this, args); };
    for (let i = 0; i < 20; i++) saveState();
    Storage.prototype.setItem = original;
    return writes === 0;
  }), 'unchanged state rewrote storage');
});
await test('storage quota failure is visible and recoverable', async page => {
  assert(await evaluate(page, () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    handleCommand('echo quota');
    const warned = document.getElementById('save-status').textContent.includes("couldn't save");
    Storage.prototype.setItem = original;
    saveState();
    return warned && JSON.parse(localStorage.getItem('terminalAcademy')).history.includes('echo quota');
  }), 'failed save was silent or could not recover');
});
await test('stale tab does not overwrite newer progress', async (page, context) => {
  await evaluate(page, () => { handleCommand('echo initial'); });
  const other = await context.newPage(); await other.goto(BASE);
  await evaluate(page, () => { handleCommand('echo newer'); });
  await evaluate(other, () => { handleCommand('echo stale'); });
  assert(await evaluate(page, () => JSON.parse(localStorage.getItem('terminalAcademy')).history.includes('echo newer')), 'stale tab overwrote newer save');
});
await test('bounded brace expansion refuses huge and unsafe numeric ranges', async page => {
  assert(await evaluate(page, () => {
    // Never execute the known freeze on the old page.
    if (typeof ShellLimit === 'undefined') return false;
    for (const cmd of ['echo {1..1000000000}', 'echo {9007199254740992..9007199254740994}', 'echo {1..101}{1..101}']) {
      const out = execCommand(cmd);
      if (state.lastExit === 0 || !out.includes('simulator limit')) return false;
    }
    return execCommand('echo {3..1}') === '3 2 1';
  }), 'brace expansion has no effective bound');
});
await test('recursive functions stop cleanly and the next command works', async page => {
  assert(await evaluate(page, () => {
    if (typeof ShellLimit === 'undefined') return false;
    execCommand('again() { again; }; again');
    const stopped = state.lastExit !== 0 && shellDepth === 0;
    return stopped && execCommand('echo recovered') === 'recovered';
  }), 'recursive command was not bounded');
});
await test('large diff refuses quadratic allocation but quiet comparison works', async page => {
  assert(await evaluate(page, () => {
    const home = getNode(state.fs, '/home/player');
    home.children.a = file('rw-r--r--', 'a\n'.repeat(1500));
    home.children.b = file('rw-r--r--', 'b\n'.repeat(1500));
    const out = execCommand('diff a b');
    const bounded = state.lastExit === 2 && out.includes('too large');
    execCommand('diff -q a b');
    return bounded && state.lastExit === 1;
  }), 'large comparison allocated the quadratic matrix');
});
await test('archive extraction cannot escape or discard existing directory files', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir -p src dest/src; echo new > src/new; echo keep > dest/src/keep; tar -cf bundle.tar src; tar -xf bundle.tar -C dest');
    const merged = !!getNode(state.fs, '/home/player/dest/src/keep');
    const home = getNode(state.fs, '/home/player');
    home.children.bad = { ...file('rw-r--r--', ''), archive: [{ name: '../escaped', node: file('rw-r--r--', 'oops') }] };
    const refused = checkSave(buildSaveObject(), true).problems.length > 0;
    execCommand('tar -xf bad');
    return merged && refused && state.lastExit !== 0 && !getNode(state.fs, '/home/escaped');
  }), 'archive discarded files or allowed path traversal');
});
await test('dd rejects invalid sizes without making the save unloadable', async page => {
  assert(await evaluate(page, () => {
    for (const args of ['count=-1 bs=1', 'count=3 bs=bogus', 'count=99999999999999999999 bs=1']) {
      execCommand('dd if=/dev/zero of=bad-size ' + args);
      if (state.lastExit === 0 || getNode(state.fs, '/home/player/bad-size')) return false;
    }
    execCommand('dd if=/dev/zero of=empty count=0');
    return getNode(state.fs, '/home/player/empty')?.size === 0 && getNode(state.fs, '/home/player/empty')?.content === '' && checkSave(buildSaveObject(), true).problems.length === 0;
  }), 'invalid dd metadata was written or zero count failed');
});
await test('directory aliases cannot create move cycles or delete protected folders', async page => {
  assert(await evaluate(page, () => {
    execCommand('mkdir -p tree/inside; ln -s tree/inside shortcut; mv tree shortcut');
    const noCycle = state.lastExit !== 0 && !!getNode(state.fs, '/home/player/tree/inside');
    execCommand('ln -s /home home-link; rm -rf home-link/player');
    return noCycle && state.lastExit !== 0 && !!getNode(state.fs, '/home/player');
  }), 'directory alias bypassed filesystem protections');
});
await test('file read cancellation and older read errors cannot change the current import', async page => {
  assert(await evaluate(page, async () => {
    let resolveFile, rejectFile;
    const old = new Promise((resolve, reject) => { resolveFile = resolve; rejectFile = reject; });
    loadSaveFile({ files: [{ size: 20, text: () => old }], value: 'old' });
    const save = currentSaveJson();
    await checkImport(save);
    rejectFile(new Error('late read failure'));
    await Promise.resolve(); await Promise.resolve();
    const errorIgnored = document.getElementById('save-status').textContent.includes('looks good');
    let finish;
    loadSaveFile({ files: [{ size: 20, text: () => new Promise(r => { finish = r; }) }], value: 'canceled' });
    cancelImport(); finish(save);
    await Promise.resolve(); await Promise.resolve();
    return errorIgnored && pendingImport === null;
  }), 'stale file read updated import UI');
});
await test('interrupted subshells restore location and clear temporary descriptors', async page => {
  assert(await evaluate(page, () => {
    execCommand('(cd /tmp; TEMP_INNER=value exit)');
    const restored = state.cwd === '/home/player' && !Object.hasOwn(state.envVars, 'TEMP_INNER');
    execCommand('exit <(echo temporary)');
    return restored && processSubs.length === 0 && !getNode(state.fs, '/dev/fd');
  }), 'subshell state or temporary descriptors leaked');
});
await test('old local archives cannot discard unrelated files on reload', async page => {
  await evaluate(page, () => {
    execCommand('mkdir legacy; echo keep > legacy/note');
    getNode(state.fs, '/home/player').children['legacy.tar'] = {
      ...file('rw-r--r--', ''), archive: [{ name: '../outside', node: file('rw-r--r--', 'unsafe') }],
    };
    saveState();
  });
  await page.reload();
  assert(await evaluate(page, () => {
    const kept = getNode(state.fs, '/home/player/legacy/note')?.content === 'keep\n';
    execCommand('tar -xf legacy.tar');
    return kept && state.lastExit !== 0 && !getNode(state.fs, '/home/outside');
  }), 'legacy archive lost unrelated files or escaped its extraction folder');
});
// Repeatable workload: only the mission validator (no terminal rendering or storage), then redundant saves.
await test('record maintenance benchmark', async page => {
  const measurement = await evaluate(page, () => {
    const samples = [];
    let renders = 0;
    const render = renderLesson;
    renderLesson = () => { renders++; return render(); };
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      for (let i = 0; i < 500; i++) validateTask('true', false);
      samples.push(performance.now() - start);
    }
    renderLesson = render;
    saveState();
    const set = Storage.prototype.setItem; let writes = 0;
    Storage.prototype.setItem = function (...args) { writes++; return set.apply(this, args); };
    const start = performance.now();
    for (let i = 0; i < 100; i++) saveState();
    const saveMs = performance.now() - start;
    Storage.prototype.setItem = set;
    return { validationSamplesMs: samples, renders, redundantSaveWrites: writes, redundantSaveMs: saveMs };
  });
  console.log('MEASURE', JSON.stringify(measurement));
  fs.writeFileSync(outFile(`maintenance-measure-${BROWSER}.json`), JSON.stringify(measurement, null, 2));
});
await browser.close();
fs.writeFileSync(outFile(`maintenance-${BROWSER}.json`), JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.ok).length}/${results.length} maintenance checks passed`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
