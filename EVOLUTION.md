# How Terminal Academy got built

## Short version

Terminal Academy went from nothing to 81 chapters in two days in March 2026. A swarm audit fixed 30+ bugs in April, and for months it looked done. On 2026-11-01 a robot played the entire game, the first full scripted playthrough on record. It hit 606 problems in the first run. Same day, ten commits later, the same robot finished 390 commands with 0 problems, at desktop and phone size, and the dead login was gone. Later that day saves learned to move between devices, the tests moved into the repo and CI, Firefox joined, and the game started counting anonymous usage.

## Origin, in my words

It's for "anyone who has never used a terminal before, or anyone who has but still feels shaky about it." "You learn by doing, not by reading walls of text."

## Timeline

| Date | Commit | What happened |
|---|---|---|
| 2026-03-22 | `b130b22` | First release: terminal learning game |
| 2026-03-22 | `5f9baf6` | Phones and Adventure Mode |
| 2026-03-22 | `9e3a322` | Login with Supabase cloud saves |
| 2026-03-22 | `3bbe483` | First bug pass: 7 bugs from code review |
| 2026-03-23 | `193f7db` | 18 chapters become 35 |
| 2026-03-23 | `64897a2` | 35 become 81 |
| 2026-04-02 | `13334b5` | 15-agent QA swarm: 30+ bugs fixed |
| 2026-04-02 | `6041e5d` | Login and signup fixed |
| 2026-04-14 | `c85ed20` | MIT license |
| 2026-04-25 | `c79f7d4` | gitleaks pre-commit hook |
| 2026-05-22 | `86d24c9` | Moves to the fidgetcoding Pages URL |
| 2026-08-17 | `0e1bb42` | Neutral name in the examples |
| 2026-11-01 | `4829d9e` | Save system fixed |
| 2026-11-01 | `1d0fd52` | New shell parser and text tools |
| 2026-11-01 | `582effb` | Simulated tools act on real data |
| 2026-11-01 | `87634e3` | Every mission works as written |
| 2026-11-01 | `f269bd0` | Quests, challenges, quiz, stale facts, phones |
| 2026-11-01 | `dfb0a51` | Remaining stale facts, from reading every mission's output |
| 2026-11-01 | `4c35315` | Dead login and cloud sync removed |
| 2026-11-01 | `c766104` | Typed commands can no longer run as HTML |
| 2026-11-01 | `9f1cd5e` | Safety notes on commands that can do real damage |
| 2026-11-01 | `c016931` | Repo tooling tightened, Pages publishes only `index.html` |
| 2026-11-01 | `8c43fa7` | Save files and save codes, every save checked as untrusted |
| 2026-11-01 | `fa358df` | Test suites ship in the repo, with a CI job |
| 2026-11-01 | `87e35f6` | Anonymous usage counts, and the page says exactly what is counted |
| 2026-11-01 | `9ef4ad3` | Tests hold counts to one host and fixed shapes, and stay silent |

## Round by round

**Round 1: make it big (03-22 to 03-23).** Built a sandbox with XP, missions, quests and a login, then took the chapter count from 18 to 81 in a day. Tested by code review, 7 bugs.

**Round 2: send a swarm (04-02).** 15 agents audited it and fixed 30+ bugs, and login got repaired the same day. Chapter 61 still couldn't be finished after that, which is how I know the audit didn't play it through.

**Round 3: play the whole thing (11-01).** A Playwright script typed every instruction in every chapter, played every quest, challenge and quiz question, and reloaded the page along the way like a real person would. The first run broke progress at chapters 13, 40 and 62 and ended at 64 of 81. Six commits later it finished clean.

**Round 4: clear the safety list (11-01).** A safety check found the login page loading an unpinned script for a backend that no longer resolved, and typed commands able to run as HTML. Pasting a booby-trapped `su` command ran script, and saved values replayed it on every reload. Four more commits fixed all of it, and the full playthrough got rerun on the result.

**Round 5: finish the list (11-01).** Saves went portable, with 89 hostile saves refused in testing. The scripts went into the repo so every number here can be rerun, and CI runs them in Chromium, Firefox and WebKit on every push. Then usage counts, so I can see whether anyone finishes. A deliberately leaking copy of the page failed 4 no-backend checks, so those checks do catch a leak. On 2026-11-02 one real count from the live page reached PostHog with a 200.

