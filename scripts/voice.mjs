#!/usr/bin/env node
// talk-like-me: collect writing samples, measure them, and check drafts against them.
//
//   voice.mjs import-gh [--limit N]          your GitHub issue/PR comments, PR bodies, review comments
//   voice.mjs import-git [repo] [--limit N]  your commit messages in a repo (default: cwd)
//   voice.mjs add <context> [file|-]         one sample (stdin by default); "---" lines split several
//   voice.mjs prune <ctx> --keep|--drop <re> remove samples you didn't write (e.g. agent commits)
//   voice.mjs stats                          recompute rules.json from samples, print summary
//   voice.mjs show <context> [--n N]         print N random samples for a context
//   voice.mjs check <context> [file|-]       lint a draft against your rules
//   voice.mjs config [capture on|off]        show settings, or toggle saving your prompts as samples
//   voice.mjs hook                           PreToolUse hook (reads hook JSON on stdin)
//   voice.mjs capture                        UserPromptSubmit hook; does nothing unless capture is on
//
// Data lives in ~/.claude/talk-like-me (override with TALK_LIKE_ME_DIR):
//   samples/<context>.jsonl   {text, source, hash}
//   rules.json                measured habits + phrase lists (hand-editable "extra_banned"/"allow")
//   profile.md                written by Claude during /talk-like-me:learn
//   config.json               {capture_prompts: bool}; TALK_LIKE_ME_CAPTURE=on|off overrides it

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.TALK_LIKE_ME_DIR || path.join(os.homedir(), '.claude', 'talk-like-me');
const SAMPLES = path.join(DIR, 'samples');
const RULES = path.join(DIR, 'rules.json');
const CONFIG = path.join(DIR, 'config.json');
const RESTATS_EVERY = 25;

// Phrases that mark text as assistant-written. Dropped from the banned list if
// the user's own samples use them.
const DEFAULT_BANNED = [
  'i hope this helps',
  'hope this helps!',
  'great question',
  "i'd be happy to",
  'happy to help',
  'let me know if you have any',
  'feel free to reach out',
  "don't hesitate to",
  'thanks for raising this',
  'thank you for bringing this',
  'it is worth noting',
  "it's worth noting",
  'delve',
  'as an ai',
  'i apologize for the confusion',
  'you are absolutely right',
  "you're absolutely right",
  'in summary,',
  'to summarize,',
  'certainly!',
  'great catch!',
  'robust',
  'seamless',
  'leverage',
];

const ATTRIBUTION = [
  /generated with \[?claude/i,
  /co-authored-by:\s*claude/i,
  /noreply@anthropic\.com/i,
  /🤖/u,
  /\bas claude\b/i,
];

// ---------- helpers ----------

const hash = (s) => createHash('sha1').update(s.trim()).digest('hex').slice(0, 16);

function ensureDirs() {
  fs.mkdirSync(SAMPLES, { recursive: true });
}

function readInput(arg) {
  if (!arg || arg === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(arg, 'utf8');
}

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

// Remove code, quoted replies and URLs so they don't skew stats or trip checks.
function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .trim();
}

function words(text) {
  return text.match(/[\p{L}\p{N}'’]+/gu) || [];
}

function isUsable(text) {
  const t = text.trim();
  if (words(prose(t)).length < 2) return false;
  if (ATTRIBUTION.some((re) => re.test(t))) return false; // written by an assistant, not you
  return true;
}

function loadSamples(context) {
  if (!fs.existsSync(SAMPLES)) return [];
  const files = context
    ? [path.join(SAMPLES, `${context}.jsonl`)]
    : fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(SAMPLES, f));
  const out = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push({ ...JSON.parse(line), context: path.basename(f, '.jsonl') });
      } catch {
        // skip a corrupt line rather than lose the whole file
      }
    }
  }
  return out;
}

function saveSamples(context, texts, source) {
  ensureDirs();
  const file = path.join(SAMPLES, `${context}.jsonl`);
  const seen = new Set(loadSamples(context).map((s) => s.hash));
  let added = 0;
  let skipped = 0;
  const lines = [];
  for (const raw of texts) {
    const text = raw.replace(/\r\n/g, '\n').trim();
    const h = hash(text);
    if (seen.has(h) || !isUsable(text)) {
      skipped++;
      continue;
    }
    seen.add(h);
    lines.push(JSON.stringify({ text, source, hash: h }));
    added++;
  }
  if (lines.length) fs.appendFileSync(file, lines.join('\n') + '\n');
  return { added, skipped };
}

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- import ----------

