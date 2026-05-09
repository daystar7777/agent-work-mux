# AgentWorkMux Protocol v3 - Multi-LLM Collaboration Rules

> Applies to every AI agent invoked on this project, regardless of model
> or vendor. Read this before acting on any user request.

Language policy: this protocol and other installed instruction templates are
English-only. Preserve user-provided text verbatim in `PROMPT` events and
handoffs, but do not translate protocol templates or shared-memory structure
unless the user explicitly asks for a separate human-facing translation.

---

## Core rules

### 1. AIMemory is the home of all AI-authored markdown

Every markdown file you author lives under `AIMemory/`.

Exceptions - files that specific harnesses load from fixed paths
(e.g. Claude Code reads `CLAUDE.md` from project root). If your harness has
such a file, it stays where the harness expects it.

Everything else - notes, plans, reviews, scratch, design docs, analyses - goes
in `AIMemory/`.

### 1.1 Install lifecycle metadata

Each installed project SHOULD have `AIMemory/INSTALLATION.md`. This file is
small, safe-to-read metadata about the protocol installation:

- `installer_version` - commit SHA or source URL of the bootstrap prompt used
- `bootstrapped_at` - ISO-8601 timestamp
- `bootstrapped_by` - `<model-id> @ <harness>`
- `protocol_version` - for this document, `v3`
- `harness_files_modified` - managed reminder blocks, each with
  `{path, format, sentinel_hash, line_range}`
- `runner_declaration` - optional; empty unless a lazy runner has been set up
- `reinstall_history` - append-only reinstall/upgrade records

Managed reminder blocks use sentinel tokens so uninstall can remove only the
text AgentWorkMux owns:

```text
<!-- agent-work-mux:start sha256=<hash> -->
<managed reminder text>
<!-- agent-work-mux:end -->
```

For non-markdown files, use the native comment delimiter for that file format
but keep the same `agent-work-mux:start` and `agent-work-mux:end` tokens.
Uninstall may also recognize legacy `agent-work-mem:*` sentinel tokens from
pre-rename installations.

The `sha256` value is the SHA-256 hash of the managed reminder text only,
excluding the sentinel lines. Automated installers MUST update
`INSTALLATION.md` by explicit field or table section, not by broad global
replacement; the `Harness files modified` and `Reinstall history` tables have
different meanings.

Do not put secrets, credentials, auth tokens, or private machine paths in
`INSTALLATION.md`. If a runner or harness needs private paths, put them in
`.agent-work-mux/` or environment variables, not in git-tracked files.

### 2. work.log is the shared memory

`AIMemory/work.log` is an append-only event log. Every AI MUST append the
following events:

- **PROMPT** - the user's message, verbatim, in a `> ` blockquote
- **WORK_START** - when you begin acting; include a one-line task summary
- **FILES_CREATED / FILES_MODIFIED / FILES_MOVED / FILES_DELETED** - full
  absolute paths whenever you touch the filesystem
- **WORK_END** - when finished; include status (complete / blocked / partial)
- **NOTE** - assumptions, uncertainties, open questions for next agent
- **HANDOFF / HANDOFF_RECEIVED / HANDOFF_CLOSED** - see AICP below
- **PROJECT_BOOTSTRAPPED / RE_ENGAGED** - session start markers; include
  the agent's capabilities (see Section 9 below)
- **UNINSTALLED / RE_INSTALLED** - lifecycle markers for detach and reuse
- **GOAL_CREATED / GOAL_UPDATED / GOAL_COMPLETED** - `/awm goal` markers
- **RUNNER_RESULT** - compact runner result; raw runner output stays outside
  the main agent context

Event format:

```
### YYYY-MM-DD HH:MM | <your-model-id> | <EVENT>
<body, free-form>
```

### 3. Read work.log before working - every new turn

At session start, AND at the start of any new user request after a long idle:

1. Read the tail of `AIMemory/work.log` (last ~50 lines is enough)
2. Look for any `WORK_START` without a matching `WORK_END`
3. If found, ASK the user: "Previous session has an unfinished task: <one-line
   summary>. Resume, or start fresh?" before doing anything else

This is a HARD RULE. Skipping it risks clobbering another AI's in-flight work.

### 4. Model name in every filename you create

Files you author must carry your model identifier:

```
AIMemory/{slug}.{your-model-id}.md
```

Examples:
- `refactor-plan.claude-opus-4-5.md`
- `auth-review.gpt-5-codex.md`
- `data-schema.gemini-2-5-pro.md`

If multiple agents edit the same document, the **originator's** model-id
stays in the filename; subsequent editors note their contribution in
`work.log`, not in the filename.

### 5. One agent owns work.log writes during multi-agent work

When multiple agents run in parallel (e.g. one orchestrator firing several
sub-tasks), only the **orchestrator** writes to `work.log`. Sub-agents
return their results to the orchestrator; they do not touch the log.

If two orchestrators run in parallel (rare), each records in its own dated
block and includes a `HANDOFF` event when work transitions between them.

### 6. Race-free append discipline (CRITICAL for multi-LLM)

`work.log` is a shared file. When two LLMs (different sessions, possibly
different machines) write at the same time, naive writes lose data.
Apply the following tiered discipline.

#### 6.1 Baseline - required for every agent, every append

**Rule A - single atomic append per event.** Use ONE shell call (heredoc
to `>>`) per event. POSIX `O_APPEND` guarantees that appends <=4096 bytes
are atomic on local filesystems, so concurrent agents on the same machine
won't interleave bytes:

```bash
cat >> AIMemory/work.log <<'EOF'

### YYYY-MM-DD HH:MM | <model-id> | <EVENT>
<body>
EOF
```

DO NOT split a single event across multiple appends. DO NOT use a
high-level "edit file" tool that performs read-modify-write - that
pattern races even when both agents are well-behaved.

**Rule B - keep events under 4 KB.** If your message body is longer than
~3000 chars, split: write a short event in `work.log` and put the bulk
in a separate `AIMemory/<slug>.<model-id>.md` file. The work.log entry
just links to it.

**Rule C - never edit-in-place.** Never open `work.log`, modify, save.
Append-only. If you must correct an earlier entry, append a NEW event
of type `CORRECTION` referencing the original timestamp.

**Rule D - read tail right before write.** When you're about to append,
read the last ~20 lines first. If you see another agent's `WORK_START`
within the last 5 minutes without a matching `WORK_END`, that agent is
likely active. Append a `NOTE` BEFORE your own event flagging concurrent
work (so the human reader can spot interleavings):

```
### HH:MM | <my-model> | NOTE
Concurrent work detected - <other-model>'s WORK_START at HH:MM is still
open. My events below may interleave with theirs.
```

#### 6.2 Strong lock - recommended when truly concurrent

If your shell has `flock` (Linux, macOS, git-bash on Windows), wrap
appends in an exclusive lock. This serializes appends across processes
on the same machine, eliminating same-machine race entirely:

```bash
flock AIMemory/work.log -c "cat >> AIMemory/work.log <<'EOF'

### YYYY-MM-DD HH:MM | <model-id> | <EVENT>
<body>
EOF"
```

If `flock` is not available (Windows cmd/PowerShell without git-bash),
fall back to the baseline rules - same-machine atomicity from `O_APPEND`
covers the common case.

#### 6.3 Cloud-synced AIMemory - switch to per-session files

If `AIMemory/` lives on Dropbox / iCloud / Google Drive / OneDrive (i.e.
synced across multiple machines), `work.log` will produce conflicted
copies (`work.log (conflict 2026-04-26).log` etc.) when two machines
write before sync converges. POSIX atomicity does not help here; the
race is at the sync layer.

**Mitigation - per-session log files.** Each session writes to its OWN
file under `AIMemory/sessions/`:

```
AIMemory/
  work.log                  # legacy / index (optional, mostly empty)
  sessions/
    2026-04-26T14-30__claude-opus-4-5__claude-code.log
    2026-04-26T14-32__gpt-5-codex__chatgpt-codex-cli.log
    2026-04-26T15-10__gemini-2-5-pro__antigravity.log
```

