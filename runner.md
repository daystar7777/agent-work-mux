# AgentWorkMux v3 CLI Runner Spec

This file is lazy-loaded. Do not read or copy it into an active agent context
unless the user invoked an explicit `/awm` command or made a clear natural
language AgentWorkMux request that requires runner behavior.

The runner is a local CLI design. MCP is deferred. The protocol remains
markdown-first; the runner consumes and writes markdown state instead of
replacing it.

## Natural Language Trigger Rule

New goal orchestration is the only AWM command that MUST use an explicit goal
command form: `/awm goal <request>` or `/awm goals <request>`. All other AWM
commands may be invoked by clear natural language, including setup, uninstall,
agent listing, agent registration, agent tests, hint lookup, run, and handoff
requests. Guarded CLI live-run rules still apply: Codex CLI, Claude CLI, and
Gemini CLI must not receive live prompts unless the user explicitly asks for
that execution or uses `--live`.

Examples that may use the runner from explicit command text:

```text
/awm goal "Ship the auth hardening slice. Claude implements, Codex reviews."
/awm goals "Ship the auth hardening slice. Claude implements, Codex reviews."
/awm run "run tests and summarize failures" codex
/awm goal status auth-hardening-20260507
```

Examples that may use the runner from natural language:

```text
AgentWorkMux setup 다시 해줘.
등록된 agents 목록 보여줘.
오픈코드의 딥시크를 agent로 등록해줘.
모든 agents를 smoke test 해줘.
기존 agent hints만 보여줘.
opencode로 테스트 실행하고 요약해줘.
```

Examples that must not create a new goal:

```text
Ship the auth hardening slice.
Have Claude implement this later.
Can another agent review this?
```

For those broad goal-like requests, ask the user to use `/awm goal ...` or
`/awm goals ...` if they want goal-level orchestration.

## Command surface

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

The chat-facing command namespace is `/awm`. A local executable may be named
`awm`, but the protocol command is `/awm`.

`/awm setup` creates or updates the project-safe routing and lifecycle files:
`AIMemory/INSTALLATION.md`, `AIMemory/AGENTS.md`, and `AIMemory/goals/`.
It may add `AIMemory/RUNNER.md` only as a short project runner pointer.
Executable paths, account names, tokens, and local commands belong in ignored
`.agent-work-mux/` overrides or environment variables, and setup must ask
before writing those local overrides. Setup never dispatches workers.

Runner helper code remains markdown-first and lazy-materialized. Canonical helper
source lives in tracked `*.js.md` markdown helper specs, not in bare executable
source files. Each helper spec contains generation notes, OS/runtime differences,
validation rules, and extractable OS-specific code blocks. `/awm setup`, `/awm
agents test`, or the first runner command that needs helpers may extract those
specs into ignored local runtime files under `.agent-work-mux/bin/` after
detecting the host OS and available runtimes. Generated helpers should use the
host default shell first: PowerShell plus an optional `.cmd` shim on Windows,
POSIX `sh` on Unix-like systems, and `bash`, Node, .NET, or another runtime only
as an explicit setup/probe-selected fallback. Generated helpers must include
source file, block id, version, and SHA-256 metadata. Once generated and
self-tested, helpers are treated as stable local runtime artifacts. Do not keep
changing worker prompts to regenerate helpers during goal execution or benchmark
reruns. If a helper is missing or stale, run the explicit helper
onboarding/setup flow before dispatch.

`/awm agents` and `/awm agents list` read `AIMemory/AGENTS.md` and print the
registered aliases plus the latest compact call hints. Natural language such
as "registered agents 보여줘" maps here without testing or dispatching workers.

`/awm agents add` and its singular shortcut `/awm agent add` register
project-scoped aliases in `AIMemory/AGENTS.md`. The plural form may infer the
alias from a description. The singular form treats the first argument after
`add` as the alias. Registration should also ensure the stable helper runtime is
materialized and create the alias launch prototype, or mark the alias
`helper_onboarding_required` / `launch_profile_missing` if helper
generation/self-test cannot run yet. These examples should all resolve to the
same selector:

```text
/awm agents add 오픈코드의 딥시크        -> opencode-deepseek -> opencode:deepseek:auto
/awm agent add 딥시크 오픈코드:딥시크   -> 딥시크 -> opencode:deepseek:auto
/awm agent add 딥시크 오픈코드의 딥시크 -> 딥시크 -> opencode:deepseek:auto
```

The command updates routing metadata and creates local helper/launch prototypes,
but it must not claim the worker is callable until `/awm agents test <alias>
--smoke` passes. It must not dispatch the worker during registration unless the
user explicitly requested a live test.

`/awm agent refresh <alias>` is the explicit way to regenerate an existing
alias's launch prototype after an agent CLI, model tier, provider setting, OS
runtime, or helper ABI changes. Refresh must not happen silently during `/awm
goal`; if a required helper or launch profile is stale, the controller asks the
user to run the explicit refresh/setup command and pauses dispatch. A refresh
updates the local prototype and marks the capsule handshake as stale until
`/awm agents test <alias> --smoke` passes again, unless the user also requested a
live/smoke refresh flow.

`/awm agents test` lazy-loads `agent-call-probe.md` and verifies configured
worker invocations. It stores raw logs in ignored `.agent-work-mux/probes/`,
updates compact hints in `AIMemory/AGENTS.md`, and records local details in
`.agent-work-mux/agents.local.md`. Guarded CLIs such as Codex CLI, Claude CLI,
and Gemini CLI are check-only by default: verify version and non-prompt auth
state where available, but do not send live prompts unless the user explicitly
asks for actual execution or uses `--live`. This avoids recursive same-family
calls such as Codex invoking Codex CLI, Claude invoking Claude CLI, or
Antigravity/Gemini invoking Gemini CLI by default.

When `--smoke` or `--live` is allowed, agent onboarding should include a capsule
handshake probe, not only an `OK` text response. The probe uses the generated
local launcher and watcher helpers to precreate runner-owned directories, ask
the agent to write a skeleton capsule into an existing parent directory, verify
same-directory temp+rename writes, and confirm missing/malformed capsule
classification. An alias is dispatch-ready only after its headless invocation and
capsule handshake both pass.

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
This pre-dispatch view is a compact dispatch preview, not a long approval gate.
Auto-run remains the default, but the preview is the last user-visible
checkpoint before the first worker launch.

Goal creation accepts either a quoted request or an unquoted shorthand:

```text
/awm goal "<natural language request>"
/awm goals "<natural language request>"
/awm goal Ship the auth hardening slice. Claude implements, Codex reviews.
/awm goals Ship the auth hardening slice. Claude implements, Codex reviews.
```

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

Legacy aliases:

```text
/awm goals            -> /awm goal list
/awm goals <request>  -> /awm goal <request>
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

## Pre-dispatch preview

Before launching the first worker for a new `/awm goal`, the controller must
show one compact dispatch preview in the active session. This is the planning
contract the user can interrupt, not an extra approval step. If the user does
not stop or revise it, auto-run continues.

Required preview fields:

```text
Goal: <short objective>
Output root: <workspace/output boundary>
Policy: <single_agent | implement_then_verify | deepseek_build_verify_codex_fix | custom>

