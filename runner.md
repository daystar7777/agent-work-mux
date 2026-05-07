# AgentWorkMux v3 CLI Runner Spec

This file is lazy-loaded. Do not read or copy it into an active agent context
unless the user invoked an explicit `/awm` command that requires runner
behavior, such as `/awm goal`, `/awm run`, or `/awm status`.

The runner is a local CLI design. MCP is deferred. The protocol remains
markdown-first; the runner consumes and writes markdown state instead of
replacing it.

## Non-negotiable trigger rule

Headless execution MUST require an explicit `/awm` command. Plain natural
language may ask an agent to plan, hand off, or continue manually, but it must
not dispatch headless workers.

Examples that may use the runner:

```text
/awm goal "Ship the auth hardening slice. Claude implements, Codex reviews."
/awm run "run tests and summarize failures" codex
/awm goal status auth-hardening-20260507
```

Examples that must not start headless dispatch:

```text
Ship the auth hardening slice.
Have Claude implement this later.
Can another agent review this?
```

## Command surface

```text
/awm setup
/awm agents
/awm agents add <description> [--as <alias>] [--selector <agent[:model-or-tier[:profile]]>] [--capabilities <tags>]
/awm agent add <alias> <selector-or-description> [--capabilities <tags>]
/awm agents test [--all | <agent-selector>] [--smoke] [--live]
/awm agents hints [agent-selector]
/awm goal <goal request> [--policy <policy>] [--with <agents>]
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

The chat-facing command namespace is `/awm`. A local executable may be named
`awm`, but the protocol command is `/awm`.

`/awm setup` creates or updates the project-safe routing and lifecycle files:
`AIMemory/INSTALLATION.md`, `AIMemory/AGENTS.md`, and `AIMemory/goals/`.
It may add `AIMemory/RUNNER.md` only as a short project runner pointer.
Executable paths, account names, tokens, and local commands belong in ignored
`.agent-work-mux/` overrides or environment variables, and setup must ask
before writing those local overrides. Setup never dispatches workers.

`/awm agents add` and its singular shortcut `/awm agent add` register
project-scoped aliases in `AIMemory/AGENTS.md`. The plural form may infer the
alias from a description. The singular form treats the first argument after
`add` as the alias. These examples should all resolve to the same selector:

```text
/awm agents add 오픈코드의 딥시크        -> opencode-deepseek -> opencode:deepseek:auto
/awm agent add 딥시크 오픈코드:딥시크   -> 딥시크 -> opencode:deepseek:auto
/awm agent add 딥시크 오픈코드의 딥시크 -> 딥시크 -> opencode:deepseek:auto
```

The command only updates routing metadata. It must not claim the worker is
callable until `/awm agents test <alias> --smoke` passes.

`/awm agents test` lazy-loads `agent-call-probe.md` and verifies configured
worker invocations. It stores raw logs in ignored `.agent-work-mux/probes/`,
updates compact hints in `AIMemory/AGENTS.md`, and records local details in
`.agent-work-mux/agents.local.md`. Guarded CLIs such as Codex CLI, Claude CLI,
and Gemini CLI are check-only by default: verify version and non-prompt auth
state where available, but do not send live prompts unless the user explicitly
asks for actual execution or uses `--live`. This avoids recursive same-family
calls such as Codex invoking Codex CLI, Claude invoking Claude CLI, or
Antigravity/Gemini invoking Gemini CLI by default.

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

`/awm agents hints` reads those hints without calling agents.

`/awm goal` defaults to auto-run after parsing and planning. Before dispatch,
the active orchestrator must create or update the goal record and show enough
of the parsed plan that the user can pause or stop from that active session.

Goal creation accepts either a quoted request or an unquoted shorthand:

```text
/awm goal "<natural language request>"
/awm goal Ship the auth hardening slice. Claude implements, Codex reviews.
```

Parse `/awm goal` by checking the first token after `goal`:

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

Legacy aliases:

```text
/awm goals            -> /awm goal list
/awm status --all     -> /awm goal list
/awm status <goal-id> -> /awm goal status <goal-id>
/awm pause <goal-id>  -> /awm goal pause <goal-id>
/awm resume <goal-id> -> /awm goal resume <goal-id>
```

## Dynamic goal mechanics

The runner uses a Codex-style goal loop adapted to markdown state:

1. **Active goal cursor** - `AIMemory/goals/ACTIVE.md` points to the current
   goal, state, last completed task, next checkpoint, and final-report status.
2. **Goal history ledger** - `AIMemory/goals/INDEX.md` lists current and
   previous goals. It is lazy-read for `/awm goal list`, `/awm status --all`,
   or user questions about historical goal state.
3. **Goal contract object** - the goal record is the durable contract: objective,
   tasks, worker assignments, policy, state, telemetry, results, errors, and
   completion guard.
4. **State gate** - dispatch is allowed only while the goal state is `active`.
   `awaiting_user`, `paused`, and `error_paused` stop auto-run immediately.
5. **Budget/telemetry loop** - after every task, update compact counters,
   checkpoints, and raw-log pointers without loading raw transcripts.
6. **Completion guard** - mark `complete` only after all tasks are resolved,
   errors are fixed or documented, verification is recorded, and the final
   report exists.

## Files and trust boundaries

Safe project-scoped markdown:

```text
AIMemory/INSTALLATION.md
AIMemory/AGENTS.md
AIMemory/goals/ACTIVE.md
AIMemory/goals/INDEX.md
AIMemory/goals/<goal-id>.md
AIMemory/RUNNER.md          # optional project runner notes, lazy-loaded
```

Private machine-local state, ignored by git:

```text
.agent-work-mux/config.local.json
.agent-work-mux/agents.local.md
.agent-work-mux/runs/<goal-id>/
.agent-work-mux/tmp/
```

Rules:

- `AIMemory/AGENTS.md` may contain aliases, model tiers, profiles,
  capabilities, default verification policy, and environment variable names.
- `AIMemory/AGENTS.md` must not contain credentials, auth tokens, private
  absolute machine paths, or shell commands containing secrets.
- Local executable paths, account names, provider tokens, and per-machine
  auth belong under `.agent-work-mux/` or environment variables.
- Raw worker transcripts and command output belong under
  `.agent-work-mux/runs/<goal-id>/`, not in `AIMemory/work.log` or the main
  orchestrator context.
- If a project enables the runner, update `AIMemory/INSTALLATION.md`
  `runner_declaration` with the runner name/version. Do not put local paths or
  credentials there.

## Agent selector grammar

```text
<agent>[:<model-or-tier>[:<profile>]]
```

Examples:

```text
claude
claude:opus-4.7:max
gemini:pro
codex:gpt-5-codex
deepseek:coder:local
```

Resolution order:

1. Exact alias in `AIMemory/AGENTS.md`
2. Base agent name in `AIMemory/AGENTS.md`
3. Local override in `.agent-work-mux/agents.local.md`
4. Orchestrator choice by task difficulty if only an agent name was supplied
5. Ask the user if resolution is ambiguous or impossible

Aliases are project-scoped. Local-language nicknames are allowed if they are
stored in `AIMemory/AGENTS.md` and resolve to a safe selector.

## Agent registration

`/awm agents add <description>` and
`/awm agent add <alias> <selector-or-description>` update the `Project aliases`
table in `AIMemory/AGENTS.md`. They never dispatch workers.

Parsing rules:

1. Preserve the user's original command or description in the Notes cell.
2. `/awm agent add` is a singular shortcut. The first token after `add` is the
   alias, and the remaining text is the selector or natural-language
   description. Local-language aliases such as `딥시크` are allowed.
3. If `--selector` is provided, use it after validating the
   `<agent>[:<model-or-tier>[:<profile>]]` shape.
4. If `--as` is provided, use that alias. ASCII slugs are preferred for
   cross-tool ergonomics, but local-language nicknames are allowed when the user
   asks for them.
5. Normalize selector-like text before validation. For example,
   `오픈코드:딥시크` becomes `opencode:deepseek:auto`.
6. Without flags, infer a selector from known public words, including:
   `opencode`, `open code`, `오픈코드` -> `opencode`;
   `continue`, `cn`, `컨티뉴` -> `continue`;
   `aider`, `에이더` -> `aider`;
   `deepseek`, `딥시크` -> `deepseek`;
   `claude`, `클로드` -> `claude`;
   `codex`, `코덱스` -> `codex`;
   `gemini`, `제미나이` -> `gemini`.
7. When both a runner and a model/provider are inferred, default to
   `<runner>:<model-or-tier>:auto` and alias `<runner>-<model-or-tier>`.
8. When only one agent name is inferred, default to `<agent>:auto:auto` and
   alias `<agent>`.
9. If the result would overwrite an existing alias with a different selector,
   ask before replacing it.
10. If inference is ambiguous, ask for `--as` or `--selector`.

Default capability hints are conservative: `opencode`, `continue`, `aider`,
`claude`, and `codex` get `filesystem-read, filesystem-write, shell-exec`;
`gemini` gets `filesystem-read, web-search, image-input`; unknown agents get
`unknown` until tested. These capability hints do not authorize live guarded
CLI dispatch; Codex, Claude, and Gemini CLI still require an explicit user
request before prompt execution. Add a note such as `Registered from "/awm agent add
딥시크 오픈코드의 딥시크"; run /awm agents test 딥시크 --smoke before dispatch.`

