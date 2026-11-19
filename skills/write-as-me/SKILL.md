---
name: write-as-me
description: Write in the user's own voice anything that will be posted or sent under their name - PR and issue comments, code review replies, PR descriptions, commit messages, Slack/Discord/Teams messages, emails, forum replies. Load BEFORE drafting any of these, even short ones like "lgtm" or a one-line reply, and whenever the user says "reply to this", "respond for me", "draft a comment/message/email", "write it like me" or "in my voice".
---

# Write as me

Text that goes out under the user's name must read as if they typed it. Readers who know them should not be able to tell. The goal is their voice, not a better-written version of it.

## 1. Load the voice

The voice data lives in `~/.claude/my-voice/` (or `$MY_VOICE_DIR`):

- `profile.md`: the written description of how they write. Read it every time.
- `rules.json`: measured habits per context (length, casing, punctuation, emoji, bullets) and phrases they never use.
- `samples/<context>.jsonl`: their real messages.

Pick the context: `github` (issue/PR comments, reviews, PR bodies), `commit`, `slack` (any chat), `email`, or `default`. If that context has few or no samples, `chat` (the user's own messages to Claude, saved when capture is on) is the next best source for casing, punctuation and phrasing, but people write to Claude more tersely than to coworkers, so don't copy its length or bluntness one-to-one. Then pull real examples:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" show <context> --n 15
```

Read them for the thing you are about to write. An approval, a pushback, a question and a bug report each have their own shape; find the closest ones.

**No profile yet?** Say once that `/my-voice:learn` would make this much better. Meanwhile, use the user's own messages in this conversation as the voice sample (casing, length, punctuation, how direct they are) and keep the draft short and plain.

**Project conventions win.** If the repo sets a format for commits, PR descriptions or issue comments (CLAUDE.md, AGENTS.md, CONTRIBUTING, commitlint, PR templates, or a consistent style in recent history), follow it. The user's voice is for conversational text: replies, review comments, chat, email. For a formatted PR body or commit it only shapes the wording inside that format.

## 2. Draft

Match, in this order of importance:

1. **Length.** Use their median for this context, not what the topic seems to deserve. If they answer reviews in eight words, answer in about eight words. Going long is the most common giveaway.
2. **Mechanics.** Capitalization at the start, trailing period or not, contractions, how they write lists (or don't), emoji, exclamation marks, "ok" vs "okay", "thx" vs "thanks". Copy what the samples do, including habits that a style guide would "fix".
3. **Openers and sign-offs.** Use theirs, or none if they use none. Never add "Hi team," or "Best," if they don't.
4. **Stance.** Mirror how direct they are. A blunt reviewer writes "this is wrong, should be X"; a gentle one writes "wonder if X would work here?". Do not soften a blunt writer or sharpen a gentle one.
5. **Vocabulary.** Reuse their words and jargon. Avoid words they never use, especially the ones in `rules.json` `banned`.

Hard rules:

- Write in first person as the user. Never mention Claude, AI, "I've drafted", or add attribution lines or emoji signatures.
- Only state what the user knows or what you verified in this session. Do not invent test results, timelines, promises, or opinions they haven't expressed. If the message needs a fact you don't have (a date, a decision), leave a `[TODO: ...]` and point it out.
- Don't answer more than was asked. No recap of the thread, no "let me know if you have questions" closer, no thanking people for things they didn't do.
- Keep code, file names, links and quoted error text exact.

## 3. Check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" check <context> - <<'EOF'
<draft>
EOF
```

Fix whatever it flags. Then reread the draft next to two of their real messages and ask: would a coworker notice a different person wrote this? If yes, find what's off (usually length, politeness, or structure) and fix it.

## 4. Show, then send

Show the draft in a quote block with where it will go (repo/PR, channel, recipient). Send only after the user approves, unless they already told you to post it. The plugin's PreToolUse hook re-checks the text when it is posted through `gh`, `git commit`, or a messaging tool and blocks it if it contains phrases or marks the user never uses. If the hook blocks and the user explicitly wanted that wording, resend the same text unchanged; it will pass the second time.

## 5. Learn from edits

When the user changes your draft before sending, or says "I'd never say X", that's the most valuable signal there is:

1. Save the final text they approved as a sample:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" add <context> - <<'EOF'
   <final text>
   EOF
   ```
2. Add the correction to the `## Corrections` section of `profile.md` as a one-line rule ("never 'Thanks for flagging'; just 'good catch'"). If it's a phrase to ban outright, add it to `extra_banned` in `rules.json`.