function importGh(args) {
  const limit = Number(flag(args, '--limit', 100));
  const query = `query($n:Int!){viewer{
    issueComments(last:$n){nodes{body}}
    pullRequests(last:$n){nodes{body}}
    contributionsCollection{pullRequestReviewContributions(last:$n){nodes{pullRequestReview{body comments(first:30){nodes{body}}}}}}
  }}`;
  let data;
  try {
    const raw = execFileSync('gh', ['api', 'graphql', '-F', `n=${Math.min(limit, 100)}`, '-f', `query=${query}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    data = JSON.parse(raw).data.viewer;
  } catch (e) {
    console.error(`gh api failed: ${e.message.split('\n')[0]}\nIs gh installed and logged in? (gh auth status)`);
    process.exit(1);
  }
  const texts = [
    ...data.issueComments.nodes.map((n) => n.body),
    ...data.pullRequests.nodes.map((n) => n.body),
    ...data.contributionsCollection.pullRequestReviewContributions.nodes.flatMap((n) => [
      n.pullRequestReview.body,
      ...n.pullRequestReview.comments.nodes.map((c) => c.body),
    ]),
  ].filter(Boolean);
  const r = saveSamples('github', texts, 'gh');
  console.log(`github: ${r.added} added, ${r.skipped} skipped (dupes, too short, or assistant-written)`);
}

function importGit(args) {
  const limit = Number(flag(args, '--limit', 300));
  const repo = args[0] || process.cwd();
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let email;
  try {
    email = git('config', 'user.email').trim();
  } catch {
    console.error(`no git user.email in ${repo}`);
    process.exit(1);
  }
  const log = git('log', `--author=${email}`, '--no-merges', `-n${limit}`, '--format=%B%x00');
  const texts = log.split('\0').map((s) => s.trim()).filter(Boolean);
  const r = saveSamples('commit', texts, `git:${path.basename(path.resolve(repo))}`);
  console.log(`commit: ${r.added} added, ${r.skipped} skipped (dupes, too short, or assistant-written)`);
}

function add(args) {
  const [context, file] = args;
  if (!context) {
    console.error('usage: voice.mjs add <context> [file|-]');
    process.exit(2);
  }
  const texts = readInput(file).split(/^\s*---\s*$/m);
  const r = saveSamples(context, texts, file && file !== '-' ? `file:${path.basename(file)}` : 'manual');
  console.log(`${context}: ${r.added} added, ${r.skipped} skipped`);
}

// Agents commit and comment under your account too. Their text is not your
// voice, and nothing marks it reliably, so this lets you cut it by pattern.
function prune(args) {
  const keep = flag(args, '--keep');
  const drop = flag(args, '--drop');
  const dry = args.includes('--dry-run');
  const context = args.find((a) => !a.startsWith('--'));
  if (!context || (!keep && !drop)) {
    console.error('usage: voice.mjs prune <context> (--keep <regex> | --drop <regex>) [--dry-run]');
    process.exit(2);
  }
  const file = path.join(SAMPLES, `${context}.jsonl`);
  const list = loadSamples(context);
  const keepRe = keep && new RegExp(keep, 'u');
  const dropRe = drop && new RegExp(drop, 'u');
  const kept = list.filter((s) => (!keepRe || keepRe.test(s.text)) && (!dropRe || !dropRe.test(s.text)));
  console.log(`${context}: keeping ${kept.length} of ${list.length}${dry ? ' (dry run)' : ''}`);
  if (dry) return;
  const lines = kept.map(({ context: _c, ...s }) => JSON.stringify(s));
  if (lines.length) fs.writeFileSync(file, lines.join('\n') + '\n');
  else fs.rmSync(file, { force: true });
}

// ---------- stats ----------

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const ratio = (n, d) => (d ? Math.round((n / d) * 100) / 100 : 0);
const EMOJI = /\p{Extended_Pictographic}/u;

function measure(samples) {
  const lens = [];
  const sentLens = [];
  let lowerStart = 0, endPeriod = 0, exclaim = 0, emoji = 0, bullets = 0, headings = 0;
  let emDash = 0, totalWords = 0, contractions = 0, expanded = 0;
  const openers = new Map();
  const closers = new Map();

  for (const { text } of samples) {
    const p = prose(text);
    const w = words(p);
    if (!w.length) continue;
    lens.push(w.length);
    totalWords += w.length;
    for (const s of p.split(/(?<=[.!?])\s+|\n+/)) {
      const n = words(s).length;
      if (n) sentLens.push(n);
    }
    const first = p.match(/\p{L}/u)?.[0];
    if (first && first === first.toLowerCase() && first !== first.toUpperCase()) lowerStart++;
    if (/\.\s*$/.test(p)) endPeriod++;
    if (p.includes('!')) exclaim++;
    if (EMOJI.test(p)) emoji++;
    if (/^\s*([-*•]|\d+\.)\s/m.test(text)) bullets++;
    if (/^#{1,6}\s/m.test(text)) headings++;
    emDash += (p.match(/—|(?<=\w) -- (?=\w)/g) || []).length;
    contractions += (p.match(/\b\w+(n['’]t|['’](re|ll|ve|m|d))\b/gi) || []).length;
    expanded += (p.match(/\b(do|does|did|is|are|was|were|can|could|would|should|will) not\b|\b(i am|it is|that is|we are|you are|they are)\b/gi) || []).length;

    const opener = w.slice(0, 2).join(' ').toLowerCase();
    openers.set(opener, (openers.get(opener) || 0) + 1);
    const lastLine = p.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    if (words(lastLine).length <= 4 && lastLine !== p.trim()) {
      const k = lastLine.toLowerCase();
      closers.set(k, (closers.get(k) || 0) + 1);
    }
  }

  const n = lens.length;
  lens.sort((a, b) => a - b);
  sentLens.sort((a, b) => a - b);
  const top = (m, min) =>
    [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${k} (${c})`);

  return {
    samples: n,
    words: { median: pct(lens, 0.5), p90: pct(lens, 0.9), max: lens[n - 1] || 0 },
    sentence_words_median: pct(sentLens, 0.5),
    lowercase_start: ratio(lowerStart, n),
    ends_with_period: ratio(endPeriod, n),
    has_exclamation: ratio(exclaim, n),
    has_emoji: ratio(emoji, n),
    uses_bullets: ratio(bullets, n),
    uses_headings: ratio(headings, n),
    em_dash_per_1k_words: totalWords ? Math.round((emDash / totalWords) * 10000) / 10 : 0,
    contraction_share: ratio(contractions, contractions + expanded),
    common_openers: top(openers, Math.max(2, Math.ceil(n * 0.05))),
    common_closers: top(closers, Math.max(2, Math.ceil(n * 0.05))),
  };
}

function stats() {
  const result = computeStats();
  if (!result) {
    console.error(`no samples in ${SAMPLES}. Run import-gh, import-git or add first.`);
    process.exit(1);
  }
  console.log(JSON.stringify({ dir: DIR, ...result }, null, 2));
}

// Writes rules.json and returns the numbers, without printing: the capture
// hook calls this, and a UserPromptSubmit hook's stdout ends up in Claude's context.
function computeStats() {
  const all = loadSamples();
  if (!all.length) return null;
  const byContext = {};
  for (const s of all) (byContext[s.context] ||= []).push(s);

  const contexts = {};
  for (const [ctx, list] of Object.entries(byContext)) contexts[ctx] = measure(list);
  const overall = measure(all);

  const corpus = all.map((s) => s.text.toLowerCase()).join('\n');
  const usedByYou = DEFAULT_BANNED.filter((ph) => corpus.includes(ph));

  const prev = loadRules() || {};
  const rules = {
    updated: new Date().toISOString(),
    overall,
    contexts,
    banned: DEFAULT_BANNED.filter((ph) => !usedByYou.includes(ph) && !(prev.allow || []).includes(ph)),
    allowed_because_you_use_them: usedByYou,
    // Hand-edit these two; they survive re-runs.
    extra_banned: prev.extra_banned || [],
    allow: prev.allow || [],
  };
  ensureDirs();
  fs.writeFileSync(RULES, JSON.stringify(rules, null, 2) + '\n');
  return { overall, contexts };
}

// ---------- config + prompt capture ----------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(c) {
  ensureDirs();
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n');
}

function captureEnabled() {
  const env = process.env.TALK_LIKE_ME_CAPTURE;
  if (env === 'off') return false;
  if (env === 'on') return true;
  return loadConfig().capture_prompts === true;
}

function config(args) {
  const [key, value] = args;
  if (key === 'capture') {
    if (!['on', 'off'].includes(value)) {
      console.error('usage: voice.mjs config capture on|off');
      process.exit(2);
    }
    const c = loadConfig();
    c.capture_prompts = value === 'on';
    saveConfig(c);
  } else if (key) {
    console.error(`unknown setting: ${key}`);
    process.exit(2);
  }
  const c = loadConfig();
  const n = loadSamples('chat').length;
  console.log(`capture_prompts: ${c.capture_prompts === true ? 'on' : 'off'}`);
  if (process.env.TALK_LIKE_ME_CAPTURE) console.log(`  (TALK_LIKE_ME_CAPTURE=${process.env.TALK_LIKE_ME_CAPTURE} overrides this)`);
  console.log(`chat samples: ${n}`);
  console.log(`config file: ${CONFIG}`);
}

// Keep only what the user typed themselves. Pasted logs, code and injected
// context aren't their voice.
function cleanPrompt(raw) {
  if (/^\s*[/!#]/.test(raw)) return null; // slash command, bash mode, memory shortcut
  const text = raw
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ') // <system-reminder>, <pasted_content>, ...
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (text.length > 1200 || text.split('\n').length > 12) return null; // probably pasted
  if (words(prose(text)).length < 3) return null;
  return text;
}

function capture() {
  try {
    if (!captureEnabled()) return;
    const evt = JSON.parse(fs.readFileSync(0, 'utf8'));
    const text = cleanPrompt(evt.prompt || '');
    if (!text) return;
    const { added } = saveSamples('chat', [text], 'prompt');
    if (!added) return;
    const c = loadConfig();
    c.captured_since_stats = (c.captured_since_stats || 0) + 1;
    if (c.captured_since_stats >= RESTATS_EVERY) {
      computeStats();
      c.captured_since_stats = 0;
    }
    saveConfig(c);
  } catch {
    // never get in the way of the user's prompt
  }
}

function show(args) {
  const n = Number(flag(args, '--n', 15));
  const ctx = args[0];
  const list = loadSamples(ctx);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  for (const s of list.slice(0, n)) console.log(`--- [${s.context}/${s.source}]\n${s.text}\n`);
  if (!list.length) console.log(`(no samples${ctx ? ` for ${ctx}` : ''})`);
}

// ---------- check ----------

function check(text, context) {
  const rules = loadRules();
  const p = prose(text);
  const lower = p.toLowerCase();
  const problems = [];

  for (const re of ATTRIBUTION) {
    if (re.test(text)) problems.push(`assistant attribution or marker: ${re.source}`);
  }

  const banned = rules ? [...rules.banned, ...rules.extra_banned] : DEFAULT_BANNED;
  for (const ph of banned) {
    if (lower.includes(ph.toLowerCase())) problems.push(`phrase you don't use: "${ph}"`);
  }

  // Style checks only where the user has their own samples for this exact
  // context, and never for commits: repos often have their own commit format
  // that agents must follow, and that outranks personal voice.
  if (rules && context !== 'commit') {
    const st = rules.contexts[context];
    if (st && st.samples >= 5) {
      const w = words(p).length;
      if (st.words.p90 && w > Math.max(st.words.p90 * 2, 40)) {
        problems.push(`${w} words; your ${context} messages are usually ${st.words.median} (90% under ${st.words.p90})`);
      }
      if (st.em_dash_per_1k_words === 0 && /—/.test(p)) {
        problems.push('em dash; none appear in your samples');
      }
      if (st.has_emoji === 0 && EMOJI.test(p)) problems.push('emoji; none appear in your samples');
      if (st.uses_headings === 0 && /^#{1,6}\s/m.test(text)) problems.push('markdown headings; you never use them here');
      if (st.uses_bullets < 0.05 && (text.match(/^\s*([-*•]|\d+\.)\s/gm) || []).length >= 3) {
        problems.push('bullet list; you rarely use them here');
      }
      if (st.has_exclamation === 0 && p.includes('!')) problems.push('exclamation mark; none in your samples');
    }
  }
  return problems;
}

function runCheck(args) {
  const [context = 'default', file] = args;
  const problems = check(readInput(file), context);
  if (!problems.length) {
    console.log('ok');
    return;
  }
  for (const pr of problems) console.log(`- ${pr}`);
  process.exitCode = 1;
}

// ---------- hook ----------

// Pull the outgoing text out of a shell command. Returns null when the command
// doesn't post anything under the user's name.
function textFromBash(cmd) {
  let context = null;
  if (/\bgit\s+commit\b/.test(cmd)) context = 'commit';
  else if (/\bgh\s+(pr|issue)\s+(comment|review|create|edit)\b|\bgh\s+api\b.*(comments|reviews)/.test(cmd)) context = 'github';
  if (!context) return null;

  const parts = [];
  for (const m of cmd.matchAll(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/g)) parts.push(m[2]);
  const str = String.raw`("(?:[^"\\]|\\.)*"|'[^']*')`;
  const flagRe = new RegExp(String.raw`(?:^|\s)(?:--body|-b|--message|-m|--title|-t|-f\s+body=|-F\s+body=)(?:\s+|=)?${str}`, 'g');
  for (const m of cmd.matchAll(flagRe)) {
    const v = m[1];
    if (v.startsWith('$(')) continue;
    parts.push(v.slice(1, -1).replace(/\\(["\\$`])/g, '$1').replace(/\\n/g, '\n'));
  }
  const fileM = cmd.match(/--body-file\s+(\S+)|(?:^|\s)-F\s+(?!body=)(\S+)/);
  if (fileM) {
    const f = (fileM[1] || fileM[2]).replace(/^['"]|['"]$/g, '');
    try {
      parts.push(fs.readFileSync(f, 'utf8'));
    } catch {
      // file may be created by an earlier part of the same command
    }
  }
  return parts.length ? { context, text: parts.join('\n\n') } : null;
}

function textFromMcp(tool, input) {
  const name = tool.toLowerCase();
  const context = /slack|discord|teams|chat/.test(name) ? 'slack' : /mail|gmail|outlook/.test(name) ? 'email' : /github|gitlab|linear|jira/.test(name) ? 'github' : 'default';
  const keys = ['body', 'text', 'message', 'content', 'comment', 'markdown', 'description', 'subject', 'title'];
  const parts = [];
  const walk = (v, k) => {
    if (typeof v === 'string' && keys.includes(String(k).toLowerCase()) && v.trim().length > 0) parts.push(v);
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(input, '');
  return parts.length ? { context, text: parts.join('\n\n') } : null;
}

function hook() {
  if (process.env.TALK_LIKE_ME_HOOK === 'off') return;
  let evt;
  try {
    evt = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const tool = evt.tool_name || '';
  const found = tool === 'Bash' ? textFromBash(evt.tool_input?.command || '') : textFromMcp(tool, evt.tool_input || {});
  if (!found) return;

  const problems = check(found.text, found.context);
  if (!problems.length) return;

  // If Claude resubmits the exact same text after a block, the user asked for it
  // as-is. Let it through instead of looping.
  const seenFile = path.join(os.tmpdir(), 'talk-like-me-blocked.json');
  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
  } catch {}
  const h = hash(found.text);
  if (seen[h]) return;
  seen[h] = Date.now();
  for (const [k, t] of Object.entries(seen)) if (Date.now() - t > 3600_000) delete seen[k];
  try {
    fs.writeFileSync(seenFile, JSON.stringify(seen));
  } catch {}

  const reason =
    `talk-like-me: this ${found.context} text goes out under the user's name but doesn't sound like them:\n` +
    problems.map((p) => `- ${p}`).join('\n') +
    `\nRewrite it in their voice (see ~/.claude/talk-like-me/profile.md) and try again. ` +
    `If the user asked for this exact wording, resend it unchanged and it will go through.`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  );
}

// ---------- main ----------

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  'import-gh': () => importGh(args),
  'import-git': () => importGit(args),
  add: () => add(args),
  prune: () => prune(args),
  stats,
  show: () => show(args),
  check: () => runCheck(args),
  config: () => config(args),
  hook,
  capture,
};
if (!commands[cmd]) {
  console.error('usage: voice.mjs <import-gh|import-git|add|prune|stats|show|check|config|hook|capture> ...');
  process.exit(2);
}
commands[cmd]();