## Goal record schema

Goal files live at:

```text
AIMemory/goals/<goal-id>.md
```

The active cursor lives at:

```text
AIMemory/goals/ACTIVE.md
```

`ACTIVE.md` is intentionally small. It contains the current `goal-id`, state,
orchestrator, last completed task, next checkpoint, compact telemetry summary,
raw-log root pointer, and whether the final report has been written.

The goal ledger lives at:

```text
AIMemory/goals/INDEX.md
```

It is a lazy-read status dashboard for previous and current goals. The runner
updates the row for a goal on create/update/complete. Normal sessions do not
need to load it unless the user asks for goal history or invokes
`/awm goal list` or `/awm status --all`.

Required ledger columns:

```markdown
| Goal-id | Objective | State | Created | Updated | Completed | Orchestrator | Policy | Tokens | Cost | Final report | Record |
|---------|-----------|-------|---------|---------|-----------|--------------|--------|--------|------|--------------|--------|
```

Token and cost fields are best-effort:

- Use exact worker/runner-reported values when available.
- Use `estimated:<value>` only when the estimate method is clear.
- Use `unknown` when the worker does not report usage.
- Do not load raw transcripts just to compute token totals.

Required fields:

```markdown
# Goal: <short title>

**Goal-id**: <slug-date-or-uuid>
**Objective**: <one-sentence objective>
**Created**: <ISO-8601>
**Updated**: <ISO-8601>
**Created by**: <model-id>
**Orchestrator**: <model-id @ harness>
**State**: <active | awaiting_user | paused | error_paused | stopped | complete>
**Auto-run**: true
**Policy**: <single_agent | implement_then_verify | custom>
**Budget hint**: <none | user-provided token/time/cost hint>
**Raw-log root**: .agent-work-mux/runs/<goal-id>/

## User request
<verbatim or compact quote>

## Parsed plan
| Task | Agent selector | Resolved agent | Status | Result |
|------|----------------|----------------|--------|--------|

## Results
<compact task results and artifact paths>

## Errors
<compact errors, exit codes, and pointers to raw logs>

## Telemetry
- Tasks total: <n>
- Tasks complete: <n>
- Token usage: <input/output/total or unknown>
- Token source: <reported | estimated | unknown>
- Cost: <amount/currency or unknown>
- Last checkpoint: <short text>
- Compact result bytes: <rough size or unknown>
- Raw logs loaded into orchestrator: <none | explicit debug reason>

## Completion guard
- [ ] Every parsed task is complete, skipped with reason, or blocked with final disposition.
- [ ] Errors are fixed, documented, or accepted by the user.
- [ ] Required verification is recorded.
- [ ] Final report is written.
- [ ] ACTIVE.md is cleared or points to the completed goal.

## Final report
<one integrated orchestrator report when complete>
```