Design:
- <component boundary 1>
- <component boundary 2>
- <integration rule / e2e acceptance>

Phases:
1. <phase name>
   Worker: <agent selector>
   Scope: <files/directories or responsibility>
   Expected capsule: <result.json/verdict.json path>
   Timeout: <startup/runtime/finalization limits>

Quality gates:
- <hard fail gate>
- <warning gate or score threshold>

Controller boundary:
- <what the controller owns>
- <what verifier/tester owns>
```

Rules:

- Keep the preview compact enough to fit in the main context without raw worker
  prompts or transcripts.
- Show phase-by-phase worker/verifier assignments, including model/tier when it
  was resolved.
- Include the output boundary and "do not edit outside this scope" rule when the
  goal writes files.
- Include capsule paths and timeout policy so launch/capsule failures can be
  diagnosed without guessing.
- For code goals, summarize the Quality contract and Integration contract before
  dispatch. Do not hide those contracts only inside worker prompts.
- The preview may say "Auto-run continuing unless stopped" but should not wait
  for approval unless the user asked for approval mode or the plan is ambiguous.
- If the user corrects the preview before dispatch, update the goal record and
  preview again before launching.

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
.agent-work-mux/bin/
.agent-work-mux/helpers/
.agent-work-mux/probes/
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
- Generated helper files under `.agent-work-mux/bin/` are cache artifacts, not
  protocol source. Do not edit them directly; update the tracked `*.js.md`
  helper spec and rerun `/awm setup` or the relevant probe.

## Markdown-sourced local helpers

The repository remains markdown-first. Executable runner helpers are generated
from markdown during onboarding and are never the canonical project source.

Canonical helper source files:

```text
helpers/awm-launch.js.md
helpers/awm-watch.js.md
helpers/awm-helper-self-test.js.md
helpers/awm-capsule-probe.js.md
```

Each `*.js.md` helper source file must contain this structure. The `js.md`
suffix marks the tracked script-spec markdown source; it does not require the
generated helper to be JavaScript:

- `# <helper logical name>`
- `## Purpose`
- `## Stable ABI`
- `## Generation notes`
- `## OS/runtime differences`
- `## Validation rules`
- `## Source code` with extractable OS-specific fenced blocks. Required block
  ids are `powershell`, `cmd-shim`, `posix-sh`, and optional `bash` or `node-js`
  fallback blocks when they are justified by the current environment.

Generated local runtime:

```text
.agent-work-mux/bin/awm-launch[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-watch[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-helper-self-test[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-capsule-probe[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/helpers/manifest.json
```

Generation rules:

- `/awm setup` detects OS, shell availability, optional runtimes, and path
  semantics, then extracts the matching `## Source code` blocks from `*.js.md`
  specs into `.agent-work-mux/bin/`.
- The default helper implementation must avoid new external runtime
  dependencies. On Windows, generate PowerShell helpers and a `.cmd` shim when a
  stable command name or execution-policy workaround is needed. On Unix-like
  systems, generate POSIX `sh` helpers first and use `bash` only when the
  feature matrix explicitly requires it. Node/.NET helpers are optional
  fallbacks only when already available and selected by setup/probe.
- Windows `.cmd` files are shims, not alternate ABI definitions. Internal
  runner calls should record and invoke the real helper entrypoint with explicit
  arguments, for example `powershell.exe -NoProfile -File <helper.ps1> ...`,
  rather than relying on `shell: true` or free-form shell text.
- Every generated helper starts with metadata naming its source markdown file,
  block id, source hash, generated timestamp, and "do not edit directly" notice.
- `.agent-work-mux/helpers/manifest.json` records the source hashes and self-test
  results. The manifest is local and ignored; `AIMemory/AGENTS.md` may record
  only compact pass/fail capability facts.
- If a helper is missing, stale, or fails self-test, real worker dispatch is
  blocked before a model-backed worker starts. Regeneration belongs to explicit
  setup/upgrade/probe onboarding, not to a normal worker prompt.
- Setup self-tests helper generation without calling model-backed workers.
  Agent-specific live/capsule behavior is tested by `/awm agents test ...`.
- Helper generation prompts must contain the full generation, test, and
  verification contract. They must finish by writing a compact local helper test
  report that says which OS/runtime features passed, failed, or are unsupported.

Helper lifecycle:

1. **Lazy materialization** - Do not generate or load helper code during ordinary
   sessions. Generate only for explicit setup, agent registration/probe, or
   first runner onboarding. Prefer agent-registration generation over per-goal
   generation so benchmark prompts do not change the helper runtime.
2. **Stable after generation** - After helpers are generated and self-tested,
   goal prompts must use the existing helpers. Do not mutate prompts or helper
   source mid-goal to force a different generated executable.
3. **Stale hash gate** - If the markdown source hash differs from the helper
   manifest, mark the helper `stale` and block dispatch until the user runs an
   explicit setup/upgrade/probe command. Do not regenerate implicitly from a goal
   prompt.
4. **Environment feature matrix** - The generation/test prompt must verify every
   required feature for the current OS shell/runtime before marking the helper
   usable. Unsupported required features are hard failures, not warnings.
5. **Local-only binaries** - Generated helpers, manifests, and probe reports stay
   under ignored `.agent-work-mux/`; only compact capability summaries belong in
   `AIMemory/`.
6. **Stable helper ABI** - Generated helper names, locations, subcommands, exit
   codes, stdout JSON shapes, and accepted parameters are fixed by this spec.
   The generator must not invent, rename, remove, or reorder required CLI
   parameters for the current version. If a helper cannot implement the declared
   ABI on the current OS/runtime, helper onboarding fails.
7. **Stable path ABI** - Absolute roots may vary by project, workspace, OS, or
   task output directory, but the relative directory/file structure under those
   roots is a fixed control surface. Generators, workers, verifiers, and fixers
   must not rename protocol-defined path segments or choose "equivalent"
   alternates. If a required relative structure cannot be created or written on
   the current OS/runtime, setup/probe/dispatch fails.
8. **Shared role contract** - The helper ABI and path ABI are shared by generated
   helper programs, workers, verifiers, testers, fixers, and controllers. Every
   prompt and generated helper must use the same names, parameters, and relative
   path layout.
9. **Controller precreates directories** - By default, the controller/launcher
   precreates all runner-owned directories for every phase before dispatch.
   Workers, verifiers, testers, and fixers write files into those prepared
   directories; they do not create runner-owned directories themselves.

Stable helper names and call contracts:

