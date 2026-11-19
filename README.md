# talk-like-me

Claude drafts PR comments, reviews, commit messages, Slack messages and emails that go out under your name. This plugin makes those drafts sound like you wrote them.

## Install

```
claude plugin marketplace add <path-to>/talk-like-me
claude plugin install talk-like-me@talk-like-me-local
```

Then build your profile:

```
/talk-like-me:learn github commits C:\Code\some-repo
/talk-like-me:learn paste slack
```

## What's in it

| Piece | Does |
|---|---|
| `write-as-me` skill | Loads automatically when Claude drafts anything posted as you. Reads your profile and real samples, matches length/casing/punctuation/stance, self-checks, shows the draft before sending. |
| `/talk-like-me:learn` | Pulls your GitHub comments, PR bodies and review comments (`gh`), your commits (`git log --author`), and pasted text. Drops anything with Claude attribution. Writes `profile.md`. |
| `/talk-like-me:draft <url or text>` | Drafts a reply in your voice. |
| `/talk-like-me:capture on\|off` | Optional, off by default. Saves what you type to Claude as `chat` samples (skips slash commands, pasted blocks, code, quotes, messages under three words) and refreshes `rules.json` every 25 new ones. |
| PreToolUse hook | When text is posted via `gh pr/issue comment|review|create`, `git commit`, or an MCP send/post/comment tool, checks it against your rules. Blocks Claude attribution, phrases you never use, em dashes/emoji/exclamation marks/headings if you never use them, and messages over twice your usual length. Resending the same text unchanged lets it through (for when you want that wording). |

## Data

`~/.claude/talk-like-me/` (override with `TALK_LIKE_ME_DIR`):

- `samples/<context>.jsonl`: your messages, per context (`github`, `commit`, `slack`, `email`, ...)
- `rules.json`: measured habits. Edit `extra_banned` and `allow` by hand; they survive re-runs.
- `profile.md`: written description. The `## Corrections` section grows as you edit drafts.
- `config.json`: `capture_prompts` (set with `/talk-like-me:capture`).

For one session: `TALK_LIKE_ME_HOOK=off` disables the pre-post check, `TALK_LIKE_ME_CAPTURE=on|off` overrides the capture setting.

## Script

`node scripts/voice.mjs import-gh | import-git [repo] | add <ctx> [file] | prune <ctx> --keep|--drop <re> | stats | show <ctx> | check <ctx> [file] | config [capture on|off]`. No dependencies; needs Node 18+, and `gh` for GitHub import.