Naming: `<UTC ISO8601 sortable>__<model-id>__<harness>.log`

Each session file is exclusively owned by ONE session, with zero contention
even across machines, because no two sessions ever write the same path.

When READING the project history, agents merge all `AIMemory/sessions/*.log`
files sorted by timestamp:

```bash
# tail of merged view
cat AIMemory/sessions/*.log | grep -E '^### ' | sort | tail -50
# or with bodies:
ls -1 AIMemory/sessions/*.log | xargs -I{} sh -c 'cat {}; echo'
```

The legacy `AIMemory/work.log` may still exist as a manually curated
digest, but it is no longer the primary write target.

How to know if you're in this mode: look for `AIMemory/sessions/` -
if the directory exists, use it. If not, you're in shared-`work.log`
mode (default for local-only projects).

#### 6.4 Decision matrix - quick reference

| Setup                                             | Mode                  |
|---------------------------------------------------|-----------------------|
| Local project, single agent at a time             | shared work.log + 6.1 |
| Local project, occasionally 2+ agents same machine| shared work.log + 6.2 |
| Project on Dropbox/iCloud/Drive, multi-machine    | per-session files 6.3 |
| Git-versioned AIMemory, manual merge OK           | shared work.log + 6.1 |

If unsure - start with shared work.log + 6.1. Migrate to 6.3 the first
time you see a conflict file.

### 7. Tiered storage - keep context small

After a few days of multi-agent use, `work.log` + handoff files + scratch
notes accumulate. Reading the whole pile on every session burns LLM
context for no benefit. Tiered storage separates recent-and-relevant
(always read) from older-and-rarely-needed (lazy-load).

#### 7.1 The three tiers

- **Hot** -`AIMemory/work.log`. The N most recent events. Every new
  session reads this in full.
- **Warm** -`AIMemory/archive/work-<YYYY-MM-DD>.log`. Older events
  grouped by UTC date. Read only when the user's request reaches into
  history older than the hot tier covers.
- **Cold** -`AIMemory/cold/digest-<period>.md`. Multi-week or
  multi-month summaries. Fetch only on explicit need.

#### 7.2 INDEX.md - read this FIRST every session

`AIMemory/INDEX.md` is the directory's table of contents AND search index.
It's small and cheap to load. It tells you:
- which warm archives exist and what each contains (so you skip irrelevant ones)
- a flat **topic index** mapping keywords to the files that cover them
  (so you can `grep` for a topic instead of reading anything)

Required sections of INDEX.md:

```markdown
# AIMemory Index

## Configuration
- HOT_RETENTION_EVENTS: 50

## Hot - read every session
- work.log - last N events, append-only
- INSTALLATION.md - small install/reinstall metadata
- AGENTS.md - project-scoped safe aliases and routing policy
- goals/ACTIVE.md - active `/awm` goal cursor; read before resuming goal work
- goals/ - goal contracts and compact results only when relevant

## Warm - read only when needed
| File | Date range | Events | Topics | Summary |
|------|------------|--------|--------|---------|
| archive/work-2026-04-26.log | 2026-04-26 | 87 | auth, jwt, refresh-tokens, toctou-race | JWT auth implementation; TOCTOU race in refresh-rotation found by gpt-5-codex review, fixed via SELECT FOR UPDATE. |
| archive/work-2026-04-25.log | 2026-04-25 | 23 | bootstrap, obsidian, project-setup | Initial project bootstrap, Obsidian vault opened. |

## Cold - fetch only on explicit need
| File | Period covered | Topics | Summary |
|------|----------------|--------|---------|
| cold/digest-2026-03.md | 2026-03 | foo, bar, baz | One-paragraph summary for the whole month. |

## Topic index - grep me
auth          -> archive/work-2026-04-26.log
jwt           -> archive/work-2026-04-26.log
refresh-tokens -> archive/work-2026-04-26.log
toctou-race   -> archive/work-2026-04-26.log
bootstrap     -> archive/work-2026-04-25.log
obsidian      -> archive/work-2026-04-25.log

## Active handoffs (open AICP threads)
- handoff_perf.gemini-2-5-pro.md - to claude-opus, NORMAL

## Active goals
- goals/ACTIVE.md -> current goal: auth-hardening-20260507, state active
- goals/INDEX.md -> lazy goal history ledger for `/awm goal list`
- goals/auth-hardening-20260507.md -> active, auto-run true, policy implement_then_verify

## Other notable files
- PROJECT_OVERVIEW.md - onboarding primer (read after INDEX.md)
- session-checkpoint-2026-04-26.claude-opus-4-7.md - major checkpoint
- runner.md / RUNNER.md - lazy runner spec; read only for explicit `/awm`
- goals/INDEX.md - lazy goal history ledger; read for `/awm goal list`

---
Last update: 2026-04-26 22:30 by claude-opus-4-7
```

How agents use the topic index:

```bash
# user asks: "did we ever discuss auth?"
grep -i "auth" AIMemory/INDEX.md
# -> archive/work-2026-04-26.log appears in the topic index
# load only that file; skip the rest.
```

**Maintaining topics**: when an agent rotates events to an archive, it
extracts 3-7 topic keywords (kebab-case, lowercase) summarizing what
the archived events covered, and updates both:
1. The Warm table's `Topics` column for that archive
2. The flat Topic index (one line per topic -> file mapping)

If a new archive covers a topic that already exists, append the new
file to the existing topic line:

```
auth -> archive/work-2026-04-26.log, archive/work-2026-05-12.log
```

Don't be precious about topic granularity - over-tagging is fine,
under-tagging hurts findability.

#### 7.3 Configuration (user-tunable)

The user controls the rotation threshold via `HOT_RETENTION_EVENTS`
in INDEX.md. Recommended defaults:

| Project type                       | HOT_RETENTION_EVENTS |
|------------------------------------|----------------------|
| Active multi-agent (3+ agents/day) | 30                   |
| Standard (default)                 | 50                   |
| Long-running solo                  | 100                  |

If unset, agents default to 50.

#### 7.4 When to rotate

At WORK_START, count current events. If over threshold x1.5, rotate.
The 1.5x hysteresis avoids thrashing on every single event.

```bash
EVENT_COUNT=$(grep -c '^### ' AIMemory/work.log)
THRESHOLD=$(grep '^- HOT_RETENTION_EVENTS:' AIMemory/INDEX.md 2>/dev/null \
  | awk -F: '{print $2}' | tr -d ' ')
[ -z "$THRESHOLD" ] && THRESHOLD=50

if [ "$EVENT_COUNT" -gt $((THRESHOLD * 3 / 2)) ]; then
   # rotate (see Section 7.5)
fi
```

#### 7.5 Rotation algorithm

This is the one place where the protocol modifies (not appends to)
`work.log`. Treat it as a single atomic maintenance operation.

1. **Acquire lock** (use flock if available; else verify no orphan
   `WORK_START` from another agent):
   ```bash
   exec 9>AIMemory/.rotation.lock
   flock -n 9 || { echo "rotation in progress, skipping"; exit 0; }
   ```
2. Read all events from `work.log`.
3. Keep the most recent THRESHOLD events. The rest get archived.
4. For each archived event, append to
   `AIMemory/archive/work-<UTC-date-from-event-timestamp>.log`. Group
   by date.
5. **Atomically replace** `work.log` with the kept events:
   ```bash
   # write kept-events to a temp file, then rename:
   mv AIMemory/work.log.new AIMemory/work.log
   ```
6. **Update INDEX.md**: add or refresh the row in the warm table for
   each archive file you wrote to (event count, date range, one-line
   summary).
7. Append a NOTE event in the (now small) `work.log`:
   ```
   ### YYYY-MM-DD HH:MM | <model-id> | NOTE
   Rotated <N> events to AIMemory/archive/. Hot kept at <THRESHOLD>.
   ```
8. Release lock.