```text
.agent-work-mux/bin/awm-launch[.cmd|.ps1|.sh|.js|native]
  awm-launch <launch.json>

.agent-work-mux/bin/awm-watch[.cmd|.ps1|.sh|.js|native]
  awm-watch --run-dir <dir> --expected-capsule <file> --attempt-id <id> --timeout-ms <n> --idle-ms <n> --json

.agent-work-mux/bin/awm-helper-self-test[.cmd|.ps1|.sh|.js|native]
  awm-helper-self-test --manifest <file> --json

.agent-work-mux/bin/awm-capsule-probe[.cmd|.ps1|.sh|.js|native]
  awm-capsule-probe --agent <selector> --run-dir <dir> --expected-capsule <file> --timeout-ms <n> --json
```

Parameter contract rules:

- Required parameter names are exact and case-sensitive in docs and manifest.
- The generator may add OS-specific wrapper extensions, but the logical command
  names above stay stable.
- Required positional/flag semantics must not change between helper generations
  in the same protocol version.
- Optional parameters must be additive and documented in markdown before use.
- All helpers with `--json` write one compact JSON object to stdout and return
  `0` only for a successful helper-level operation. A task failure such as
  `TIMEOUT_MISSING_CAPSULE` is encoded in JSON `status` and may return non-zero
  when the helper is the launcher of record.
- The helper manifest records `abi_version`, helper names, supported parameters,
  source hashes, self-test results, and the exact command lines used for
  self-test.

Registration-time prototypes:

```text
.agent-work-mux/helpers/agents/<alias>/launch-profile.json
.agent-work-mux/helpers/agents/<alias>/capsule-probe-profile.json
.agent-work-mux/helpers/agents/<alias>/README.local.md
```

Prototype rules:

- Agent registration creates prototype files for a new alias without calling the
  model-backed worker.
- Existing prototype refresh requires the explicit `/awm agent refresh <alias>`
  command. Prototype refresh must never happen silently during goal planning or
  dispatch.
- Prototypes store the stable agent invocation shape, required env names,
  supported `stdio_mode`, `prompt_mode`, model/tier normalization, and known
  platform requirements. They must include `profile_version`, helper ABI version,
  generated timestamp, generator identity, and a stable hash of the normalized
  prototype. They must not contain secrets.
- Prototype files are locked local runtime artifacts. A controller must not
  silently rewrite them during goal planning or dispatch.
- Per-task `launch.json` files are still generated for each task because `cwd`,
  prompt file, output paths, expected capsule, attempt id, and timeout vary.
  However, they must be derived from the registered prototype plus the fixed path
  ABI, not improvised in the goal prompt.
- `/awm agents test <alias> --smoke` validates the prototype against the actual
  worker and records compact pass/fail facts. A prototype alone is not a
  dispatch-ready worker.

Stable runner path contract, relative to the project root or task run root as
shown:

```text
AIMemory/
AIMemory/INSTALLATION.md
AIMemory/AGENTS.md
AIMemory/RUNNER.md
AIMemory/goals/
AIMemory/goals/ACTIVE.md
AIMemory/goals/INDEX.md
AIMemory/goals/<goal-id>.md
AIMemory/work.log

.agent-work-mux/
.agent-work-mux/bin/
.agent-work-mux/helpers/
.agent-work-mux/helpers/manifest.json
.agent-work-mux/probes/
.agent-work-mux/runs/<goal-id>/<task-id>/
.agent-work-mux/runs/<goal-id>/<task-id>/launch.json
.agent-work-mux/runs/<goal-id>/<task-id>/prompt.txt
.agent-work-mux/runs/<goal-id>/<task-id>/stdout.jsonl
.agent-work-mux/runs/<goal-id>/<task-id>/stderr.log
.agent-work-mux/runs/<goal-id>/<task-id>/warnings.jsonl
.agent-work-mux/runs/<goal-id>/<task-id>/critical-error.json
.agent-work-mux/runs/<goal-id>/<task-id>/diagnostics.json
.agent-work-mux/runs/<goal-id>/<task-id>/controller_status.json
.agent-work-mux/runs/<goal-id>/<task-id>/pid.json
.agent-work-mux/runs/<goal-id>/<task-id>/heartbeat.json
.agent-work-mux/runs/<goal-id>/<task-id>/watch.json
.agent-work-mux/runs/<goal-id>/<task-id>/result.json      # implementer/fixer only
.agent-work-mux/runs/<goal-id>/<task-id>/verdict.json     # verifier/tester only
.agent-work-mux/runs/<goal-id>/metrics/
.agent-work-mux/runs/<goal-id>/metrics/summary.json
.agent-work-mux/tmp/
```

Path contract rules:

- Absolute prefixes such as `C:\...`, `/home/...`, or a selected goal output
  root are environment-specific and may vary. The relative structure under
  `AIMemory/` and `.agent-work-mux/` must not vary.
- This contract applies equally to generated helper programs, controller,
  worker, verifier, tester, and fixer roles. A role that cannot write to the
  expected fixed location must report failure instead of choosing a new name or
  path.
- When a goal uses a nested output root, the protocol is anchored at that root.
  For example, if work is isolated under `testprj001/phase001/`, then the
  runner-owned files for that phase must be in predictable locations such as
  `testprj001/phase001/.agent-work-mux/runs/<goal-id>/<task-id>/launch.json`,
  `.../result.json`, `.../verdict.json`, `.../watch.json`, and
  `testprj001/phase001/.agent-work-mux/runs/<goal-id>/metrics/summary.json`.
  A worker may not move those files to a different sibling directory or invent
  alternate names.
- `launch.json` may contain absolute paths for the current machine, but when a
  value refers to runner-owned artifacts it must resolve to the fixed relative
  names above. Custom paths are allowed only for app-owned artifacts unless a
  future protocol version changes the path ABI.
- Implementer tasks write `result.json`; verifier/tester tasks write
  `verdict.json`; Codex fixer tasks write `result.json` under their own task id.
- Watcher and launcher outputs use the fixed names above. A missing fixed file is
  meaningful and must not be silently mapped to a different filename.
- Path ABI changes require a protocol version bump and migration notes. They are
  not per-run choices.

Default task id contract:

```text
implement      broad implementation worker
verify         verifier/tester after implementation
fix_codex      in-session Codex narrow fixer
verify_final   verifier/tester after a fix round
```

The controller may introduce additional task ids only when the goal genuinely
needs extra phases. It must declare the task id map in the dispatch preview and
goal record before launch, use stable `[A-Za-z0-9_]+` slugs, precreate the
corresponding runner-owned directories, and pass the map as context to every
worker/verifier/tester/fixer. Task ids are not improvised by workers.

Shared helper / per-phase config split:

- Generated helper binaries and alias launch prototypes are shared project-local
  runtime artifacts under the project `.agent-work-mux/bin/` and
  `.agent-work-mux/helpers/` roots.
- Per-goal and per-phase config/status lives under the selected output/run root,
  for example `<output-root>/.agent-work-mux/runs/<goal-id>/<task-id>/launch.json`
  and `<output-root>/.agent-work-mux/runs/<goal-id>/<task-id>/watch.json`.
- A nested output root such as `testprj001/phase001/` gets its own run config
  tree, but it reuses the shared helper binaries and registered alias prototype.

Minimum helper self-test matrix:

```text
all OS:
- structured JSON launch spec parsing
- no commandLine string execution
- cwd passed as process property
- parent directory precreation is recursive and idempotent
- expected capsule is observed but not precreated
- temp file plus same-directory rename works for compact JSON
- invalid capsule and missing capsule are classified
- watcher respects timeout and idle thresholds
- raw stdout/stderr are not read by default

Windows:
- paths containing spaces are preserved
- npm/global .cmd/.ps1 shims resolve to real executable/entrypoint
- shell:true is not used for wrappers
- OpenCode can use file-handle stdio redirection
- PowerShell bridge uses ProcessStartInfo.ArgumentList
- `mkdir -p` is never used for runner-owned paths
- User/Machine scoped required env hydration is supported when declared

POSIX-like:
- shell parsing is disabled for worker launch
- executable resolution does not require shell aliases
- signal/exit handling records compact status
- filesystem permissions and executable bits are verified when needed
```

Required local helper roles:

- `awm-launch` starts worker/verifier processes from `launch.json`, precreates
  runner-owned parent directories, resolves shims, injects timing/env metadata,
  and writes compact launch diagnostics.
- `awm-watch` observes an attempt for a bounded timeout and reports compact
  status from file mtimes, sizes, pid/heartbeat, `controller_status.json`,
  `diagnostics.json`, `critical-error.json`, and the expected capsule.
- The capsule handshake probe verifies that a candidate external agent can write
  an early skeleton capsule into an existing directory without creating
  runner-owned paths or relying on shell-specific aliases such as `mkdir -p`.

## Shell-free launch contract

Every worker, verifier, tester, and fixer dispatch should go through one runner
launch layer. The launch layer must receive structured process fields, not one
long shell command. This is required on Windows because workspace paths such as
`New project` are otherwise easy to split incorrectly before the worker starts.

Before starting a background task, write a launch spec:

```text
.agent-work-mux/runs/<goal-id>/<task-id>/launch.json
```

Minimum shape:

```json
{
  "version": 1,
  "goal_id": "markdown-notes-20260508",
  "task_id": "verify",
  "attempt_id": "verify-001",
  "role": "verifier",
  "cwd": "C:\\Users\\daystar\\Documents\\New project\\goal_test003",
  "cmd": "opencode",
  "resolve_shims": true,
  "prompt_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/verifier-prompt.txt",
  "prompt_mode": "inline",
  "stdio_mode": "file",
  "required_env": ["DEEPSEEK_API_KEY"],
  "args": [
    "run",
    "--model",
    "deepseek/deepseek-v4-flash",
    "--variant",
    "standard",
    "--format",
    "json",
    "--dangerously-skip-permissions",
    "{{awm_prompt_text}}\n\nUse AWM_TASK_STARTED_AT={{awm_task_started_at}} and AWM_DEADLINE_AT={{awm_deadline_at}} in your capsule metrics."
  ],
  "env": {
    "NO_COLOR": "1"
  },
  "stdout": ".agent-work-mux/runs/markdown-notes-20260508/verify/stdout.jsonl",
  "stderr": ".agent-work-mux/runs/markdown-notes-20260508/verify/stderr.log",
  "warnings_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/warnings.jsonl",
  "critical_error_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/critical-error.json",
  "diagnostics_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/diagnostics.json",
  "pid_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/pid.json",
  "heartbeat_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/heartbeat.json",
  "status_file": ".agent-work-mux/runs/markdown-notes-20260508/verify/controller_status.json",
  "expected_capsule": ".agent-work-mux/runs/markdown-notes-20260508/verify/verdict.json",
  "startup_timeout_ms": 60000,
  "timeout_ms": 1800000
}
```

Launch rules:

- The launcher implementation is generated from the markdown helper block
  `helpers/awm-launch.js.md` into ignored `.agent-work-mux/bin/` during setup.
  Any checked-out example file is illustrative only, not the source of truth.
- `cmd` and `args` are separate fields. `args` is an array of strings.
- Do not store or execute a `commandLine` string.
- On Windows, shell-free launchers must normalize CLI shims before spawn. If
  `cmd` resolves to an npm/global wrapper such as `opencode`, `opencode.cmd`, or
  `opencode.ps1`, resolve it to the real executable and entrypoint, for example
  `node.exe` plus `node_modules/opencode-ai/bin/opencode`. Do not fall back to
  `shell: true` just to run `.cmd`, `.bat`, or PowerShell wrappers.
- Record command resolution in status/diagnostics, including requested command,
  resolved command, shim path, and shim entrypoint when applicable.
- On Windows, OpenCode may hang when a Node launcher captures stdout/stderr via
  pipe streams even though the same command works with `Start-Process`
  redirection. Prefer `"stdio_mode": "file"` for OpenCode dispatch: connect
  stdout/stderr directly to file handles and poll file sizes for heartbeat
  counts instead of reading child pipes in the launcher process.
- For OpenCode worker prompts, prefer `prompt_file` plus
  `"prompt_mode": "inline"` and place `{{awm_prompt_text}}` in the normal
  positional message. Do not rely on "read this prompt file" as the main worker
  instruction for broad implementation tasks; a small file-read diagnostic can
  pass while the real dispatch still stalls without artifacts. Do not pass the
  worker prompt file through OpenCode `--file`; that flag is for workspace files
  and can consume a following message as another file argument. If `--file` is
  needed for source context, put the message before all `--file` args and keep
  the worker prompt itself inline in the main message.
- Declare provider secrets in `required_env`, for example
  `["DEEPSEEK_API_KEY"]` for OpenCode DeepSeek dispatch. The launcher should
  hydrate missing required env vars from Windows User/Machine scope when
  available, but missing required auth is a controller-action
  `LAUNCH_FAILED/missing_required_env`, not a verifier failure.
- The launcher records `task_started_at` immediately before starting the child
  and injects timing metadata into the worker environment:
  `AWM_TASK_STARTED_AT`, `AWM_TIMEOUT_STARTED_AT`, `AWM_DEADLINE_AT`,
  `AWM_TIMEOUT_MS`, `AWM_ATTEMPT_ID`, `AWM_EXPECTED_CAPSULE`, and related
  status/diagnostic file paths.
- `args` and `env` may contain placeholders such as
  `{{awm_task_started_at}}`, `{{awm_deadline_at}}`,
  `{{awm_expected_capsule}}`, `{{awm_prompt_file}}`, and
  `{{awm_prompt_text}}`. The launcher expands them after it records the current
  attempt's start time. Prefer env variables for tool-agnostic metadata; use arg
  placeholders only inside prompts or tool-supported options, not as unknown
  flags that could break the worker CLI.
- Start the process with shell parsing disabled, for example Node
  `spawn(cmd, args, { cwd, env, shell: false })` or .NET
  `ProcessStartInfo.ArgumentList`.
- Set `cwd` as a process property. Do not prepend `cd ...;` to command text.
- Avoid passing the same workspace path again as a tool-specific `--dir`,
  `--cwd`, or positional path argument when `cwd` already puts the worker in the
  target workspace. Prefer relative paths and prompt files from that working
  directory.
