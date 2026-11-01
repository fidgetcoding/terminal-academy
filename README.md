# Terminal Academy

A gamified way to learn how to use the terminal. No experience needed.

## Play Now

**[Launch Terminal Academy](https://fidgetcoding.github.io/terminal-academy/)**

## Your Progress

Your progress lives in your browser, and the page sends nothing anywhere. To keep playing on another device, open the Save tab, take a save file or a save code, and load it there.

## What You'll Learn

- How to navigate files and folders from the command line
- Essential commands every developer uses daily (cd, ls, mkdir, cp, mv, rm, cat, grep, and more)
- How to read error messages and fix common mistakes
- How to chain commands together to get real work done
- Enough terminal fluency to work comfortably with tools like Claude Code

## Who This Is For

Anyone who has never used a terminal before, or anyone who has but still feels shaky about it. The lessons are short, interactive, and build on each other. You learn by doing, not by reading walls of text.

## How I Test It

Every push plays the whole game in real browsers: 390 mission commands, 42 adventure objectives, 48 challenges, and every quiz question, in Chromium, Firefox, and WebKit, at desktop and phone size. It also runs 784 hostile commands and 139 hostile saves to prove nothing typed or loaded can run as code, and compares 179 commands against a real bash. To rerun it yourself on Node 22 (Playwright's browser install hung for me on Node 26):

```bash
cd tests && npm ci && npx playwright install chromium firefox webkit
node run-all.mjs --browser firefox
```
