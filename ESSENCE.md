# Terminal Academy, on one page

**Play it live, no login: <https://fidgetcoding.github.io/terminal-academy/>**

**What it is.** A terminal you play in your browser. 81 chapters, a 10-quest detective story, 48 challenges, a quiz, a glossary, 37 achievements, XP and levels. It's one HTML file. Everything you type runs inside a pretend computer, so you can't hurt your real one.

**Who it's for.** Anyone who's never opened a terminal, or who has and still feels shaky about it.

**Why it exists.** You learn by doing, not by reading walls of text. The goal is enough fluency to work comfortably with tools like Claude Code.

**What's different.**

- No install, no account, nothing to break. Open a link and type.
- The pretend computer acts like a real one. `grep`, `awk`, `sed`, pipes, globs, loops and heredocs run on actual files in the game, and `git status` follows what you did.
- A wrong answer teaches you something. Typos don't pass, a failed path tells you where you are, and `restore` brings back anything you deleted.
- Your save is yours. It lives in your browser, and a save file or code moves it to another device. Nothing uploads it.
- I count visits and finished chapters so I can see whether the course works, never what you type. One click turns that off.

**How to try it.**

1. Open <https://fidgetcoding.github.io/terminal-academy/>
2. Click **BEGIN TRAINING**.
3. Do what the panel says. Type `help` if you get lost.

**What works today.** From the test run on every push, last at `1d89989`, in Chromium, Firefox and WebKit:

- All 81 chapters finish: 390 commands typed, 390 clean, 0 problems, at desktop and phone size.
- All 10 quests finish, all 48 challenges and 81 quiz answers play, all 37 achievements unlock.
- XP comes out exactly as the math says it should: 13,225.
- 74 of 74 messy-input checks pass: typos, tab completion, arrow keys, reloads, a phone keyboard.
- 60 of 60 no-backend checks pass, including usage counts held to one host and fixed shapes.
- 784 hostile commands, 0 problems. Over 1,100 save checks pass, with hostile saves refused.
- 18 of 18 save moves between browsers pass.
- 175 of 179 taught commands match a real bash on macOS.