Do not store verbose transcripts in the goal record.

Required states:

- `active` - planned or running
- `awaiting_user` - blocked on user choice
- `paused` - intentionally paused
- `error_paused` - error occurred; no auto-run until resolved
- `stopped` - user intentionally stopped the goal; terminal unless restarted
- `complete` - final report written

## RTK-style token isolation

The runner must isolate raw output from the main agent context.

Worker output pipeline:

1. Worker writes raw transcript/stdout/stderr to
   `.agent-work-mux/runs/<goal-id>/<task-id>/`.
2. Runner extracts a compact result:
   - status
   - files changed
   - commands run
   - test results
   - blocking errors
   - artifact paths
3. Orchestrator reads the compact result, not the raw transcript by default.
4. Orchestrator writes compact results/errors into
   `AIMemory/goals/<goal-id>.md`.
5. Orchestrator appends `GOAL_UPDATED`, `RUNNER_RESULT`, or
   `GOAL_COMPLETED` events to `work.log`.

Raw logs may be loaded only on explicit debug need, and then only the relevant
snippet should be summarized back into the goal record.

## Verification policy

Implementer/verifier separation is user-selectable. It is not mandatory.

Suggested policies:

```text
single_agent
implement_then_verify
parallel_review
custom
```

The default is `single_agent` unless the user or `AIMemory/AGENTS.md` selects
another policy.

## Minimal runner loop

1. Parse the explicit `/awm` command.
2. Resolve aliases/selectors.
3. Create or update the goal contract and `AIMemory/goals/ACTIVE.md`.
4. Create or update the goal's row in `AIMemory/goals/INDEX.md`.
5. Show the parsed plan in the active orchestrator session.
6. Dispatch tasks only if auto-run is true and state remains `active`.
7. Keep raw logs in `.agent-work-mux/runs/`.
8. Return compact summaries/errors/results to the orchestrator.
9. Update telemetry, the resume checkpoint, and the ledger row after each task.
10. Stop on `awaiting_user`, `paused`, or `error_paused`.
11. Run the completion guard.
12. Write one integrated final report, mark `complete`, and update `ACTIVE.md`
    plus the ledger row.

## Goal history commands

`/awm goal list` reads `AIMemory/goals/INDEX.md` and prints a compact table of
previous and current goals. Support `--state <state>` and `--limit <n>` as
filters. Newest updated goals should appear first.

`/awm goal history [goal-id]` shows the goal ledger row plus compact lifecycle
events for that goal. With no id, show recent goal history from the ledger.

`/awm goal status` without an id shows `ACTIVE.md` plus the current goal record.
`/awm goal status <goal-id>` shows that goal's record and final report link.

`/awm goal stop <goal-id>` sets state to `stopped`, records a stop summary, and
updates `ACTIVE.md` and the ledger. It must not be treated as `complete`.

`/awm goal clear` clears the active cursor by default. `--completed`,
`--stopped`, and `--all` fold or hide ledger rows by policy, but must not delete
goal records unless paired with an explicit destructive confirmation.

Legacy aliases: `/awm goals` and `/awm status --all` map to `/awm goal list`.
