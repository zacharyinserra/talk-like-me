# my-voice

Claude drafts PR comments, reviews, commit messages, Slack messages and emails that go out under your name. This plugin makes those drafts sound like you wrote them.

## Install

```
claude plugin marketplace add <path-to>/my-voice
claude plugin install my-voice@my-voice-local
```

Then build your profile:

```
/my-voice:learn github commits C:\Code\some-repo
/my-voice:learn paste slack
```

## What's in it

| Piece | Does |
|---|---|
| `write-as-me` skill | Loads automatically when Claude drafts anything posted as you. Reads your profile and real samples, matches length/casing/punctuation/stance, self-checks, shows the draft before sending. |
| `/my-voice:learn` | Pulls your GitHub comments, PR bodies and review comments (`gh`), your commits (`git log --author`), and pasted text. Drops anything with Claude attribution. Writes `profile.md`. |
| `/my-voice:draft <url or text>` | Drafts a reply in your voice. |
| `/my-voice:capture on\|off` | Optional, off by default. Saves what you type to Claude as `chat` samples (skips slash commands, pasted blocks, code, quotes, messages under three words) and refreshes `rules.json` every 25 new ones. |
| PreToolUse hook | When text is posted via `gh pr/issue comment|review|create`, `git commit`, or an MCP send/post/comment tool, checks it against your rules. Blocks Claude attribution, phrases you never use, em dashes/emoji/exclamation marks/headings if you never use them, and messages over twice your usual length. Resending the same text unchanged lets it through (for when you want that wording). |

## Data

`~/.claude/my-voice/` (override with `MY_VOICE_DIR`):

- `samples/<context>.jsonl`: your messages, per context (`github`, `commit`, `slack`, `email`, ...)
- `rules.json`: measured habits. Edit `extra_banned` and `allow` by hand; they survive re-runs.
- `profile.md`: written description. The `## Corrections` section grows as you edit drafts.
- `config.json`: `capture_prompts` (set with `/my-voice:capture`).

For one session: `MY_VOICE_HOOK=off` disables the pre-post check, `MY_VOICE_CAPTURE=on|off` overrides the capture setting.

## Script

`node scripts/voice.mjs import-gh | import-git [repo] | add <ctx> [file] | prune <ctx> --keep|--drop <re> | stats | show <ctx> | check <ctx> [file] | config [capture on|off]`. No dependencies; needs Node 18+, and `gh` for GitHub import.
