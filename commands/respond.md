---
description: Turn on or off Claude writing its own replies to you in your voice
argument-hint: "on | off | status"
allowed-tools: Bash(node:*)
---

Requested: $ARGUMENTS

- `on` or `off`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" config respond <on|off>`.
- `status` or empty: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" config`.

Report the result in a line or two. When turning it on, also say:

- From the next message on, every turn gets the Overall, chat, Never and Corrections sections of `~/.claude/talk-like-me/profile.md` as instructions, so Claude's replies follow the user's casing, punctuation, length and tone.
- Code, commands, paths and error text stay exact, and safety warnings and confirmations stay in plain wording.
- Other style instructions (an output style, or another plugin that sets how Claude talks) may conflict. Whichever is more specific tends to win.
- `TALK_LIKE_ME_RESPOND=off` pauses it for one session without changing the setting.