- A PowerShell bridge may start the small launcher wrapper, but it must not
  directly start worker CLIs with a long `Start-Process -ArgumentList` command
  string.
- Local absolute paths belong in `launch.json` under ignored
  `.agent-work-mux/runs/`; they must not be copied into `AIMemory/`.

Filesystem creation rules:

- The launcher/controller owns creation of runner-owned directories before
  dispatch: task run directories, capsule parent directories, stdout/stderr
  parent directories, status/heartbeat/diagnostic parent directories, metrics
  directories, and prompt-file directories.
- This precreation is the default for every phase and every role. The controller
  must create the runner-owned directory tree before launching implementers,
  verifiers, testers, or fixers.
- Directory creation must be idempotent. "Already exists" is success, not a
  recoverable worker error. Use structured filesystem APIs such as Node
  `fs.mkdir(..., { recursive: true })` or PowerShell
  `New-Item -ItemType Directory -Force`; do not rely on shell aliases.
- On Windows, `mkdir -p` is forbidden in worker/verifier prompts and runner
  bridge commands. In PowerShell it can be parsed as `New-Item` and fail when
  the directory already exists.
- Workers and verifiers may create app-owned directories inside their assigned
  output boundary, but runner-owned paths from `launch.json` are already
  prepared. Prompts must say the capsule directory already exists, name the exact
  capsule file to write, and explicitly forbid creating runner-owned directories
  or running `mkdir -p` for those paths.
- Compact runner files such as `result.json`, `verdict.json`,
  `controller_status.json`, `diagnostics.json`, and metrics summaries must be
  written atomically where possible: write a sibling temp file in the same
  directory, then rename it to the final path. A partial file must not be treated
  as a valid capsule.
- The launcher/controller may create schema, template, or expectation files such
  as `capsule.schema.json` or `capsule-template.json`. It must not precreate the
  expected worker-owned `result.json` or verifier-owned `verdict.json`, because
  capsule presence is a control signal.
- Task ids and path segments used for runner-owned directories should be stable
  slugs. Prefer `[A-Za-z0-9_]+` for generated task ids; only use hyphens when a
  project policy already declares that exact task id.

PowerShell background bridge, when needed:

```powershell
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = "node"
$psi.ArgumentList.Add(".agent-work-mux/bin/awm-launch.js")
$psi.ArgumentList.Add($launchJsonPath)
$psi.WorkingDirectory = $projectRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
[System.Diagnostics.Process]::Start($psi) | Out-Null
```

The launcher writes `pid.json` and an initial `heartbeat.json` only after the
process actually starts. If the process cannot be spawned, exits before the
startup heartbeat, or exits quickly without the expected capsule, classify the
run as launch/runtime failure and inspect only the short stderr excerpt needed
to decide whether a retry is safe. Do not treat this as a verifier judgment.

The controller should use the generated `awm-watch` helper for bounded polling
instead of open-coded loops. `awm-watch` accepts the task run directory, expected
capsule path, timeout, idle threshold, and current attempt id, then returns one
compact JSON status. By default it does not read raw stdout/stderr contents.

Status taxonomy:

- `LAUNCH_FAILED` - the process never started correctly, path/quoting broke, the
  executable was not found, or startup heartbeat was never written.
- `RUNTIME_FAILED_NO_CAPSULE` - the process started and exited quickly without
  the expected capsule.
- `TIMEOUT_MISSING_CAPSULE` - the process ran through its timebox but did not
  produce the required capsule.
- `CAPSULE_PRESENT` - the expected capsule exists, so controller validation
  shifts to parsing and judging that capsule. A bridge/launcher `ExitCode =
  null` or non-zero process code must not create `critical-error.json` when the
  capsule is present; record it only in diagnostics.
- `EXIT_NONZERO` - the process exited non-zero and the capsule does not already
  explain the failure.

Watcher statuses:

- `CAPSULE_PRESENT` - expected capsule exists and parses.
- `CAPSULE_IN_PROGRESS` - expected capsule exists, parses, and reports
  `status: IN_PROGRESS` with a recent mtime.
- `RUNNING_ACTIVE` - heartbeat/status/output bytes are updating within the idle
  threshold, but the expected capsule is not terminal yet.
- `RUNNING_IDLE` - pid/heartbeat suggests the task is running, but no watched
  file changed within the idle threshold.
- `ERROR_PRESENT` - `critical-error.json` exists for the current attempt.
- `INVALID_CAPSULE` - expected capsule exists but cannot be parsed.
- `EXITED_NO_CAPSULE` - child/bridge exited and no expected capsule exists.
- `TIMEOUT_MISSING_CAPSULE` - timeout elapsed without the expected capsule.
- `STALE_HEARTBEAT` - heartbeat/status attempt id or launch path does not match
  the current launch.

When an expected capsule is missing, the launcher must return a non-zero exit
code even if the child process itself exited `0`. The compact status is the
source of truth, and a missing expected capsule is not a successful launch.

## Timeout anchors

Timeouts are task-attempt scoped. They must never be computed from goal creation
time, run-directory mtime, `launch.json` mtime, parent controller session start,
or a previous attempt's `controller_status.json`.

Required timestamps in `controller_status.json`, `diagnostics.json`, `pid.json`,
and `heartbeat.json` when applicable:

- `queued_at` - optional scheduler enqueue time; not a runtime timeout anchor.
- `launcher_started_at` - when the local launcher process began.
- `task_started_at` - recorded by the launcher immediately before spawning the
  current child process. This is injected into the worker as
  `AWM_TASK_STARTED_AT` and may be used in the worker's capsule.
- `process_started_at` - the start timestamp for the current child process after
  pid/heartbeat confirmation. In the shell-free launcher this normally equals
  `task_started_at`; also record `spawn_confirmed_at` when the pid/heartbeat is
  observed.
- `timeout_started_at` - the timestamp used for the task timeout. For normal
  worker/verifier runtime it must equal the current attempt's
  `process_started_at`.
- `deadline_at` - `timeout_started_at + timeout_ms`.
- `task_elapsed_ms` - elapsed from `timeout_started_at`, not from goal start.
- `launcher_elapsed_ms` - elapsed from `launcher_started_at`, used only for
  diagnosing launch/startup failures.

Split verifier timers use separate anchors:

- Startup/no-output timeout starts at `launcher_started_at` and can only produce
  `LAUNCH_FAILED`.
- Runtime timeout starts at `process_started_at`.
- Active-work timeout, when implemented, starts at the first machine-readable
  output event or first heartbeat after the verifier is known to be running.
- Finalization grace starts when required phase commands have completed or a
  terminal verdict write has begun.

Each retry must either use a fresh attempt directory, such as
`<task-id>/attempt-002/`, or carry an `attempt_id` in every launch/status file.
The controller must ignore stale heartbeat/status files whose `attempt_id` or
`launch_path` does not match the current launch. If a task appears 35 minutes old
from stale goal/run state but the current `process_started_at` is only 3 minutes
old, treat that as a timeout-checker bug or stale-state recovery case, not as a
worker timeout.

