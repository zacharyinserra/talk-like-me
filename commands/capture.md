---
description: Turn on or off saving your own messages to Claude as voice samples
argument-hint: "on | off | status"
allowed-tools: Bash(node:*)
---

Requested: $ARGUMENTS

- `on` or `off`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" config capture <on|off>`.
- `status` or empty: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" config`.

Report the result in a line or two. When turning it on, also say:

- From the next message on, what they type to Claude is saved locally to `~/.claude/my-voice/samples/chat.jsonl` as the `chat` context. Slash commands, pasted blocks, code, quoted lines and messages under three words are skipped.
- `rules.json` is recomputed every 25 new samples. `profile.md` only changes when they run `/my-voice:learn` again.
- Messages to Claude are not quite how they write to people, so `chat` stays its own context. Review or trim it with `voice.mjs show chat` and `voice.mjs prune chat --drop <regex>`.
- `MY_VOICE_CAPTURE=off` pauses it for one session without changing the setting.
