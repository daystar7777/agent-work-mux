# Upgrade: AgentWorkMux v1/v2 -> v3

> Use this prompt when a project already has `AIMemory/PROTOCOL.md` and
> `AIMemory/work.log`, but is missing v3 lifecycle, alias, and goal
> orchestration files.
>
> One-line invocation:
>
> > "Fetch <https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/upgrade.md>
> > and execute it on this project."

The migration is non-destructive. Existing `AIMemory/` history is preserved.
v3 adds:

- `AIMemory/INSTALLATION.md` - install/reinstall lifecycle metadata
- `AIMemory/AGENTS.md` - project-scoped safe aliases and routing policy
- `AIMemory/goals/ACTIVE.md` - active `/awm` goal cursor and resume checkpoint
- `AIMemory/goals/INDEX.md` - lazy goal history ledger and status dashboard
- `AIMemory/goals/` - `/awm goal` contracts, compact results, and errors
- lifecycle events: `UNINSTALLED`, `RE_INSTALLED`
- goal events: `GOAL_CREATED`, `GOAL_UPDATED`, `GOAL_COMPLETED`,
  `RUNNER_RESULT`
- lazy CLI runner contract; raw runner logs stay in ignored `.agent-work-mux/`
- lazy agent call probe; raw probe logs stay in ignored `.agent-work-mux/probes/`

This upgrade prompt is for older AIMemory schemas. If deprecated
`agent-work-mem` install markers are present, do not inline that legacy
migration here. Lazy-load `migration.md` and run the one-time rename migration
there so future sessions do not carry legacy context.

## Your tasks

### Task 0 - Verify state

Check that `AIMemory/PROTOCOL.md` and `AIMemory/work.log` exist.

```bash
test -f AIMemory/PROTOCOL.md && test -f AIMemory/work.log && echo OK || echo "no install - run prompt.md instead"
```

If they do not exist, stop and run the bootstrap prompt instead:
<https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/prompt.md>

### Task 1 - Identify yourself

State:

- Model-id
- Vendor
- Harness
- Capabilities using vendor-neutral tags from `PROTOCOL.md`

### Task 2 - Read current memory

Read:

1. `AIMemory/INDEX.md` if present
2. `AIMemory/PROJECT_OVERVIEW.md` if present
3. The last 50 lines of `AIMemory/work.log`

Check for an orphan `WORK_START`. If one exists, ask the user whether to
resume that work or continue the upgrade.

### Task 3 - Fetch or write the canonical v3 protocol

Create missing directories:

```bash
mkdir -p AIMemory/archive AIMemory/cold AIMemory/goals
```

If `AIMemory/goals/ACTIVE.md` is missing, create:

```markdown
# Active Goal Cursor

**Current goal-id**: none
**State**: none
**Orchestrator**: none
**Goal record**: none
**Last completed task**: none
**Next checkpoint**: none
**Raw-log root**: none
**Final report written**: false

## Resume note

No active `/awm goal` yet.
```

If `AIMemory/goals/INDEX.md` is missing, create:

```markdown
# Goal History

## Summary
- Total goals: 0
- Active: 0
- Awaiting user: 0
- Paused: 0
- Error paused: 0
- Stopped: 0
- Complete: 0

## Goals
| Goal-id | Objective | State | Created | Updated | Completed | Orchestrator | Policy | Tokens | Cost | Final report | Record |
|---------|-----------|-------|---------|---------|-----------|--------------|--------|--------|------|--------------|--------|
| (none) | | | | | | | | | | | |

---
Last update: <YYYY-MM-DD HH:MM> by <model-id>
```

Fetch the current protocol:

```bash
curl -fsSL https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/PROTOCOL.md \
  -o AIMemory/PROTOCOL.md
```

If `curl` is unavailable, use your web-fetch tool or copy the canonical
`PROTOCOL.md` content from the repo.

### Task 4 - Backfill `INDEX.md`

If `AIMemory/INDEX.md` is missing, create it. If it exists, update it.

Required v3 sections:

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
(none yet - populated when work.log rotates)

## Cold - fetch only on explicit need
| File | Period covered | Topics | Summary |
|------|----------------|--------|---------|
(none yet)

## Topic index - grep me
(none yet - keywords appear here as archives are created)

## Active handoffs (open AICP threads)
<list open handoff_*.md files, or "(none)">

## Active goals
- goals/ACTIVE.md -> current goal: <goal-id or none>
- goals/INDEX.md -> lazy goal history ledger for `/awm goal list`
- <list active/paused/error_paused goals, or "(none)">

## Other notable files
- PROTOCOL.md - the rules
- PROJECT_OVERVIEW.md - onboarding primer
- goals/ACTIVE.md - active goal cursor; read before resuming `/awm goal`
- goals/INDEX.md - lazy goal history ledger; read for `/awm goal list`
- runner.md / RUNNER.md - lazy runner spec; read only for explicit `/awm`