Worker prompts should tell the worker to copy `AWM_TASK_STARTED_AT`,
`AWM_TIMEOUT_STARTED_AT`, `AWM_DEADLINE_AT`, and `AWM_ATTEMPT_ID` into
`result.json` or `verdict.json` metrics. This lets the verifier/controller check
the worker-reported timing against launcher diagnostics without reading raw logs
or guessing from filesystem mtimes.

## Diagnostic output split

The runner separates raw streams from controller-action diagnostics:

```text
stdout.jsonl
stderr.log
warnings.jsonl
critical-error.json
diagnostics.json
```

Meanings:

- `stdout.jsonl` is the worker's normal machine-readable output when available.
- `stderr.log` is raw stderr for private forensic/debug use. Its length alone is
  not a verdict.
- `warnings.jsonl` contains non-fatal warnings classified by the runner or
  verifier, such as deprecations, retry notices, soft rate-limit messages, and
  progress noise emitted on stderr.
- `critical-error.json` exists only when controller action is needed before the
  verifier can be trusted, such as path quoting failure, executable missing,
  invalid launch args, auth/billing/quota failure, permission denial, early exit
  without the expected capsule, or timeout without capsule.
- `diagnostics.json` is the compact controller-facing summary: status,
  stdout/stderr byte counts, warning count, whether a critical error exists,
  exit code, capsule existence, and pointers to the above files.
- `watch.json` or a caller-selected watcher output file may contain the latest
  `awm-watch` summary. It is compact status, not raw output.

Controller rule: warnings flow to the verifier/verdict path and do not trigger
controller intervention by themselves. The controller reacts to
`critical-error.json`, failed exit/capsule status, or explicit verifier
`controller_action`; it does not read raw stderr by default. If a critical error
exists, read only `critical-error.json` plus its short `stderr_excerpt`, not the
full raw log.

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
8. Normalize common DeepSeek tier spellings before dispatch:
   - `딥시크v4맥스`, `deepseekv4max`, `deepseek-v4-max`, `v4 max`, `max`, `맥스`
     -> `deepseek-v4-pro:max`
   - `딥시크v4노멀`, `딥시크v4보통`, `deepseekv4normal`, `deepseekv4standard`,
     `v4 normal`, `normal`, `standard`, `노멀`, `보통`
     -> `deepseek-v4-flash:standard`
   - `딥시크v4플래시`, `deepseekv4flash`, `flash`, `플래시`
     -> `deepseek-v4-flash:flash`
   Do not silently upgrade a verifier/tester from normal/standard/flash to
   max/pro. If tier parsing is ambiguous, ask or record `auto`.
9. When only one agent name is inferred, default to `<agent>:auto:auto` and
   alias `<agent>`.
10. If the result would overwrite an existing alias with a different selector,
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

Preferred ledger columns for new or rewritten ledgers:

```markdown
| Goal-id | Objective | State | Created | Updated | Completed | Orchestrator | Policy | Quality score | Worker tokens | Orchestrator tokens | Worker cost | Orchestrator cost | Final report | Record |
|---------|-----------|-------|---------|---------|-----------|--------------|--------|---------------|---------------|---------------------|-------------|-------------------|--------------|--------|
```

Token and cost fields are best-effort but must be split by role:

- Use exact worker/runner-reported values when available.
- Use `estimated:<value>` only when the estimate method is clear.
- Use `unknown` when the worker or orchestrator does not report usage.
- Record worker totals separately from orchestrator/controller totals. If the
  active Codex harness does not expose token telemetry, record
  `unknown (not exposed by harness)` for orchestrator tokens instead of folding
  them into worker totals.
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

## Dispatch preview
- Goal: <short objective>
- Output root: <workspace/output boundary>
- Policy: <policy>
- Design summary: <component boundaries and assembly rule>
- Phases: <phase -> worker/verifier, scope, capsule, timeout>
- Quality gates: <hard fail gates, score threshold, warnings policy>
- Controller boundary: <controller owns design/dispatch/final; verifier owns tests/smoke/log review>

## Quality contract
- Minimum score: <none | 0-100 threshold, default 85 for code goals with verification>
- Hard fail gates: <phase failures, unsafe output, missing required artifacts, etc.>
- Warning gates: <quality gaps accepted only with documentation>
- Domain checklist: <security, robustness, maintainability, UX, tests, docs as relevant>
- Stop conditions: <max fix rounds, when to accept warnings, when to pause>

## Integration contract
- Components: <frontend, backend, storage, tests, docs, etc.>
- Component contracts: <public APIs, file paths, commands, data shapes>
- Assembly contract: <how component contracts combine into the whole system>
- End-to-end acceptance: <what the verifier/tester must prove about the whole>

## Results
<compact task results and artifact paths>

## Errors
<compact errors, exit codes, and pointers to raw logs>

## Telemetry
- Tasks total: <n>
- Tasks complete: <n>
- Worker token usage: <per worker and total, or unknown>
- Worker token source: <reported | estimated | unknown>
- Worker cost: <amount/currency or unknown>
- Orchestrator token usage: <reported | estimated | unknown>
- Orchestrator token source: <reported | estimated | unknown>
- Orchestrator cost: <amount/currency or unknown>
- Goal token total: <sum of known reported/estimated tokens, or unknown>
- Quality score: <0-100, n/a, pending, or fail>
- Last checkpoint: <short text>
- Compact result bytes: <rough size or unknown>
- Raw logs loaded into orchestrator: <none | explicit debug reason>
- Controller log policy: <compact_only | verifier_owned_logs | explicit_debug>

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

Default worker output pipeline:

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

Verifier-owned log pipeline:

When a goal has a verifier or tester task, the verifier owns raw worker-log
inspection. The controller/orchestrator must not tail or read implementer raw
logs while the worker is running. It should only poll small process/status
facts such as `running`, `pid`, `exit_code`, `stdout_bytes`, `stderr_bytes`,
and elapsed time.

Controller trust discipline:

- The controller should trust the worker/verifier binding once dispatch starts.
- Do not repeatedly inspect generated files, test output, or worker progress
  just to feel safe.
- Do not rerun phase tests or smoke tests when the verifier/tester is
  responsible for them.
- Do not read source files during the worker run unless the verifier reports a
  blocker or the user explicitly asks for controller inspection.
- Poll at coarse intervals and print at most compact heartbeat facts before
  verifier completion.
- If the worker or verifier times out, exits non-zero, or fails to produce its
  capsule, then switch to debug mode and read the minimum relevant log snippet.
- Prefer one high-quality dispatch prompt over many mid-run corrections.
- Enforce explicit task timeboxes. A worker that keeps producing output but does
  not produce its required capsule is treated as `TIMEOUT_MISSING_CAPSULE`, not
  as open-ended progress.
- If artifacts exist but the implementer capsule is missing, stop waiting and
  delegate artifact/log review to the verifier instead of looping locally.
