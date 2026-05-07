# Uninstall: AgentWorkMux v3 Detach Flow

Use this prompt when the user wants to uninstall AgentWorkMux behavior from a
project. The default uninstall mode is **detach**: remove managed reminder
blocks, preserve `AIMemory/` and all project memory, and remove local runner
state only after explicit user opt-in.
This is also the operational prompt behind `/awm uninstall`.

Operational language is English-only. Preserve user-provided text verbatim in
logs, but do not translate protocol templates or lifecycle records.

## Safety rules

- Never delete `AIMemory/` by default.
- Never delete work history, handoff files, goal records, archives, or cold
  digests unless the user explicitly asks for destructive cleanup.
- Never remove text from a harness file unless it is inside a managed
  agent-work-mux sentinel block and the recorded sentinel hash still matches.
- Never store secrets, credentials, auth tokens, or private machine paths in
  git-tracked files.
- Never start headless runner dispatch during uninstall.
- Preserve `AIMemory/AGENTS.md`; aliases are project memory and are reused on
  reinstall unless the user explicitly asks to edit them.
- Remove `.agent-work-mux/` only after explicit user opt-in, because it is
  machine-local runner state.

## Tasks

### Task 1 - Identify yourself

State:

- Model-id
- Vendor
- Harness
- Capabilities using the vendor-neutral tags from `AIMemory/PROTOCOL.md`

### Task 2 - Verify installation state

From the project root:

1. Check for `AIMemory/PROTOCOL.md` and `AIMemory/work.log`.
2. Check for `AIMemory/INSTALLATION.md`.
3. Read the last 50 lines of `AIMemory/work.log`.
4. Check for an orphan `WORK_START`; if one exists, ask the user whether to
   resume or continue uninstalling.

If `AIMemory/INSTALLATION.md` is present, use it as the source of truth.

If it is absent, use **legacy fallback mode**:

- Remove only canonical `agent-work-mux` or legacy `agent-work-mem` sentinel
  blocks that are obviously bounded.
- Do not guess at arbitrary reminders.
- Append a `NOTE` explaining that uninstall used fallback mode because
  `INSTALLATION.md` was missing.

### Task 3 - Read managed harness blocks

In `AIMemory/INSTALLATION.md`, inspect `harness_files_modified`.

Each entry must include:

```text
path: <relative path>
format: <markdown | yaml | json | toml | text>
sentinel_hash: <sha256 or unknown>
line_range: <start-end or unknown>
purpose: <one line>
```

Managed blocks use this canonical shape:

```text
<!-- agent-work-mux:start sha256=<hash> -->
<managed reminder text>
<!-- agent-work-mux:end -->
```

For non-markdown files, use the comment delimiter native to the file format
when the block was installed, but keep the same `agent-work-mux:start` and
`agent-work-mux:end` tokens.

For projects installed before the rename, also recognize
`agent-work-mem:start` and `agent-work-mem:end` as legacy managed tokens.

### Task 4 - Remove only matching managed blocks

For each managed file:

1. Read the current file.
2. Locate the sentinel block.
3. Recompute the block hash excluding the hash value itself.
4. If the hash matches, remove the whole sentinel block.
5. If the hash does not match, do not edit that file. Report the mismatch and
   ask the user whether to preserve it or manually inspect it.

If the file no longer exists, record it as already absent.

### Task 5 - Optional runner-local cleanup

If `.agent-work-mux/` or legacy `.agent-work-mem/` exists, ask:

> Local AgentWorkMux runner state contains machine-local config/logs. Remove it too?

Only remove it when the user explicitly answers yes. Never remove it silently.

### Task 6 - Update lifecycle metadata

If `AIMemory/INSTALLATION.md` exists, append an uninstall record to its
`lifecycle_history` or `reinstall_history` section without deleting prior
records.

If the file does not exist, do not create a detailed fake history. The
`UNINSTALLED` event in `work.log` is enough for legacy fallback.

### Task 7 - Append `UNINSTALLED`

Append one event to `AIMemory/work.log`:

```text
### YYYY-MM-DD HH:MM | <model-id> | UNINSTALLED
Files removed: <paths or none>
Files preserved: AIMemory/ preserved; <other paths>
Sentinel hashes removed: <hashes or fallback mode>
Reason: <user request | reinstall | migration | other>
```

If no files were changed because all sentinel checks failed, use status
`blocked` in your final response and explain what needs user review.

### Task 8 - Confirm

Reply with:

- Files modified
- Files preserved
- Any sentinel mismatches
- Whether `.agent-work-mux/` or legacy `.agent-work-mem/` was removed or preserved
- One-line reinstall hint:

```text
To reinstall, fetch prompt.md and run it again; existing AIMemory will be reused.
```

## Reinstall path

Reinstall is handled by `prompt.md`, not this uninstall prompt. When a later
bootstrap detects existing `AIMemory/INSTALLATION.md`, it MUST reuse existing
memory, refresh managed reminder blocks, append `RE_INSTALLED`, and update
`reinstall_history`.