---
Last update: <YYYY-MM-DD HH:MM> by <model-id>
```

### Task 5 - Backfill `PROJECT_OVERVIEW.md`

If missing, synthesize it from `work.log`. If present, keep existing content
and add only durable v3 context if needed:

- Recent activity: `AIMemory/work.log`
- Topic-based history: `AIMemory/INDEX.md`
- Active goal cursor: `AIMemory/goals/ACTIVE.md`
- Goal history ledger: `AIMemory/goals/INDEX.md`
- Goal records: `AIMemory/goals/`
- Lazy runner: `runner.md` or `AIMemory/RUNNER.md`, only for explicit `/awm`

Do not invent project facts. Use `<TODO: ask user>` if the log does not
contain enough information.

### Task 6 - Create or update `INSTALLATION.md`

If missing, create:

```markdown
# AIMemory Installation

## Schema
- protocol_version: v3
- installer_version: upgrade.md from main or <commit SHA>
- bootstrapped_at: <unknown or original timestamp>
- bootstrapped_by: <unknown or original model @ harness>
- upgraded_at: <ISO-8601 timestamp>
- upgraded_by: <model-id> @ <harness>
- runner_declaration: none

## Harness files modified
| Path | Format | Sentinel hash | Line range | Purpose |
|------|--------|---------------|------------|---------|
| (none known - legacy upgrade did not backfill sentinel blocks) | | | | |

## Lifecycle history
| Timestamp | Event | Model | Summary |
|-----------|-------|-------|---------|
| <ISO-8601> | RE_INSTALLED | <model-id> | Upgraded existing AIMemory to v3 metadata. |

## Reinstall history
| Timestamp | Previous installer | New installer | Model | AIMemory state |
|-----------|--------------------|---------------|-------|----------------|
| <ISO-8601> | unknown | v3 upgrade.md | <model-id> | reused |

## Private data policy

Secrets, credentials, auth tokens, and private machine paths are not allowed in
this file. Put private overrides under ignored `.agent-work-mux/` files or
environment variables.
```

If it exists, append a new upgrade/reinstall row. Do not delete history.

### Task 7 - Create or update `AGENTS.md`

If missing, create:

```markdown
# AIMemory Agents

## Alias policy

Agent selectors use `<agent>[:<model-or-tier>[:<profile>]]`.

If only an agent name is provided, the orchestrator chooses the model/profile
by task difficulty and records the choice in the goal record.

## Default orchestration policy

- default_policy: single_agent
- verifier_required: user_selectable
- headless_requires_explicit_awm: true
- goal_auto_run_default: true
- goal_cursor_file: AIMemory/goals/ACTIVE.md
- goal_ledger_file: AIMemory/goals/INDEX.md
- completion_guard_required: true
- telemetry_policy: compact_only
- agent_call_probe: lazy

## Model and profile policy

- model_or_tier labels are project-safe routing labels such as `auto`, `pro`,
  `max`, `local`, or a public model name.
- profile labels describe effort, context, or tool policy such as `auto`,
  `standard`, `max`, or `readonly`.
- Private executable paths, account names, provider credentials, and machine
  paths never appear here.

## Project aliases
| Alias | Resolves to | Capabilities | Notes |
|-------|-------------|--------------|-------|
| claude | claude:auto:auto | filesystem-read, filesystem-write, shell-exec | Orchestrator chooses model/profile by difficulty. |
| codex | codex:auto:auto | filesystem-read, filesystem-write, shell-exec | Useful for implementation/review loops. |
| gemini | gemini:auto:auto | filesystem-read, web-search, image-input | Adjust to actual project setup. |

## Private overrides

Private executable paths, account names, credentials, tokens, and local config
belong in ignored `.agent-work-mux/agents.local.md` or environment variables.
Do not add them here.
```

If it exists, preserve user aliases and add only missing required policy keys.

### Task 8 - Rotate if needed

Count events in `AIMemory/work.log`. If over `HOT_RETENTION_EVENTS * 1.5`,
rotate per `PROTOCOL.md`. If you cannot rotate safely, append a `NOTE` and
leave rotation for a later single-agent session.

### Task 9 - Append upgrade event

Append:

```text
### YYYY-MM-DD HH:MM | <model-id> | RE_INSTALLED
Previous installer version: <unknown | v1 | v2 | sha/url>
New installer version: v3 upgrade.md
Schema delta summary: Added INSTALLATION.md, AGENTS.md, goals/ACTIVE.md, goals/INDEX.md, /awm command contract, lazy runner isolation.
AIMemory state: reused
```

### Task 10 - Confirm

Reply with:

- Model-id, vendor, harness, capabilities
- Files created or modified
- Whether rotation ran
- Any unresolved TODOs in `PROJECT_OVERVIEW.md`
- Whether aliases are placeholders that need user confirmation
- One sentence: "I will follow the v3 PROTOCOL.md from this turn forward."
