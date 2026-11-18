---
description: Build or refresh your voice profile from your GitHub comments, commits and pasted writing
argument-hint: "[github] [commits <repo>...] [paste <context>] [file <context> <path>]"
allowed-tools: Read, Write, Edit, Bash(node:*), Bash(gh auth status), Bash(git config:*)
---

Sources requested: $ARGUMENTS
(If empty: use GitHub, plus commits from the current repo if it is one, then offer the paste option.)

Script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs"`. Data dir: `~/.claude/my-voice/` (or `$MY_VOICE_DIR`).

1. **Collect samples.** Run whichever apply:
   - `github`: `voice.mjs import-gh --limit 100` (issue/PR comments, PR descriptions, review comments; needs `gh` logged in)
   - `commits <repo>`: `voice.mjs import-git <repo> --limit 300` for each repo
   - `paste <context>`: ask the user to paste messages they wrote (Slack, email, forum posts). Write them to a temp file separated by lines containing only `---`, then `voice.mjs add <context> <file>`. Context is `slack`, `email`, or any short name.
   - `file <context> <path>`: `voice.mjs add <context> <path>` (samples split on `---` lines)

   The import drops duplicates, one-word messages, and anything with Claude attribution, since that wasn't written by the user. Report counts.

2. **Check who wrote them.** Coding agents commit and comment under the user's account, and most of that has no attribution line. Run `voice.mjs show <context> --n 40` per context and look for agent tells: third-person "the owner"/"product owner", `## Summary`/`## Verification` sections, criterion tables, long Sentence-case imperative commit titles with wrapped bodies, uniform polish across hundreds of messages. Find the pattern that separates the user's own text (often short, casual, inconsistent) and cut the rest with `voice.mjs prune <context> --keep <regex>` or `--drop <regex>`, using `--dry-run` first. If a whole context is agent-written, prune it to nothing and say so. If you can't tell, ask the user with two or three examples.

3. **Measure.** Run `voice.mjs stats`. It writes `rules.json` and prints per-context numbers.

3. **Read real samples.** For each context with 5+ samples, run `voice.mjs show <context> --n 30` and read them closely. Note anything the numbers miss: favorite words, how they agree and disagree, how they ask for changes, humor, jargon, typos they make consistently, how they refer to teammates, what they never do.

   Ignore messages that are clearly templates, bot output, or pasted logs.

4. **Write `profile.md`** in the data dir. If it exists, keep its `## Corrections` section verbatim and rewrite the rest. Structure:

   ```markdown
   # Voice profile
   Updated: <date>. Sources: <counts per context>.

   ## Overall
   3-6 bullets: the things that most make their writing theirs.

   ## <context> (one section per context)
   - Length: typical N words, rarely over M.
   - Mechanics: casing, punctuation, lists, emoji, contractions.
   - Openers/closers: actual ones, or "none".
   - Approving / disagreeing / asking / reporting a bug: how each looks, with a short real quote for each.

   ## Never
   Things absent from every sample that an assistant would add (e.g. greetings, "Thanks for the PR!", summaries, headings).

   ## Corrections
   (filled in over time from the user's edits)
   ```

   Quote real snippets. Keep quotes short and drop anything private (names of people outside the user's team, emails, secrets, customer data).

5. **Show the user** the Overall and Never sections plus the sample counts, and ask if anything is off. Apply their fixes to `profile.md`.