If you cannot rotate safely (concurrent agent active, no flock), append
a NOTE flagging "rotation needed" and let a future single-agent
session do it. Don't half-rotate.

#### 7.6 Cold digesting + PROJECT_OVERVIEW maintenance

Cold digests are heavy - they read and summarize many archive files.
Don't do this automatically. Trigger only on:
- Explicit user request ("digest last month into cold")
- Archive directory > 1 year old or > 100 files

Cold digest naming: `AIMemory/cold/digest-<YYYY-MM>.md` (monthly) or
`AIMemory/cold/digest-<YYYY-Wnn>.md` (weekly).

Each cold digest must contain:

```markdown
# Cold digest - <period>

**Period covered**: YYYY-MM-DD - YYYY-MM-DD
**Source archives**: archive/work-YYYY-MM-DD.log, ...
**Distilled by**: <model-id> on YYYY-MM-DD

## What happened (chronological)
<3-10 bullets, each one decision or major work item with date>

## Decisions locked in
<list of decisions that future sessions should NOT revisit>

## Open questions / unresolved
<anything still hanging from this period>

## Topics
<comma-separated keywords for INDEX.md topic index>
```

**After writing a cold digest, ALWAYS update:**
1. INDEX.md - add the digest to the Cold table; update Topic index
2. **PROJECT_OVERVIEW.md** - re-merge new "Decisions locked in" + major
   work into the running overview (see Section 7.8)

