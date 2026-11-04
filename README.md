![Terminal Academy](docs/images/banner.png)

# Terminal Academy

**Learn the terminal by playing it. No install, no experience, nothing you can break.**

## ▶ [Play it live, no login: fidgetcoding.github.io/terminal-academy](https://fidgetcoding.github.io/terminal-academy/)

**Want the real story?** [ESSENCE.md](ESSENCE.md) is the one-pager. [EVOLUTION.md](EVOLUTION.md) is how it got here.

## What it is

A game that runs in your browser. It looks like a real terminal and acts like one, but everything happens inside a pretend computer. Delete the wrong folder, run the scary command, get it all wrong. Your actual machine never finds out.

## Why I made it

It's for anyone who has never used a terminal, or who has and still feels shaky about it. You learn by doing, not by reading walls of text. By the end you're fluent enough to work comfortably with tools like Claude Code.

## How to play

1. Open **<https://fidgetcoding.github.io/terminal-academy/>**
2. Click **BEGIN TRAINING**.
3. Read the panel, type what it asks, hit Enter. Finish the missions and you move on.

No account, no email, no password. Stuck? Three commands get you out of most holes:

| Type this | What happens |
|---|---|
| `help` | Lists what you can do |
| `restore` | Brings back the starter files you nuked |
| `cancel` or `Ctrl+C` | Gets you out of a half-typed command |

## What's in it

- **81 chapters.** Starts at "welcome to the terminal" and `ls`, and keeps going through pipes, `grep`, `find`, permissions, scripting, `git`, `jq`, `rsync` and `sqlite3`.
- **Adventure mode.** A 10-quest detective story you solve with commands.
- **48 challenges** across easy, medium, hard and expert.
- **A quiz and a glossary.** Quiz yourself, or look up what on earth `stderr` means.
- **XP, levels and 37 achievements**, because apparently that's what it takes.
- **A pretend computer that behaves.** Files are real files in the game. `grep` finds what's actually there, `chmod` actually locks and unlocks things, and `git status` follows what you did.
- **Saves you can move.** Your progress lives in your browser. To keep playing on another device, open the Save tab, take a save file or a save code, and load it there. Your save is never uploaded.

Commands are simulated, so `rm -rf /` just gets you a stern refusal. In a real terminal, please don't. The lessons on the truly dangerous stuff tell you what to watch for.

## What I count

To see whether the course works, I count these things, with no cookies and no ID:

- each time the page opens
- each chapter started and finished
- each adventure quest finished
- finishing every chapter

The counts go to [PostHog](https://posthog.com), a service that stores them for me. PostHog can see your IP address when a count arrives, as any website can, and the game asks it not to work out your location from it. The game never sends what you type, your files, your save, or your name.

To opt out, click "Don't count me" on the welcome screen or untick the box in the Save tab. Browsers set to Global Privacy Control or Do Not Track are never counted. Copies of the game on any other address count nothing. The page's security policy lets it connect to PostHog and nowhere else.

## Run it yourself

It's one HTML file. There's no build.

```bash
git clone https://github.com/fidgetcoding/terminal-academy.git
cd terminal-academy
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Pushing to `main` deploys to GitHub Pages. Got a fork? Turn on Pages and yours deploys too.

## How I test it

Every push plays the whole game in Chromium, Firefox and WebKit, at desktop and phone size: 390 mission commands, every quest, all 48 challenges and every quiz question. It also runs 784 hostile commands and over 1,100 save checks to prove nothing typed or loaded can run as code, moves saves between browsers, checks every usage count against the list above, and compares 179 commands against a real bash on macOS. 175 match. Test runs never send real counts.

To rerun it on Node 22:

```bash
cd tests && npm ci && npx playwright install chromium firefox webkit
node run-all.mjs --browser firefox
```

From the repository root, run a focused check of filesystem safety, save races, progression timers and keyboard behavior:

```bash
node tests/run-all.mjs --suite maintenance
```

The full runner includes these checks. It starts an isolated localhost server and prints its address; test traffic never sends real usage counts.

To rerun the stored-save and round-trip phase after a save-suite failure:

```bash
node tests/run-all.mjs --browser webkit --suite save --stored-only
```

This runs the remaining phase explicitly; use the full save suite for import coverage. Save tests retain completed assertions and the active case in `tests/out/` if a browser operation throws. WebKit uses fresh browsers between batches of 32 stored saves; the isolated navigation probe stopped at context 64 on both baseline and fixed code.

## License

[MIT](LICENSE). Built by Nate Davidovich / Lorecraft LLC.
