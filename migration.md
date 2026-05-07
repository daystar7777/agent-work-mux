# Migration: agent-work-mem -> AgentWorkMux

This prompt is lazy-loaded. Use it only when a project already appears to have
the deprecated `agent-work-mem` installation, or when the user explicitly asks
to migrate from `agent-work-mem` to AgentWorkMux.

Do not load this file during ordinary AgentWorkMux sessions.

## Migration goal

Convert the installation identity from `agent-work-mem` to AgentWorkMux without
duplicating memory, losing history, or bloating future context.

The migration is non-destructive:

- Preserve `AIMemory/`
- Preserve `AIMemory/work.log`
- Preserve handoff files, archives, cold digests, goal records, and project
  notes
- Replace only managed legacy reminder blocks that are safely bounded by
  `agent-work-mem:start` and `agent-work-mem:end`
- Create or update AgentWorkMux v3 metadata only when missing or stale
- Do not delete `.agent-work-mem/` unless the user explicitly opts in

## Legacy detection

Treat any of these as a legacy signal:

- `AIMemory/PROTOCOL.md` or `AIMemory/INSTALLATION.md` mentions
  `agent-work-mem`
- harness files contain `agent-work-mem:start` / `agent-work-mem:end`
- project-local `.agent-work-mem/` exists
- README or instruction files point to
  `daystar7777/agent-work-mem`
- `AIMemory/INSTALLATION.md` has no v3 AgentWorkMux lifecycle metadata but
  `AIMemory/` already exists

If none are present, stop. Do not perform migration work.

## Hard safety rules

- Never delete `AIMemory/`
- Never append a second `PROJECT_BOOTSTRAPPED` for the same memory
- Never duplicate existing `work.log` history
- Never rewrite `work.log`; append one compact lifecycle event
- Never remove unbounded user-authored instructions
- Never delete `.agent-work-mem/` without explicit user consent
- Never put private executable paths, account names, credentials, tokens, or
  machine-local config in `AIMemory/`

## Migration steps

### 1. Identify yourself

State model-id, vendor, harness, and capabilities using the vocabulary from
`AIMemory/PROTOCOL.md` when available.

### 2. Read current memory

Read:

1. `AIMemory/INSTALLATION.md` if present
2. `AIMemory/PROTOCOL.md` if present
3. `AIMemory/INDEX.md` if present
4. last 50 lines of `AIMemory/work.log` if present

If an orphan `WORK_START` exists, ask whether to resume that work or continue
the migration.

### 3. Preserve AIMemory and backfill v3 files

Create missing directories:

```bash
mkdir -p AIMemory/archive AIMemory/cold AIMemory/goals
```

If missing, create or update the v3 files from the current AgentWorkMux
bootstrap or upgrade prompts:

- `AIMemory/PROTOCOL.md`
- `AIMemory/INDEX.md`
- `AIMemory/PROJECT_OVERVIEW.md`
- `AIMemory/INSTALLATION.md`
- `AIMemory/AGENTS.md`
- `AIMemory/goals/ACTIVE.md`
- `AIMemory/goals/INDEX.md`

Do not overwrite durable user/project facts. Prefer additive updates.

### 4. Replace managed legacy reminder blocks

Search only known harness instruction files and files recorded in
`AIMemory/INSTALLATION.md`:

- `CLAUDE.md`
- `.codex/instructions.md`
- `.cursorrules`
- `.aider.conf.yml`
- any path listed under `harness_files_modified`

For each file:

1. Locate blocks bounded by `agent-work-mem:start` and `agent-work-mem:end`.
2. If the block is clearly bounded, replace it with an AgentWorkMux sentinel
   block using `agent-work-mux:start` and `agent-work-mux:end`.
3. If the block was manually edited or unbounded, do not edit it. Report it for
   user review.

Use the current AgentWorkMux reminder text:

```text
This project uses AgentWorkMux. Read AIMemory/INDEX.md,
AIMemory/PROJECT_OVERVIEW.md, and recent AIMemory/work.log before acting.
Use /awm goal for explicit goal orchestration. Plain natural language must not
start headless worker dispatch.
```

### 5. Record lifecycle without duplication

Append one `RE_INSTALLED` event to `AIMemory/work.log`:

```text
### YYYY-MM-DD HH:MM | <model-id> | RE_INSTALLED
Previous installer version: agent-work-mem legacy
New installer version: AgentWorkMux v3 migration.md
Schema delta summary: Migrated installation identity, refreshed managed sentinels, reused AIMemory, added v3 goal cursor if needed.
AIMemory state: reused
```

Update `AIMemory/INSTALLATION.md`:

- `protocol_version: v3`
- `installer_version: AgentWorkMux migration.md from main or <commit SHA>`
- append lifecycle/reinstall history row
- record refreshed sentinel paths and hashes
- preserve prior history

### 6. Optional local legacy cleanup

If `.agent-work-mem/` exists, ask:

> Deprecated agent-work-mem local state was found. Remove it now?

Delete it only after an explicit yes. If preserved, ensure `.agent-work-mem/`
is ignored by git.

### 7. Confirm

Reply with:

- Migration status: migrated / already AgentWorkMux / blocked
- Files modified
- Files preserved
- Legacy sentinels replaced or skipped
- Whether `.agent-work-mem/` was removed or preserved
- Reinstall note: existing `AIMemory/` will continue to be reused