You may compress or delete the underlying archives that the digest
covers - but ONLY with explicit user approval. Default: keep them
("cold" doesn't mean deleted).

#### 7.7 Reading discipline (every new session)

Read in this order, stopping when you have enough context:

1. **INDEX.md** (always - small, free; tells you what exists + topic search)
2. **PROJECT_OVERVIEW.md** if it exists (always - small project primer)
3. **work.log tail** ~50 lines (always)
4. Active handoffs listed in INDEX (if relevant to current request)
5. Specific warm archive - only after grepping INDEX's Topic index;
   load the matched file(s) only
6. Cold digest - only on explicit user request

Lazy-load. Don't pre-fetch warm/cold "just in case". Use the Topic
index in INDEX.md to find what's relevant before opening anything.

#### 7.8 PROJECT_OVERVIEW.md - onboarding primer for new sessions/LLMs

`AIMemory/PROJECT_OVERVIEW.md` is a 1-screen briefing for any LLM
joining the project (whether a brand-new session or a different vendor's
agent stepping in). It answers: "what is this project, what's been
decided, what's still in motion?"

It is **derived** from `work.log` + cold digests, not authored from
scratch. It is rebuilt/extended whenever a cold digest is created.

Required structure:

```markdown
# Project Overview

> Onboarding for new LLMs joining this project. Read this AFTER
> AIMemory/INDEX.md (which tells you what files exist) and BEFORE
> AIMemory/work.log tail (which tells you what's happening right now).

## What is this project?
<2- sentences. What it does, who uses it, why it exists.>

## Tech stack
- <bullets of major techs>

## Key decisions locked in
- <decision 1> (YYYY-MM-DD, <model-id>) - <one-line rationale>
- <decision 2> ...

## Major work completed
- <YYYY-MM-DD>: <what shipped or finished>
- ...

## Active concerns
- <what's currently being worked on or blocked>

## Where to look
- Recent activity -> AIMemory/work.log
- Topic-based history -> AIMemory/INDEX.md (Topic index section)
- Active goal cursor -> AIMemory/goals/ACTIVE.md
- Goal records -> AIMemory/goals/
- Agent aliases -> AIMemory/AGENTS.md
- Long-term history -> AIMemory/cold/digest-*.md

---
Last rebuild: YYYY-MM-DD by <model-id>
Source: cold/digest-* + open work.log + active handoffs
```

**When to rebuild**:
- After writing any cold digest (mandatory - the digest's "Decisions
  locked in" + "What happened" must propagate up)
- On user request ("regenerate the overview")
- When a major architectural decision is made (optional - adding it to
  PROJECT_OVERVIEW now saves a future session from having to dig)

**Don't over-edit**: this is a derived view. Single-line changes that
parrot a recent work.log event don't belong here. PROJECT_OVERVIEW is
for things a new LLM MUST know to be productive - small enough to
read in 60 seconds.

---

## 8. Why these rules exist

- **Continuity across sessions**: AI sessions are stateless. `work.log` is
  the persistence layer that lets a new session pick up where the last
  one stopped - sometimes minutes, sometimes weeks later.
- **Cross-model collaboration**: each model has different strengths,
  tool access, and context windows. `work.log` is the shared blackboard;
  model-named filenames + capability declarations let everyone see who
  authored what and what they could do at the time.
- **Conflict avoidance**: parallel writes to the same log file produce
  silent corruption. Designating one owner per logical agent team
  prevents interleaved events.

---

## 9. Per-LLM type - capability declaration

`<model-id>` in event headers is the type tag. But model-ids are opaque to
future readers (human or other AI). To make the log self-describing, every
session-start event MUST also declare capabilities using a **vendor-neutral
vocabulary** so any LLM can read and act on them.

### Tier classification (one of three)

| Tier | Means |
|------|-------|
| A    | Filesystem read+write AND shell exec on user's project |
| B    | Sandbox interpreter only - cannot touch user's files |
| C    | Chat only - no tools |

### Generic capability tags (use these, NOT vendor tool names)

- `filesystem-read`, `filesystem-write`, `shell-exec`
- `code-sandbox`
- `web-fetch`, `web-search`
- `image-input`, `image-output`, `multimodal-video`, `audio`

Do NOT write `Bash`, `Read`, `Edit`, `FileCreate`, `Browser`, `python` -
those are vendor-specific and confusing cross-team. Map your actual tools
to the generic tags above.

### Required body for `PROJECT_BOOTSTRAPPED` and `RE_ENGAGED`

```
### YYYY-MM-DD HH:MM | <model-id> | <PROJECT_BOOTSTRAPPED|RE_ENGAGED>
Tier: <A | B | C>
Vendor: <Anthropic | OpenAI | Google | xAI | Mistral | DeepSeek | Meta | other>
Capabilities: <comma-separated generic tags from the list above>
Strengths: <1 line>
Context: <token budget or "unknown">
Harness: <Claude Code | Aider | ChatGPT-tools | Continue | Web chat | mobile | API direct | unknown>
Notes: <anything relevant - e.g. "preview model", "no internet", "Korean UI">
```

### Optional capability tag in WORK_START

If a task depends on a specific capability:

```
### YYYY-MM-DD HH:MM | <model-id> | WORK_START
Task: <one-liner>
Capability used: <e.g. web-search, code-sandbox, image-input>
```

This lets the next session know "the previous agent had `web-search`; I
don't - I should hand off if I need to verify a URL."

### Known LLM types - quick reference

A non-exhaustive registry. Add to it as new models appear (via NOTE event).

| model-id pattern              | Vendor    | Typical strengths                              |
|-------------------------------|-----------|------------------------------------------------|
| `claude-opus-*`               | Anthropic | long-context reasoning, code synthesis, refactors |
| `claude-sonnet-*`             | Anthropic | balanced speed/quality, daily driver           |
| `claude-haiku-*`              | Anthropic | fast searches, simple edits                    |
| `gpt-5-*`, `gpt-4o-*`         | OpenAI    | general reasoning, code interpreter            |
| `gpt-5-codex`, `o3-mini`      | OpenAI    | tight code completion, agentic coding          |
| `gemini-2-5-pro`              | Google    | long-context, multimodal, Google search        |
| `gemini-2-5-flash`            | Google    | fast multimodal                                |
| `grok-*`                      | xAI       | real-time web, irreverent                      |
| `qwen-*`, `deepseek-*`        | various   | open-weight code models                        |
| `antigravity`, `codex-gpt-*`  | (custom)  | use whatever vendor reports                    |

When a session uses a model not on this list, just declare its capabilities
in the bootstrap event - readers will infer.

---

# Part II - Lifecycle and `/awm` Orchestration (v3)

v3 keeps the base protocol markdown-first. Normal sessions read only
`INDEX.md`, `PROJECT_OVERVIEW.md`, and recent log state. Runner details are
lazy-loaded only when the user invokes an explicit `/awm` command that needs
them.

## Lifecycle events

`PROJECT_BOOTSTRAPPED` opens an installation lifecycle. `UNINSTALLED` detaches
AgentWorkMux behavior from harness reminder files while preserving
`AIMemory/`. `RE_INSTALLED` records a later bootstrap that reused existing
memory.

Required `UNINSTALLED` body:

```text
Files removed: <paths or none>
Files preserved: AIMemory/ preserved; <other paths>
Sentinel hashes removed: <hashes or fallback mode>
Reason: <user request | reinstall | migration | other>
```

Required `RE_INSTALLED` body:

```text
Previous installer version: <sha/url/unknown>
New installer version: <sha/url/unknown>
Schema delta summary: <one line>
AIMemory state: <reused | rebuilt | partial>
```

Uninstall default mode is **detach**: remove managed harness reminder blocks
only when their sentinel hash still matches, preserve `AIMemory/`, and remove
`.agent-work-mux/` only after explicit user opt-in. If
`AIMemory/INSTALLATION.md` is absent, uninstall MAY use a conservative
heuristic that removes only canonical sentinel blocks and logs that fallback.

## Lazy legacy migration

`agent-work-mem` is deprecated. Legacy migration is not part of the normal
session context. If an installer or setup flow detects legacy `agent-work-mem`
markers, it MUST lazy-load `migration.md` and run that one-time migration flow.

Migration preserves `AIMemory/` and must not append a duplicate
`PROJECT_BOOTSTRAPPED`. It replaces only safely bounded legacy reminder blocks,
creates missing v3 metadata such as `AIMemory/goals/ACTIVE.md`, appends one
`RE_INSTALLED` lifecycle event, and leaves `.agent-work-mem/` in place unless
the user explicitly opts into removing local legacy state.

## `/awm` command namespace

`/awm` is the canonical command namespace. New goal orchestration MUST use an
explicit goal command form: `/awm goal <request>` or `/awm goals <request>`.
Every other AWM command may also be invoked through a clear natural-language
request, for example asking to set up AgentWorkMux, list agents, register a
worker, test agents, show hints, uninstall, run a named non-goal task, or
create a manual handoff.

Supported command contract:

```text
/awm setup
/awm agents
/awm agents list
/awm agents add <description> [--as <alias>] [--selector <agent[:model-or-tier[:profile]]>] [--capabilities <tags>]
/awm agent add <alias> <selector-or-description> [--capabilities <tags>]
/awm agent refresh <alias>
/awm agents test [--all | <agent-selector>] [--smoke] [--live]
/awm agents hints [agent-selector]
/awm goal <goal request> [--policy <policy>] [--with <agents>]
/awm goals [<goal request>] [--policy <policy>] [--with <agents>]
/awm goal list [--state <state>] [--limit <n>]
/awm goal history [goal-id] [--limit <n>]
/awm goal status [goal-id]
/awm goal pause <goal-id>
/awm goal resume <goal-id>
/awm goal stop <goal-id>
/awm goal clear [--completed | --stopped | --all]
/awm run <task> [agent-selector]
/awm handoff <target-agent> <task>
/awm uninstall
```

`/awm setup` creates or updates `AIMemory/INSTALLATION.md`,
`AIMemory/AGENTS.md`, and `AIMemory/goals/`. It may create a short
`AIMemory/RUNNER.md` pointer only when the project opts into runner use.
Setup must keep project-safe routing in AIMemory and ask before writing any
private local override under `.agent-work-mux/`. It does not authorize worker
dispatch by itself.

Runner helper code is markdown-sourced and lazy-materialized. Canonical helper
bodies live in tracked `*.js.md` markdown helper specs, for example
`helpers/awm-launch.js.md` and `helpers/awm-watch.js.md`, rather than in bare
executable source files. The `js.md` suffix marks the tracked script-spec
markdown source; it does not require the generated helper to be JavaScript. Each
helper spec includes generation notes, OS/runtime differences, validation rules,
and extractable OS-specific code blocks. Setup/probe/runner onboarding may
extract OS/runtime-appropriate helpers into ignored `.agent-work-mux/bin/`
files, write a local helper manifest with source hashes, and self-test those
helpers. Generated helper files are stable local runtime artifacts, not project
source. Do not modify normal goal prompts to regenerate helpers after they have
been created. If a helper is missing or stale, run explicit helper
onboarding/setup before dispatch.

`/awm agents` and `/awm agents list` read `AIMemory/AGENTS.md` and print the
registered aliases plus the latest compact call hints. Natural language such
as "registered agents 보여줘" maps here without testing or dispatching workers.

`/awm agents add` and singular `/awm agent add` register project-scoped aliases
in `AIMemory/AGENTS.md`. The plural form may infer the alias from a
description. The singular form treats the first argument after `add` as the
alias. Registration should also ensure helper materialization has run and create
the alias launch prototype, or mark the alias `helper_onboarding_required` /
`launch_profile_missing`. For example, `/awm agents add 오픈코드의 딥시크` normalizes to
`opencode-deepseek -> opencode:deepseek:auto`, while both
`/awm agent add 딥시크 오픈코드:딥시크` and
`/awm agent add 딥시크 오픈코드의 딥시크` normalize to
`딥시크 -> opencode:deepseek:auto`. The command updates routing metadata and
creates local helper/launch prototypes, but it must not claim the worker is
callable until `/awm agents test <alias> --smoke` passes and must not dispatch
the worker during registration unless the user explicitly requested a live test.

`/awm agent refresh <alias>` is the explicit command for regenerating an existing
alias's launch prototype. A controller must ask the user to run this or another
explicit setup/probe command when helpers or launch profiles are stale; it must
not silently refresh them during `/awm goal`.

`/awm agents test` lazy-loads `agent-call-probe.md` and verifies configured
worker invocations before real goal dispatch. It stores raw probe logs in
ignored `.agent-work-mux/probes/`, writes compact non-secret call hints to
`AIMemory/AGENTS.md`, and writes local/private command details to
`.agent-work-mux/agents.local.md`. Guarded CLIs such as Codex CLI, Claude CLI,
and Gemini CLI are check-only by default: verify version and non-prompt auth
state where available, but do not send live prompts unless the user explicitly
asks for actual execution or uses `--live`. This avoids recursive same-family
calls such as Codex invoking Codex CLI, Claude invoking Claude CLI, or
Antigravity/Gemini invoking Gemini CLI by default. Re-run the probe when an
agent CLI version changes. `/awm agents hints` reads existing hints without
calling agents.

When live/smoke probing is authorized, the probe must verify the runner contract
as well as the text response: generated launcher/watch helpers work, runner-owned
directories are precreated, the external agent can write a skeleton capsule into
an existing directory using same-directory temp+rename, and missing or malformed
capsules are classified without raw-log inspection.

Known default smoke surfaces include OpenCode `opencode run --format json`,
Continue CLI `cn --readonly -p ... --format json` and `cn serve --port <port>`,
and Aider `aider --message ...`. Guarded live surfaces include Codex `codex
exec --json`, Claude Code `claude -p ... --output-format json`, and Gemini CLI
`gemini --prompt ... --approval-mode plan --output-format json`; keep them at
`guarded_check_only` unless the user explicitly requests a live run. Prefer
safe planning or read-only modes when a tool provides them. Classify editor
launchers such as Antigravity `chat` and Cursor `--chat` as `gui_only` unless
they return a machine-readable stdout stream or result file. For Continue with
DeepSeek, any
working Continue secret setup is acceptable; if local env fallback returns a
DeepSeek 401, use an explicit local config secret reference such as
`apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}`.

Natural language command routing MUST NOT turn a broad project objective into
a new goal. If the user asks for goal-level orchestration without `/awm goal`
or `/awm goals`, ask them to use one of those explicit goal forms. Natural
language can still route safe management commands and explicit non-goal worker
requests, while guarded CLI live-run rules remain in force. If intent is
ambiguous, ask a short confirmation or provide a dry-run plan.

New goal creation accepts either a quoted request or an unquoted shorthand.
Parse `/awm goal` by checking the first token after `goal`. Parse `/awm goals`
the same way, except bare `/awm goals` with no request maps to
`/awm goal list`:

- If the first token is `list`, `history`, `status`, `pause`, `resume`,
  `stop`, or `clear`, treat it as the reserved subcommand.
- If the first token is quoted, treat the quoted string as the goal request.
- If the first token is unquoted and not reserved, treat the remaining
  command text as a new goal request, while still recognizing trailing runner
  flags such as `--policy` and `--with`.
- If a new goal request intentionally starts with a reserved word, require
  quotes: `/awm goal "list flaky tests and fix them"`.
- If the request text itself contains option-like tokens that should not be
  parsed as flags, recommend quotes.

Legacy aliases MAY be supported:

```text
/awm goals            -> /awm goal list
/awm goals <request>  -> /awm goal <request>
/awm status --all     -> /awm goal list
/awm status <goal-id> -> /awm goal status <goal-id>
/awm pause <goal-id>  -> /awm goal pause <goal-id>
/awm resume <goal-id> -> /awm goal resume <goal-id>
```

`/awm goal` creates a goal contract and defaults to auto-run after parsing and
planning. The user can pause or stop from the active orchestrator session.
Before the first worker launch, the controller must show a compact dispatch
preview: objective, output root, design summary, phase list, phase-by-phase
worker/verifier assignment, quality gates, capsule paths, timeout policy, and
controller/verifier role boundary. This preview is the last visible checkpoint
before auto-run continues; it is not an approval gate unless the user requested
approval mode, the plan is ambiguous, or the user interrupts and revises it.
Goal files live under `AIMemory/goals/<goal-id>.md` and store compact state,
tasks, results, errors, telemetry, and completion guard status, not verbose
transcripts. `AIMemory/goals/ACTIVE.md` is the active goal cursor: it points to
the current goal, state, last completed task, next checkpoint, raw-log root, and
final-report status. The orchestrator writes one integrated final report when
the goal completes.

`AIMemory/goals/INDEX.md` is the lazy-read goal history ledger. It lists current
and previous goals with objective, state, created/updated/completed timestamps,
orchestrator, policy, quality score, worker/orchestrator token and cost
telemetry when available, final report path, and goal record path. Normal
sessions do not need to load it unless the user
asks for historical goal status or invokes `/awm goal list` /
`/awm status --all`.

Dynamic goal mechanics:

1. **Active goal cursor** - read `AIMemory/goals/ACTIVE.md` before resuming
   goal work; update it after every task result or state transition.
2. **Goal history ledger** - update `AIMemory/goals/INDEX.md` when a goal is
   created, updated, paused, completed, or error-paused.
3. **Goal contract object** - treat the goal record as the durable contract:
   objective, parsed tasks, worker assignments, policy, state, telemetry,
   results, errors, and completion guard.
4. **Dispatch preview** - show the compact plan/phase/assignment preview before
   the first worker launch; update it if the user revises the plan.
5. **State gate** - dispatch is allowed only while state is `active`.
   `awaiting_user`, `paused`, and `error_paused` stop auto-run immediately.
6. **Budget/telemetry loop** - keep compact counters, checkpoints, and raw-log
   pointers in the goal record; do not load raw transcripts unless debugging.
7. **Completion guard** - mark `complete` only after all tasks are resolved,
   errors are fixed or documented, verification is recorded, and the final
   report exists.

Minimum goal contract fields:

- `Goal-id`, `Objective`, `Created`, `Updated`, `Created by`, `Orchestrator`
- `State`, `Auto-run`, `Policy`, `Budget hint`, `Raw-log root`
- user request, parsed plan, dispatch preview, compact results, compact errors
- telemetry: tasks total/complete, worker token usage/source/cost,
  orchestrator token usage/source/cost, known goal token total, last
  checkpoint, raw logs loaded or not
- completion guard checklist and final report

Minimum `AIMemory/goals/INDEX.md` ledger columns:

```markdown
| Goal-id | Objective | State | Created | Updated | Completed | Orchestrator | Policy | Tokens | Cost | Final report | Record |
|---------|-----------|-------|---------|---------|-----------|--------------|--------|--------|------|--------------|--------|
```

Preferred new ledger columns split quality, worker usage, and controller usage:

```markdown
| Goal-id | Objective | State | Created | Updated | Completed | Orchestrator | Policy | Quality score | Worker tokens | Orchestrator tokens | Worker cost | Orchestrator cost | Final report | Record |
|---------|-----------|-------|---------|---------|-----------|--------------|--------|---------------|---------------|---------------------|-------------|-------------------|--------------|--------|
```

Token/cost values are best-effort but role-separated. Use reported values when
a runner provides them, `estimated:<value>` only when the estimate method is
clear, and `unknown` when unavailable. If the active Codex harness does not
expose controller token telemetry, record `unknown (not exposed by harness)`
for orchestrator tokens. Do not load raw transcripts just to calculate token
usage.

Required goal states:

| State | Meaning |
|-------|---------|
| `active` | Work is planned or running. |
| `awaiting_user` | User input is required before continuing. |
| `paused` | User or orchestrator intentionally paused work. |
| `error_paused` | Execution hit an error; no further auto-run until resolved. |
| `stopped` | User intentionally stopped the goal; terminal unless restarted. |
| `complete` | Goal is done and final report has been written. |

`/awm goal stop <goal-id>` writes a stop summary and updates `ACTIVE.md` and
the ledger; it is not the same as completion. `/awm goal clear` clears active
or folded ledger visibility by default and must not delete goal records without
an explicit destructive confirmation.

## Agent references and project aliases

Agent selectors use:

```text
<agent>[:<model-or-tier>[:<profile>]]
```

Examples: `claude`, `claude:opus-4.7:max`, `gemini:pro`.

If only an agent name is provided, the orchestrator chooses the model/profile
by task difficulty and records the choice in the goal record. Aliases are
project-scoped and live in `AIMemory/AGENTS.md`; examples include
`claude-max`, `deepseek-pro-max`, or local-language nicknames.

`AIMemory/AGENTS.md` is safe project routing only. It may contain agent names,
model tiers, capabilities, default policies, and environment variable names.
It MUST NOT contain secrets, credentials, auth tokens, or private absolute
machine paths. Machine-private overrides belong under `.agent-work-mux/`.

`/awm agents add <description>` updates the `Project aliases` table in
`AIMemory/AGENTS.md` without dispatching workers.
`/awm agent add <alias> <selector-or-description>` is a singular shortcut where
the first token after `add` is the alias and the remaining text is the selector
or description.
Local-language aliases such as `딥시크` are allowed when the user asks for them.
If `--selector` is provided, validate and use that selector; if `--as` is
provided, use that alias. Normalize selector-like local-language text before
validation, so `오픈코드:딥시크` becomes `opencode:deepseek:auto`. Without flags,
infer known words such as `opencode`, `open code`, or `오픈코드` -> `opencode`,
`continue`, `cn`, or `컨티뉴` -> `continue`, `aider` or `에이더` -> `aider`,
and `deepseek` or `딥시크` -> `deepseek`. A description containing both runner
and model/provider defaults to `<runner>:<model-or-tier>:auto` with alias
`<runner>-<model-or-tier>`, so `오픈코드의 딥시크` registers
`opencode-deepseek -> opencode:deepseek:auto`. If inference is ambiguous or
would overwrite a different selector, ask before changing `AGENTS.md`. Mark new
aliases as untested and recommend `/awm agents test <alias> --smoke`.
Normalize common DeepSeek tier spellings before dispatch: `딥시크v4맥스`,
`deepseekv4max`, or `max` means `deepseek-v4-pro:max`; `딥시크v4노멀`,
`딥시크v4보통`, `deepseekv4normal`, `normal`, or `standard` means
`deepseek-v4-flash:standard`; `딥시크v4플래시`, `deepseekv4flash`, or `flash`
means `deepseek-v4-flash:flash`. Do not silently upgrade verifier/tester work
from normal/standard/flash to max/pro.

Implementer/verifier separation is optional policy, not a protocol default.
Users may choose `single_agent`, `implement_then_verify`,
`deepseek_build_verify_codex_fix`, or another project-defined policy in
`AGENTS.md` or per `/awm goal`. When verification is enabled, the verifier owns
raw worker-log inspection and returns a compact verdict for the orchestrator.
The verifier is a quality gate, not only a test rerunner.

`deepseek_build_verify_codex_fix` is a cost/quality preset for code goals:
DeepSeek-backed workers do the broad implementation and verifier/tester work;
the current Codex controller performs only narrow patches from precise verifier
findings; the final accept/fix/pause decision still comes from the final
verifier verdict. In Codex-controlled runs, this uses the in-session Codex
controller as fixer and MUST NOT call Codex CLI unless the user explicitly asks
for live Codex CLI execution. If the verifier finding is broad, ambiguous, or
lacks allowed file scope, pause instead of letting Codex explore.

For software implementation goals, the planner SHOULD write a compact quality
contract before dispatch. The contract should name the acceptance threshold,
hard fail gates, warning gates, and domain checklist. For web/API goals, useful
default gates include input validation, body size limits, safe local binding,
atomic JSON writes, unsafe Markdown/link protocol rejection, normalized tags or
structured fields, deterministic list ordering, run instructions, `.gitignore`,
no generated dependency folders as deliverables, phase tests, and smoke checks.
The contract should also name stop conditions: maximum fix rounds, when warnings
are accepted, and when the controller must pause instead of launching another
worker.

## Lazy CLI runner and output isolation

The preferred v3 runner shape is a CLI runner, not MCP. The runner spec is
lazy-loaded from `runner.md` in this repository or `AIMemory/RUNNER.md` after
project setup. Do not load runner instructions during ordinary sessions.

The runner remains markdown-first. Local executable helpers such as
`awm-launch`, `awm-watch`, and capsule handshake probes are generated lazily from
`*.js.md` helper specs into ignored `.agent-work-mux/bin/` during setup/probing
or first runner onboarding. Real dispatch requires generated helpers to match
their source hashes and pass self-tests; otherwise the controller must stop
before launching model-backed workers. Helper generation prompts must follow the
source spec's generation notes, OS/runtime differences, validation rules, and
code blocks, then write a helper test report showing that all required OS shell
and runtime features for the current environment passed. The default generated
helper must not introduce a new external runtime dependency: use PowerShell plus
an optional `.cmd` shim on Windows, POSIX `sh` on Unix-like systems, and only use
`bash`, Node, .NET, or another runtime when setup/probe explicitly selects it as
an available fallback. Windows `.cmd` helpers are shims for stable command names;
internal runner calls should invoke the real helper entrypoint with explicit
arguments and must not rely on `shell: true` or free-form shell text.

Generated helper names and call parameters are an ABI, not generator choices.
For the current protocol version the stable logical commands are `awm-launch
<launch.json>`, `awm-watch --run-dir <dir> --expected-capsule <file>
--attempt-id <id> --timeout-ms <n> --idle-ms <n> --json`,
`awm-helper-self-test --manifest <file> --json`, and
`awm-capsule-probe --agent <selector> --run-dir <dir> --expected-capsule <file>
--timeout-ms <n> --json`. A generator may add OS-specific wrapper extensions,
but it must not rename helpers, change required parameter names, or change
required positional/flag semantics during generation. Unsupported required ABI
features are setup/probe blockers.

Prefer creating helper programs and agent launch prototypes during setup or
agent registration/probe, not during each `/awm goal`. Registration-time
prototype files live under ignored `.agent-work-mux/helpers/agents/<alias>/`
and store stable invocation shape, required env names, supported stdio/prompt
mode, and model/tier normalization without secrets. Per-task `launch.json` still
varies by cwd, prompt, attempt id, expected capsule, and timeout, but it must be
derived from the fixed prototype plus the path ABI rather than invented by a goal
prompt.

Existing launch prototypes are locked local runtime artifacts. They are created
for new aliases during registration, and refreshed only through `/awm agent
refresh <alias>` or an explicitly requested setup/probe upgrade. Refresh marks
the capsule handshake stale until `/awm agents test <alias> --smoke` passes.

Protocol-defined relative directory and file names are also an ABI. Absolute
roots may vary by project, workspace, OS, or selected goal output directory, but
the structure under those roots must not. Generators, launchers, workers,
verifiers, and fixers must not rename or substitute runner-owned path segments
such as `AIMemory/`, `AIMemory/goals/ACTIVE.md`, `AIMemory/goals/INDEX.md`,
`.agent-work-mux/bin/`,
`.agent-work-mux/helpers/manifest.json`,
`.agent-work-mux/runs/<goal-id>/<task-id>/launch.json`,
`prompt.txt`, `stdout.jsonl`, `stderr.log`, `warnings.jsonl`,
`critical-error.json`, `diagnostics.json`, `controller_status.json`, `pid.json`,
`heartbeat.json`, `watch.json`, `result.json`, `verdict.json`, and
`.agent-work-mux/runs/<goal-id>/metrics/summary.json`. A missing fixed filename
inside the expected relative structure is meaningful evidence. Do not silently
map it to another name. When work is isolated under a nested output root such as
`testprj001/phase001/`, that root anchors the same relative structure:
`testprj001/phase001/.agent-work-mux/runs/<goal-id>/<task-id>/launch.json`,
`result.json`, `verdict.json`, `watch.json`, and
`testprj001/phase001/.agent-work-mux/runs/<goal-id>/metrics/summary.json` must
be predictable from the root plus protocol path ABI. Path ABI changes require a
protocol version bump and migration note, not a per-run choice.

Default task ids are fixed unless the controller declares an explicit extension
before dispatch: `implement`, `verify`, `fix_codex`, and `verify_final`. Extra
task ids must be stable `[A-Za-z0-9_]+` slugs, listed in the dispatch preview and
goal record, precreated by the controller/launcher, and passed as context to all
roles. Shared helper binaries and alias launch prototypes live at the project
root `.agent-work-mux/bin/` and `.agent-work-mux/helpers/`; per-goal/per-phase
config and status live under the selected output root's `.agent-work-mux/runs/`.

The helper ABI and path ABI are shared by generated helper programs, controller,
worker, verifier, tester, and fixer roles. The controller/launcher precreates
runner-owned directories for every phase by default before dispatch. Other roles
write their required files into those prepared directories and must report
failure instead of creating alternate runner-owned paths.

Runner-local state goes under `.agent-work-mux/` and is ignored by git. Raw
runner/sub-agent logs go under `.agent-work-mux/runs/<goal-id>/` or another
private ignored path. This follows RTK-style token isolation: raw output must
not flood the main agent context. Workers return compact summaries, errors,
artifacts, and exit status to the runner. If a verifier/tester task exists, the
verifier reads worker logs and artifacts, then writes a compact `verdict.json`
containing PASS/FAIL, score, phase results, blockers, warnings, metrics, and
controller action. The orchestrator reads `verdict.json`, compact metrics, and
artifact paths by default; it must not tail raw worker stdout/stderr while
waiting. Raw logs are loaded by the orchestrator only for explicit debugging or
when the verifier asks for `debug_raw_log`.

After dispatch, the orchestrator should trust the worker/verifier binding.
It should not repeatedly inspect generated files, rerun tests, or read progress
logs before the verifier finishes unless there is a timeout, non-zero exit,
missing capsule, verifier-requested debug action, or explicit user request.
Progress logging before verifier completion should be sparse: goal created,
worker/verifier dispatched, verdict recorded, and final completion or pause.
Use one strong dispatch prompt with output boundaries, quality contract,
capsule schema, and scope rules instead of many mid-run corrections.
Workers that do not produce required compact capsules before their timebox are
`TIMEOUT_MISSING_CAPSULE`; if artifacts exist, review shifts to the verifier
instead of keeping the controller in a wait/inspect loop.
For verifier/tester tasks, use split timeboxes: startup/no-output, active work
after the first machine-readable event, and a short finalization grace period
after required phase commands pass. A verifier should create a parseable
`verdict.json` skeleton with `status: IN_PROGRESS` before expensive checks and
atomically update it after each phase, so timeout recovery has evidence.
Default code-goal timeboxes are 30 minutes for broad implementer work and 30
minutes for verifier/tester work, plus a 3 minute finalization grace period once
required phase commands have completed or a terminal verdict is being written.
Short smoke probes may use smaller explicit limits.

Launch failures are separate from verifier judgments. Runner dispatch must use a
shell-free launch contract: write
`.agent-work-mux/runs/<goal-id>/<task-id>/launch.json` with `cwd`, `cmd`,
`args[]`, env, stdout/stderr paths, pid/heartbeat/status files, expected capsule,
and timeout; start the child with shell parsing disabled and set `cwd` as a
process property. Do not launch worker CLIs through one long `Start-Process`
argument string, and do not pass the same workspace path again through
tool-specific `--dir`, `--cwd`, or positional path args when the launcher already
sets `cwd`. On Windows, normalize npm/global CLI wrappers before spawn: if `cmd`
resolves to `.cmd`, `.bat`, `.ps1`, or a POSIX-style shim, resolve it to the real
executable/entrypoint such as `node.exe` plus the package JS entrypoint, and
record requested command, resolved command, shim path, and entrypoint in
diagnostics. Do not use `shell: true` as the fallback for wrappers. If the
process never starts or no startup heartbeat appears, record `LAUNCH_FAILED`. If
it starts and exits quickly without the expected capsule, record
`RUNTIME_FAILED_NO_CAPSULE`. Inspect only the short stderr excerpt needed to
decide whether a retry is safe.

Filesystem creation is part of the launch contract, not an agent improvisation.
The launcher/controller must precreate every runner-owned parent directory before
dispatch: task run directory, capsule parent, stdout/stderr parents,
status/heartbeat/diagnostic parents, metrics directories, and prompt-file
directories. This applies to implementer, verifier, tester, and fixer phases.
Creation must be idempotent: an existing directory is success. Use
structured filesystem APIs such as Node `fs.mkdir(..., { recursive: true })` or
PowerShell `New-Item -ItemType Directory -Force`; do not ask workers to rely on
shell aliases. On Windows, `mkdir -p` is forbidden in worker/verifier prompts and
runner bridge commands because PowerShell can parse it as `New-Item` and fail
when the directory already exists. Workers and verifiers may create app-owned
directories inside their output boundary, but runner-owned paths from
`launch.json` must already exist. Prompts must say the capsule directory already
exists, name the exact file to write, and explicitly forbid creating runner-owned
directories. The launcher/controller may create schema/template files, but must
not precreate the expected worker-owned `result.json` or verifier-owned
`verdict.json`, because capsule presence is a control signal. Compact runner
files such as `result.json`, `verdict.json`, `controller_status.json`,
`diagnostics.json`, and metrics summaries should be written through a
same-directory temp file followed by rename. Task ids that become runner path
segments should be stable slugs; prefer `[A-Za-z0-9_]+` unless the project has
explicitly declared a hyphenated id.

Capsule presence outranks launcher exit-code uncertainty. If the expected
capsule exists, classify the launch as `CAPSULE_PRESENT` and let the controller
validate the capsule schema/status. A bridge `ExitCode = null` or non-zero child
exit code is diagnostics only in that case and must not leave
`critical-error.json`.
The inverse is also part of the launch contract: if an expected capsule is
missing, the launcher must return a non-zero exit code even when the child
process exits `0`. The compact status, not the child exit code alone, decides
whether dispatch succeeded.

On Windows, OpenCode dispatch should prefer file-handle stdio redirection over
Node pipe capture. A small `opencode run` can succeed through
`Start-Process -RedirectStandardOutput` while hanging when launched by Node with
stdout/stderr pipes. Preserve the same `launch.json` contract, but use
`"stdio_mode": "file"` or an equivalent bridge that connects stdout/stderr
directly to files and reports byte counts from file size polling.

OpenCode prompt files use a special safety rule. Prefer `prompt_file` in
`launch.json` with `"prompt_mode": "inline"` and put `{{awm_prompt_text}}` in the
normal positional message. Do not rely on "read this prompt file" as the primary
instruction for broad implementation tasks, and do not pass the worker prompt
itself through OpenCode `--file`; `--file` is for workspace/source files and can
cause a following message to be parsed as another file argument. If source files
must be attached with `--file`, put the message before all `--file` args. A
launcher may fail fast with `LAUNCH_FAILED/opencode_file_argument_order` when it
detects a positional message after an OpenCode `--file`.

Provider secrets are part of the launch contract. Launch specs should declare
needed variables in `required_env`, such as `DEEPSEEK_API_KEY` for OpenCode
DeepSeek. The launcher may hydrate missing required variables from Windows
User/Machine scope without writing secret values to diagnostics, but a missing
required provider secret is `LAUNCH_FAILED/missing_required_env` and requires
controller/user action rather than verifier interpretation.

Diagnostic streams are split by actionability. Normal output goes to
`stdout.jsonl`; raw stderr goes to `stderr.log`; classified non-fatal warnings go
to `warnings.jsonl`; controller-action failures go to `critical-error.json`; and
compact byte counts/status/pointers go to `diagnostics.json`. Stderr length alone
is not a verdict. Warnings flow to the verifier/tester. The controller responds
only to `critical-error.json`, failed exit/capsule status, or explicit verifier
`controller_action`, and it reads only the short critical excerpt by default.

Bounded polling belongs in the generated `awm-watch` helper, not ad hoc
controller loops. The watcher observes file mtimes, file sizes, pid/heartbeat,
attempt id, `controller_status.json`, `diagnostics.json`, `critical-error.json`,
and the expected capsule for the requested timeout/idle thresholds. It returns
compact statuses such as `CAPSULE_PRESENT`, `CAPSULE_IN_PROGRESS`,
`RUNNING_ACTIVE`, `RUNNING_IDLE`, `ERROR_PRESENT`, `INVALID_CAPSULE`,
`EXITED_NO_CAPSULE`, `TIMEOUT_MISSING_CAPSULE`, and `STALE_HEARTBEAT`. By
default it does not read raw stdout/stderr contents and never writes the expected
capsule itself.

Timeout checks are task-attempt scoped. Runtime timeout starts at
`process_started_at`, when the child worker has a pid and heartbeat, not at goal
creation time, run-directory mtime, `launch.json` mtime, parent controller
session start, or any previous attempt's status file. `controller_status.json`
and `diagnostics.json` must record `launcher_started_at`,
`task_started_at`, `process_started_at`, `timeout_started_at`, `deadline_at`,
`task_elapsed_ms`, and `launcher_elapsed_ms` when applicable. The launcher must
record `task_started_at` immediately before spawning the child, pass it to the
worker through environment variables such as `AWM_TASK_STARTED_AT`,
`AWM_TIMEOUT_STARTED_AT`, `AWM_DEADLINE_AT`, and `AWM_ATTEMPT_ID`, and expand the
same values in `args[]` placeholders when the prompt needs them. Startup/no-output
timeout can only produce `LAUNCH_FAILED`; normal runtime timeout can produce
`TIMEOUT_MISSING_CAPSULE`. Retries must use fresh attempt directories or matching
`attempt_id`, and stale heartbeat/status files must be ignored. `pid.json` and
`heartbeat.json` should include the current `attempt_id` so a controller can
distinguish a live current process from a killed or superseded retry.

The orchestrator/controller's normal role is design, dispatch, capsule
validation, final decision, and final report. Backend tests, frontend tests,
smoke tests, live server/API/browser probes, source-quality review, and raw-log
summarization belong to the verifier/tester when one is assigned. The
controller should not rerun those checks unless there is no verifier/tester,
the verifier asks for controller-side debug, or the user explicitly requests
controller retesting.
For local service checks, the verifier/tester also owns process cleanup and
must report whether any server was left running.
When a verifier/tester is assigned, the implementer should not run those phase
checks either. Implementer prompts should ask workers to create scripts and
artifacts, write a parseable `result.json` skeleton early, and avoid direct
long-running foreground commands such as `npm start`. Optional implementer
self-checks must be bounded commands that terminate and clean up child
processes.

The controller is accountable for ensuring the designed components add up to
the whole system. It should define component boundaries, public data/API
contracts, assembly rules, and end-to-end acceptance before dispatch. The
verifier/tester then proves both component contracts and the assembly contract;
the controller uses that verdict instead of duplicating the tests.

Repair loops are bounded. After verification, fixes must be narrow: cite the
exact verifier finding, restrict file scope where possible, and require a
compact result capsule. Accept `PASS` with no blockers and score at or above the
configured threshold; do not chase extra quality points unless the user asks.
If missing capsules repeat, pause or ask the user rather than launching another
unconstrained worker.

Metrics summaries should live at
`.agent-work-mux/runs/<goal-id>/metrics/summary.json` and split worker,
verifier, and controller/orchestrator token/cost usage. Include timed-out and
failed attempts when the runner reports them. If controller token telemetry is
not exposed by the host, record `unknown (not exposed by harness)` rather than
folding it into worker totals.

Generated dependency folders are judged as deliverables, not as transient test
state. For Node.js goals, implementers should create `.gitignore` before
`npm install`; `node_modules` may exist after verification if ignored and not
listed in `artifact_paths`. It is a hard fail when dependency folders are
included as deliverable artifacts, copied to the result bundle, committed, or
left unignored. Verifiers should check top-level presence, `.gitignore`, and
artifact manifests instead of recursively scanning dependency directories.

---

## When in doubt

Append a `NOTE` event to `work.log` describing your uncertainty and what
you assumed. The next agent (possibly the user) will see it and can
correct course.

---

# Part III - Inter-AI Communication Protocol (AICP)

`work.log` records events. But when AI-A wants AI-B to **act** on something -
review a doc, implement from a spec, take over a task - we need a
**structured message**. AICP defines one artifact per handoff: a handoff
file in `AIMemory/`. `work.log` gets a pointer via a `HANDOFF` event.

## Handoff file naming

```
AIMemory/handoff_<topic-slug>.<authoring-model-id>.md
```

Topic-slugs: short (under ~40 chars), kebab-case.

## Message types (pick one per file)

| Type             | Purpose                                                | Expects reply? |
|------------------|--------------------------------------------------------|:--------------:|
| DECISION_RELAY   | Passing user-confirmed decisions for another AI to act | No (action)    |
| REVIEW_REQUEST   | Asking another AI to review a spec/plan/code/data      | Yes            |
| REVIEW_RESPONSE  | Returning a review (cite the REQUEST it answers)       | Optional       |
| QUESTION         | Open question that needs another AI's answer           | Yes            |
| ANSWER           | Responding to a QUESTION (cite the request)            | No             |
| BLOCKER_RAISED   | Flagging something that blocks further work            | Yes            |
| STATUS_REPORT    | Informing of work completed / current state            | No             |
| PROPOSAL         | Suggesting a new design / approach for discussion      | Optional       |

## Required header

```markdown
# <Short title>

**From**: <authoring-model-id>
**From-vendor**: <Anthropic | OpenAI | Google | other>
**To**: <target-model-id | "all" | "any-capable">
**Date**: YYYY-MM-DD HH:MM
**Type**: <one of the message types above>
**Priority**: <BLOCKING | HIGH | NORMAL | LOW>
**Reply by**: <YYYY-MM-DD | "no reply needed" | "when convenient">
**Re**: <link to triggering file or work.log timestamp, or "new topic">
**Required capability**: <e.g. "WebSearch", "Multimodal", "none">
```

`Required capability` lets the target check feasibility before accepting.
If the target lacks it, they should `BLOCKER_RAISED` rather than attempt.

Priority rules:
- **BLOCKING** - receiver cannot proceed without responding; sender should
  also ask the user to flag it
- **HIGH** - receiver should respond in their next turn if possible
- **NORMAL** - respond when convenient (default)
- **LOW** - informational; no reply expected

## Required body sections

```markdown
## Summary
<2- sentences, plain language>

## Context
<minimal background - link to prior files rather than restate>

## Content
<the actual payload>

## Action items
- [ ] AI-B: <imperative, specific action>

## Waiting on
<what sender is blocked by, if anything>
```

For REVIEW_REQUEST, add:

```markdown
## Review checklist (for AI-B)
- [ ] Correctness of X
- [ ] Completeness of Y
- [ ] Feasibility of Z
```

## work.log integration

When you create a handoff file, append TWO events:

```
### HH:MM | <model> | FILES_CREATED
- AIMemory/handoff_<slug>.<model>.md

### HH:MM | <model> | HANDOFF
-<target-model>: <one-line purpose>. See handoff_<slug>.<model>.md.
Priority: <...>. Reply by: <...>.
```

Receiving AI:

```
### HH:MM | <my-model> | HANDOFF_RECEIVED
-<sender-model>: handoff_<slug>.<sender-model>.md
Acknowledged. <Acting on action items | Replying in handoff_<reply-slug>.<my-model>.md>.
```

When done:

```
### HH:MM | <my-model> | HANDOFF_CLOSED
-<sender-model>: handoff_<slug>.<sender-model>.md
Completed: <short status>. See <deliverable files, if any>.
```

Unclosed handoffs are like unfinished work - next session should check.

## Amending a handoff after sending

Don't edit after acknowledgment. Create `handoff_<slug>_v2.<model>.md`
with `Re:` pointing to v1. Typo fixes before any HANDOFF_RECEIVED are
fine in place.

---

## Quick checklist - every new turn

Before responding to a user prompt:
- [ ] Read AIMemory/work.log tail
- [ ] Check for orphan WORK_START - ask about resumption
- [ ] If proceeding, append PROMPT entry
- [ ] At session start, also append RE_ENGAGED with capabilities
- [ ] If the prompt starts with `/awm`, parse the command and update/create
      the matching goal, alias, or lifecycle record
- [ ] If the prompt is plain natural language, route clear non-goal AWM
      intents to the matching command; require `/awm goal ...` or
      `/awm goals ...` for new goal orchestration
- [ ] Before finishing, append WORK_END

Before creating a new markdown file:
- [ ] Is this a harness-required file? - use its required location
- [ ] Otherwise -> AIMemory/{slug}.{my-model-id}.md
- [ ] Append FILES_CREATED to work.log

Before sending work to another AI:
- [ ] Create AIMemory/handoff_<slug>.<my-model>.md with full AICP header
- [ ] Append FILES_CREATED + HANDOFF events

Before using the CLI runner:
- [ ] Confirm the user invoked an explicit `/awm` command
- [ ] Load runner instructions lazily (`runner.md` or `AIMemory/RUNNER.md`)
- [ ] Create/update `AIMemory/goals/ACTIVE.md` before dispatch
- [ ] Create/update the goal row in `AIMemory/goals/INDEX.md`
- [ ] Show the compact dispatch preview before the first worker launch
- [ ] Keep raw worker output in ignored `.agent-work-mux/runs/`
- [ ] Record compact summaries/errors/results and telemetry in `AIMemory/goals/`
- [ ] Run the completion guard before marking a goal `complete`

---

## Non-goals

- Logging every Read/Grep/Edit tool call.
- Logging subagent-internal thinking.
- Heavy ceremony for trivial single-turn requests. Use judgment.

---

## Amendment

If you (any AI) want to amend this protocol, append a NOTE to work.log
proposing the change. Don't unilaterally edit PROTOCOL.md.