## Bug log, 2026-11-01

| What a player hit | Fixed in |
|---|---|
| Waiting 10 seconds on the login screen, or reloading twice, sent you back to chapter 1 | `4829d9e` |
| Files you made in earlier chapters vanished on reload | `4829d9e` |
| `awk '{print $1}'` lost its `$1`, and `export VAR="two words"` kept half | `1d0fd52` |
| No `\|\|`, `$?`, `$(...)`, loops, globs or heredocs | `1d0fd52` |
| `tail -n` and `wc -l` off by one | `1d0fd52` |
| A command that printed an error could still pass a mission | `1d0fd52` |
| `diff`, `du`, `jq`, `git`, `tar` and others printed canned text no matter what you gave them | `582effb` |
| `python3 -c` and `node -e` printed 1024 for everything | `582effb` |
| Chapter 12 left you in `~/final_test`, so every later relative path failed | `87634e3` |
| The heredoc mission couldn't be finished, so chapter 61 and the final achievement were out of reach | `87634e3` |
| `cal` passed a mission because the word "local" contains it | `87634e3` |
| `jq select` and `jq map` taught as if they were real commands | `87634e3` |
| Quest 3 told you to read files in a folder you'd never been sent to | `f269bd0` |
| The vault key wasn't actually locked until `chmod` | `f269bd0` |
| Switching tabs threw away a quiz in progress | `f269bd0` |
| The input box dropped every space and didn't scroll, so on a phone you couldn't see what you typed | `f269bd0` |
| Stale facts about Claude Code, Warp, Ghostty and `Ctrl+Z` | `f269bd0` |
| `gpg -c` promising AES-256, `xargs -P` without `-n 1`, a wrong Warp search shortcut | `dfb0a51` |
| Every visitor landed on a login that could only fail | `4c35315` |
| A pasted command could run script, and saved values replayed it on reload | `c766104` |
| `rm -rf`, `rsync --delete`, `curl \| sh`, port scans and tokens on the command line taught with no warning | `9f1cd5e` |

## Test log

| Run, 2026-11-01 | Commands | Clean | Chapters | Achievements | Problems |
|---|---|---|---|---|---|
| Old code, with reloads | 384 | 338 | 64/81 | 33/37 | 606 |
| Old code, no reloads | 388 | 344 | 80/81 | 35/37 | 114 |
| Final, Chromium desktop | 390 | 390 | 81/81 | 37/37 | 0 |
| Final, Chromium phone | 390 | 390 | 81/81 | 37/37 | 0 |
| Final, WebKit phone | 390 | 390 | 81/81 | 37/37 | 0 |

The 606 includes a lot of knock-on damage, since one lost save wrecks everything after it. In the fixed runs, 385 of 390 instructions pass when typed exactly as shown. XP is 13,225 against an expected 13,225. On the old code it was 10,920 against 13,145.

- **Variant check:** 74 of 74: typos, tab completion, arrow keys, quoted paths, `rm -rf /` refused, reloads, phone keyboard.
- **Against a real shell:** 175 of 179 commands matched bash on macOS. The 4 that differ: `base64 FILE` works in the game and not on BSD, `ls -R` adds a header line, and `rm` and `which` word their errors differently.
- **No backend:** 60 of 60 at `1d89989`: no login anywhere, no external scripts, nothing outbound but the listed counts, plays with outside hosts or browser storage blocked, old saves still load.
- **Hostile input:** 206 commands, 784 runs through the terminal, 0 problems at the final commit. Before the fix, the same test found 57 problems, 13 of them script actually running.
- **Saves:** over 1,100 checks on each engine, 18 of 18 moves between browsers.
- **Browsers:** Chromium, Firefox and WebKit engines, on every push.

## Roads not taken

- **An install.** It's one HTML file on GitHub Pages.
- **Real commands.** Everything is simulated. The page's only network call is the usage count.
- **Accounts.** Login with cloud saves went in on 03-22 and came out on 11-01. Guest play is what kept the game alive after the backend died, so guest play is now the only way in.

## Sources

- Git log of `fidgetcoding/terminal-academy`, including today's ten commits, through `1d89989`.
- Test output: the scripts in `tests/`, run by `.github/workflows/tests.yml`.
- 2026-11-01 safety check of the repo (private report).
- `index.html`, `README.md`.