- Use split timeboxes for model-backed verifier tasks: a startup/no-output
  timebox, an active-work timebox after the first machine-readable event, and a
  short finalization grace period after required phase commands complete. Do not
  kill a verifier seconds after a successful smoke test when it is likely about
  to write `verdict.json`.
- Default code-goal timeboxes are 30 minutes for broad implementer work and 30
  minutes for verifier/tester work, plus a 3 minute finalization grace period
  once required phase commands have completed or a terminal verdict is being
  written. Short smoke probes may use smaller explicit limits.

The controller's main responsibility before dispatch is to give the worker and
verifier enough structure to succeed: output boundaries, quality contract,
artifact paths, required capsule schema, and a clear "do not edit outside this
scope" rule. After dispatch, the verifier should close the loop.

Controller role boundary:

The controller's normal duties are:

- design the task, component boundaries, integration contract, output
  boundaries, agent bindings, quality contract, and verifier rubric
- show the compact dispatch preview before the first worker launch
- dispatch implementer and verifier/tester with clear capsule requirements
- wait for verifier/tester verdict without inspecting raw progress
- validate that required compact capsules exist and are parseable
- read only compact `verdict.json`, `metrics.json`, and artifact pointers
- make the final accept/fix/pause decision from the verifier verdict
- write the final user report and goal state update

The controller should not personally run backend tests, frontend tests, smoke
tests, live browser checks, or API probes when a verifier/tester has that role.
Those checks belong in the verifier/tester prompt and verdict. Controller-run
tests are allowed only when no verifier/tester was assigned, the verifier asks
for controller-side debug, or the user explicitly requests controller retesting.
When a verifier/tester is assigned, implementer prompts should also keep those
phase checks out of the implementer role. The implementer may create the test
scripts and perform only bounded syntax or sanity checks if requested, but it
must not run live server checks, browser/API probes, or direct long-running
commands such as `npm start`; those belong to the verifier/tester, which also
owns process cleanup.

The controller is accountable for making component contracts add up to the
whole system. It should define the seams between parts, the data/API contracts,
the commands that prove each part, and the end-to-end acceptance condition.
Once the worker implements those contracts and the verifier proves them, the
controller should trust the verdict instead of duplicating the tester's job.

Required compact capsules for worker-backed goals:

```text
.agent-work-mux/runs/<goal-id>/<task-id>/result.json
.agent-work-mux/runs/<goal-id>/<verify-task-id>/verdict.json
.agent-work-mux/runs/<goal-id>/metrics/summary.json
```

`result.json` is produced by the implementer or fixer and should contain status,
changed files, commands run, artifact paths, known issues, and token usage when
available. `verdict.json` is produced by the verifier/tester. The runner may
write `controller_status.json`, `diagnostics.json`, and schema/template files,
but it must not fabricate a successful expected capsule. Capsules must not
contain full stdout, stderr, source dumps, or raw tool events.

Capsule-first rule:

- Every worker prompt must name the exact capsule path and schema.
- Every worker/verifier prompt must state that runner-owned parent directories
  are already present and must not be created by the worker.
- Implementer prompts should require a parseable `result.json` skeleton before
  expensive checks or any command that could hang. If the worker later stalls,
  the controller/verifier has compact evidence instead of a missing capsule.
- The runner should consider the task incomplete until the capsule exists and
  parses.
- If the worker cannot finish, it must still write a small failure capsule with
  `status`, `reason`, `partial_artifacts`, and `next_recommended_action`.
- If the worker exits, times out, or is killed without a capsule, the runner or
  controller writes a small `controller_status.json` that records the
  disposition, elapsed time, whether artifacts exist, and whether raw logs were
  inspected.
- A missing capsule is never silently accepted as success.

Verifier capsule resilience:

- A verifier/tester must create a parseable `verdict.json` skeleton before
  running expensive checks:

```json
{
  "status": "IN_PROGRESS",
  "score": 0,
  "phase_results": {},
  "blockers": [],
  "warnings": [],
  "controller_action": "pause"
}
```

- The verifier updates that file atomically after each major phase using a temp
  file followed by rename.
- Final acceptance still requires a terminal `PASS` or `FAIL`, but a partial
  `IN_PROGRESS` verdict lets the controller retry or pause with evidence
  instead of treating the run as an information-free missing capsule.
- Verifier prompts should put capsule creation and final update before optional
  source-quality embellishment. The final step is always "write terminal
  verdict", not more exploration.

`verdict.json` is produced by the verifier and is the controller's primary
input. It should contain:

```json
{
  "status": "PASS",
  "score": 90,
  "phase_results": {
    "backend": "PASS",
    "frontend": "PASS",
    "smoke": "PASS"
  },
  "quality": {
    "security": 9,
    "robustness": 9,
    "maintainability": 8,
    "tests": 8
  },
  "blockers": [],
  "warnings": [],
  "artifact_paths": [],
  "metrics": {
    "worker_tokens": "unknown",
    "verifier_tokens": "unknown"
  },
  "controller_action": "accept"
}
```

The controller should accept, request a fix round, pause, or ask the user from
`verdict.json`. It should read raw logs only when `controller_action` is
`debug_raw_log` or the user explicitly asks for debugging evidence.

Repair loop guard:

- The default maximum is one broad implementation pass plus one narrow fix
  round. A second narrow fix round is allowed only for a precise verifier
  finding, timeout/missing-capsule recovery, or explicit user approval.
- Never use an open-ended "try again" prompt after verification. A fix prompt
  must cite the exact verifier finding, allowed file scope, expected capsule,
  and required recheck command or verifier handoff.
- If the verifier returns `PASS`, no blockers, and score >= the configured
  threshold, the controller accepts the goal. Do not keep optimizing quality
  above the threshold unless the user asks.
- If the verifier returns warnings but no hard-fail gate is triggered, record
  the warnings in the final report instead of starting another fix loop.
- If two consecutive workers fail to produce capsules for the same task, pause
  or ask the user rather than launching another unconstrained worker.

Polling output must be compact by default. Redirect command stdout/stderr to
files and return only status summaries. For tests, return one-line phase
summaries such as `phase:all PASS backend=26 frontend=29 smoke=16`; full logs
stay under `.agent-work-mux/runs/<goal-id>/`.

Before verifier completion, progress logging should be sparse:

- one `GOAL_CREATED` event when the goal contract is ready
- one `RUNNER_DISPATCHED` event per worker/verifier dispatch if needed
- no repeated `RUNNER_PROGRESS` events unless a timeout threshold is crossed
- one `VERDICT_RECORDED` event when `verdict.json` is available
- one `GOAL_COMPLETED` or `GOAL_PAUSED` event at the end

Avoid recording every poll, file count, phase line, or stdout tail in
`work.log` or the active chat.

Token telemetry must be computed from machine-readable logs by a script or
runner helper and returned as small JSON. Do not load raw transcripts merely to
sum token usage.

Metrics summary:

- Store role-separated metrics in
  `.agent-work-mux/runs/<goal-id>/metrics/summary.json`.
- Include worker totals, verifier totals when reported, controller/orchestrator
  totals when exposed by the host, cache tokens when available, and failed or
  timed-out attempts.
- Mark controller token usage as `unknown (not exposed by harness)` when it
  cannot be measured. Do not merge controller usage into worker totals.
- For fair benchmarks, use a fresh goal directory and preferably a fresh
  controller session; live policy editing and mid-run discussion should be
  labeled as contaminated measurement.

## Verification policy

Implementer/verifier separation is user-selectable. It is not mandatory.

Suggested policies:

```text
single_agent
implement_then_verify
deepseek_build_verify_codex_fix
parallel_review
custom
```

The default is `single_agent` unless the user or `AIMemory/AGENTS.md` selects
another policy.

`deepseek_build_verify_codex_fix` is the recommended cost/quality benchmark
preset for code goals when the current orchestrator is Codex:

- Implementer: DeepSeek-backed worker, usually OpenCode DeepSeek v4 max/pro for
  the first broad implementation pass unless the user selects a cheaper tier.
- Verifier/tester: DeepSeek-backed worker, usually OpenCode DeepSeek v4
  normal/standard or flash, responsible for tests, smoke checks, source-quality
  review, raw-log summarization, and `verdict.json`.
- Fixer: the current Codex controller, but only after a verifier finding. Codex
  edits only the allowed file scope from the finding and writes a compact
  `fix-codex/result.json` capsule. It does not reread raw worker logs, rerun the
  verifier's full test suite, or broaden the task.
- Final verifier: the same verifier class as above. The goal is accepted only
  from the final verifier verdict.

This preset must not invoke Codex CLI from inside a Codex-controlled run unless
the user explicitly asks for live Codex CLI execution. The in-session Codex
controller is the fixer.

Codex fixer entry conditions:

- `verdict.json` exists and parses.
- `controller_action` is `fix`.
- Findings are precise enough for a narrow patch.
- Each blocker lists `allowed_fix_scope` or an equivalent file/directory scope.
- The fix remains inside the goal's output boundary.

Codex fixer stop conditions:

- If the verifier finding is broad, ambiguous, lacks file scope, or would
  require re-architecture, pause instead of patching.
- After one Codex fix round, dispatch the final verifier. Do not stack local
  Codex fixes unless the final verifier returns a new precise finding and the
  user or policy allows a second narrow fix.
- Codex may run a tiny syntax or targeted command for the files it touched, but
  backend/frontend/smoke/live-server acceptance remains verifier-owned.

When verification is enabled, the verifier is a reviewer and quality gate, not
only a test rerunner. It must use the goal's Quality contract and return a
compact verdict with PASS/FAIL, a 0-100 implementation score, phase results,
blockers, warnings, and suggested controller action.

Verifier/tester responsibilities include all required phase checks, smoke
tests, live server/API/browser probes, source-quality review, and raw-log
summarization. The verifier verdict is the source of truth for these checks in
normal operation.

For live server checks, the verifier/tester also owns setup and cleanup. It must
use bounded ports/processes, kill processes it starts, report any leftover
processes it found, and include a `no_server_left_running` style result when
the goal starts a local service.

The verifier must validate both component contracts and the assembly contract:
each part works, the parts interoperate through the designed interfaces, and
the whole user-visible workflow satisfies the original request.

For software implementation goals, the planner should write a Quality contract
before dispatch. The contract should be domain-specific, but default web/API
quality gates include:

- input validation for create/update paths
- request body size limits
- safe local default bind, such as `127.0.0.1`, unless the user asks otherwise
- atomic local JSON writes, such as temp-file write followed by rename
- unsafe Markdown/link protocol rejection when rendering user content
- normalized/deduplicated tags or comparable structured fields
- deterministic ordering for list views when useful, such as `updatedAt desc`
- README or run instructions when the deliverable is a runnable app
- `.gitignore` and no committed/generated dependency folders such as
  `node_modules`
- focused phase tests plus a smoke or integration check

Generated dependency folders:

- The implementer should create `.gitignore` before running package managers and
  include `node_modules`, local data files, logs, and `.agent-work-mux/` where
  appropriate.
- `node_modules` may exist in an isolated working directory after `npm install`;
  that is not automatically a hard fail if it is ignored and not listed in
  `artifact_paths`.
- It is a hard fail when generated dependency folders are listed as deliverable
  artifacts, copied into a result bundle, committed, or left unignored in a
  project meant to be handed off.
- The verifier must not recursively scan dependency folders. Check top-level
  presence, `.gitignore`, and `artifact_paths` instead.

Typical hard fail gates for code goals:

- required phase test failure
- unsafe user-content rendering with obvious XSS paths
- missing server-side validation for required fields
- generated dependency folders included as deliverables
- verifier score below the configured minimum threshold

Warnings may be accepted only when they are documented in the goal record and
final report.

Acceptance and stop conditions:

- Accept when the final verifier verdict is `PASS`, all hard-fail gates are
  clear, and the score meets the configured threshold.
- Request one narrow fix when a precise hard-fail finding is reported.
- Pause when the finding is ambiguous, the allowed fix scope is unclear, or the
  maximum fix round count is reached.
- Stop launching workers when missing capsules repeat; preserve the artifacts
  and ask the user whether to inspect manually, lower scope, or retry.

## Minimal runner loop

1. Parse the explicit `/awm` command.
2. Resolve aliases/selectors.
3. Ensure generated local helpers exist, match their markdown source hashes, and
   pass self-test. Refuse dispatch if `awm-launch` or `awm-watch` is stale.
4. Confirm every selected agent alias has a locked `launch-profile.json`, a
   matching helper/prototype ABI version, and a passing capsule handshake. If any
   profile is missing, stale, or untested, ask the user to run
   `/awm agent refresh <alias>` or `/awm agents test <alias> --smoke` and pause.
5. Create or update the goal contract and `AIMemory/goals/ACTIVE.md`.
6. For implementation goals, write the component boundaries, Integration
   contract, Quality contract, and verifier rubric before dispatch.
7. Create or update the goal's row in `AIMemory/goals/INDEX.md`.
8. Show the compact dispatch preview in the active orchestrator session:
   objective, output root, design, phases, worker/verifier assignments, capsule
   paths, timeout policy, quality gates, controller boundary, and task id map.
9. Dispatch tasks only if auto-run is true and state remains `active`.
10. Keep raw logs in `.agent-work-mux/runs/`.
11. Use `awm-watch` for bounded attempt polling and compact status.
12. If a verifier exists, let the verifier inspect implementer logs and return
    `verdict.json`; otherwise use the runner's compact `result.json`.
13. Return compact summaries/errors/results to the orchestrator.
14. Update telemetry, the resume checkpoint, and the ledger row after each
    task.
15. Stop on `awaiting_user`, `paused`, or `error_paused`.
16. Run the completion guard from compact capsules and verifier verdict.
17. Write one integrated final report, mark `complete`, and update `ACTIVE.md`
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

Legacy aliases: bare `/awm goals` and `/awm status --all` map to
`/awm goal list`; `/awm goals <request>` maps to `/awm goal <request>`.
