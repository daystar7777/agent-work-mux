# Agent Call Probe

This prompt is lazy-loaded. Use it only when the user invokes
`/awm agents test`, `/awm agents hints`, or explicitly asks AgentWorkMux to test
worker-agent calls after installation.

Do not load this file during ordinary sessions.

## Purpose

Verify that configured worker agents can be called before a real `/awm goal`
depends on them. Record compact, reusable hints so future dispatches do not
repeat avoidable first-call failures.

## Safety rules

- Run only after an explicit `/awm` command or direct user request.
- Tell the user that smoke calls may consume tokens or credits.
- Do not run live completions for guarded CLIs during default probes. Codex
  CLI, Claude CLI, and Gemini CLI default to version/auth checks only; run
  their live prompts only when the user explicitly asks for actual execution,
  for example `/awm agents test codex --smoke --live`.
- Treat same-family worker CLIs as guarded by default: Codex should not
  recursively call Codex CLI, Claude should not call Claude CLI, and
  Antigravity/Gemini contexts should not call Gemini CLI unless explicitly
  requested.
- Use tiny prompts such as `Reply with exactly: <AGENT>_OK`.
- Store raw stdout/stderr/JSON under ignored `.agent-work-mux/probes/`.
- Store only compact, non-secret hints in `AIMemory/AGENTS.md`.
- Put private command paths, account names, tokens, and local overrides in
  `.agent-work-mux/agents.local.md`, never in `AIMemory/`.
- If a command fails, record the failure and the corrected invocation that
  worked. Do not hide first-call errors.
- For dispatch-ready agents, verify capsule behavior with generated local helper
  code from markdown, not only a text `OK` response.
- Do not ask a worker to create runner-owned directories during probes. The
  probe/controller precreates them, then verifies the worker can write a capsule
  into an existing parent directory.
- Re-run the probe when an agent CLI version changes.

## Commands

```text
/awm agents test [--all | <agent-selector>] [--smoke] [--live]
/awm agents hints [agent-selector]
```

`/awm agents test` runs the probe and updates the call hints.
For guarded CLIs, the default probe checks the CLI and non-prompt auth state
where available but does not send a prompt. Treat `--live`, or a direct request
such as "actually run Claude/Codex/Gemini", as authorization to perform the
live call.
`/awm agents hints` reads existing hints without running agents.

## Markdown-sourced helper probe

AgentWorkMux remains markdown-first. Probe helper code is canonical only inside
tracked `*.js.md` markdown helper specs that include generation notes,
OS/runtime differences, validation rules, and extractable OS-specific code
blocks. The `js.md` suffix identifies the script-spec markdown source and does
not force the generated helper to use JavaScript. During `/awm setup` or `/awm
agents test`, extract OS/runtime-specific helper specs into ignored local files:

```text
helpers/awm-launch.js.md
helpers/awm-watch.js.md
helpers/awm-helper-self-test.js.md
helpers/awm-capsule-probe.js.md

.agent-work-mux/bin/awm-launch[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-watch[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-helper-self-test[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/bin/awm-capsule-probe[.cmd|.ps1|.sh|.js|native]
.agent-work-mux/helpers/manifest.json
```

The manifest records source markdown path, block id, source SHA-256, generated
path, runtime, and self-test status. A generated helper is stale if its recorded
hash no longer matches the markdown source. Stale helpers must be regenerated and
self-tested before real goal dispatch.

Helper names and invocation parameters are fixed by the AWM helper ABI. The
generator must not choose different names or required flags for convenience.
Current logical commands:

```text
awm-launch <launch.json>
awm-watch --run-dir <dir> --expected-capsule <file> --attempt-id <id> --timeout-ms <n> --idle-ms <n> --json
awm-helper-self-test --manifest <file> --json
awm-capsule-probe --agent <selector> --run-dir <dir> --expected-capsule <file> --timeout-ms <n> --json
```

OS-specific wrappers may add extensions. Prefer OS-default shells with no new
runtime dependency: PowerShell plus optional `.cmd` shim on Windows, POSIX `sh`
on Unix-like systems, and `bash`, Node, or .NET only as an explicit available
fallback. Windows `.cmd` files are shims only; internal runner calls should
record and invoke the real entrypoint with explicit args. The manifest must
record the same logical helper name, ABI version,
supported parameters, and self-test command lines. If the current OS/runtime
cannot satisfy the required ABI, mark the helper probe failed instead of changing
the contract.

Agent registration/probe should also create a stable launch prototype before any
real goal uses the alias:

```text
.agent-work-mux/helpers/agents/<alias>/launch-profile.json
.agent-work-mux/helpers/agents/<alias>/capsule-probe-profile.json
.agent-work-mux/helpers/agents/<alias>/README.local.md
```

The prototype records invocation shape, supported prompt/stdout policy, required
env names, normalized model/tier labels, and OS-specific wrapper notes. It must
not contain secrets. Goal-time `launch.json` files still contain per-task fields
such as cwd, prompt path, attempt id, timeout, stdout/stderr paths, and expected
capsule, but they are derived from this registered prototype plus the protocol
path ABI. Do not generate a new launcher shape from scratch inside a goal prompt.

## Capsule handshake probe

A dispatch-ready worker probe has two layers:

1. Invocation probe: the agent returns the expected tiny text or machine-readable
   JSON response.
2. Capsule handshake probe: the generated launcher/watch helpers prove that the
   agent can operate inside the AWM runner contract.

Handshake requirements:

- Precreate the task run directory, capsule parent, stdout/stderr parents,
  status/heartbeat/diagnostic parents, prompt parent, and metrics parent.
- Tell the agent the capsule parent already exists and runner-owned directory
  creation is forbidden.
- Ask the agent to write a compact skeleton capsule into the exact expected path
  using same-directory temp file plus rename.
- Verify `awm-watch` reports `CAPSULE_IN_PROGRESS` or `CAPSULE_PRESENT` without
  reading raw stdout/stderr contents.
- Run negative local checks for missing capsule and malformed capsule
  classification, producing `TIMEOUT_MISSING_CAPSULE` and `INVALID_CAPSULE`
  respectively.
- On Windows, treat any probe use of `mkdir -p` for runner-owned paths as a
  contract failure even if the tiny text response succeeded.

Only aliases with a passing invocation probe and passing capsule handshake should
be considered ready for `/awm goal` dispatch. If the invocation passes but the
handshake fails, record `retest_required` or `capsule_handshake_failed`.

## Probe record

Create a probe run directory:

```text
.agent-work-mux/probes/<timestamp>/
```

For each agent, write:

```text
<agent>/raw.log
<agent>/stdout.log
<agent>/stderr.log
<agent>/result.json
<agent>/capsule-handshake/result.json
<agent>/capsule-handshake/watch.json
<agent>/capsule-handshake/diagnostics.json
```

Raw logs are ignored by git and should not be loaded into the main
orchestrator context unless debugging.

## Public hint fields

Append or refresh an `Agent call hints` section in `AIMemory/AGENTS.md`:

```markdown
## Agent call hints
| Agent | Last tested | CLI/version | Headless status | Invocation hint | Telemetry | Known quirks |
|-------|-------------|-------------|-----------------|-----------------|-----------|--------------|
| opencode | <date> | opencode 1.14.33 | pass; capsule_handshake pass | opencode run --model <provider/model> --format json "<prompt>" | JSON events include step_finish tokens/cost | For AWM worker prompts, use inline prompt text, file stdio on Windows, required env for providers, and early capsule writes into existing runner-owned dirs. |
| continue | <date> | Continue CLI 1.5.45 | pass | cn [--config <config-if-needed>] --readonly -p "<prompt>" --format json | JSON output in headless mode; `cn serve --port <port>` exposes HTTP `/state` and `/message` | Any working Continue secret setup is valid; if local env fallback returns DeepSeek 401, add `apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}`. |
| codex | <date> | codex-cli 0.128.0 | guarded_check_only | default: codex --version; live on request: codex exec --ephemeral --json --output-last-message <file> --cd <project> "<prompt>" | Default probe collects no token telemetry; live runs emit JSONL turn.completed usage. | Guarded CLI: do not run live prompts during default `--all`; require explicit user request or `--live`. |
| gemini | <date> | gemini-cli 0.41.2 | guarded_check_only | default: gemini --version; live on request: gemini --prompt "<prompt>" --approval-mode plan --output-format json --skip-trust | Default probe collects no token telemetry; live runs emit JSON stats. | Guarded CLI, especially from Antigravity/Gemini contexts: require explicit user request or `--live`. |
| aider | <date> | aider 0.86.2 | pass | aider --model <provider/model> --message "<prompt>" --no-git --no-auto-commits --no-stream --no-pretty --yes-always --no-analytics --input-history-file .agent-work-mux/tmp/aider/input.history --chat-history-file .agent-work-mux/tmp/aider/chat.history.md --llm-history-file .agent-work-mux/tmp/aider/llm.history | stdout includes tokens/cost | Include "Do not edit files" in smoke prompts; redirect history files to ignored local state. |
| antigravity | <date> | Antigravity 1.107.0 | gui_only | antigravity chat --mode ask "<prompt>" | none | Command opens/targets the GUI chat and returned no stdout/stderr result. |
| cursor | <date> | Cursor 3.3.22 | gui_only | <Cursor install>/resources/app/bin/cursor.cmd --chat | none | CLI is an editor/chat launcher and may not be on PATH. |
| claude | <date> | Claude Code 2.1.132 | guarded_check_only | default: claude --version and claude auth status; live on request: claude -p "<prompt>" --output-format json --permission-mode plan --no-session-persistence | Default probe collects auth/version only; live runs can emit JSON usage/error metadata. | Guarded CLI: do not run live prompts during default `--all`; require explicit user request or `--live`. |
```

Do not copy local absolute paths into `AIMemory/AGENTS.md`.

## Local override fields

Use `.agent-work-mux/agents.local.md` for machine-local details:

```markdown
# Local AgentWorkMux Agent Hints

## opencode
- command: opencode run --model deepseek/deepseek-v4-flash --format json "<prompt>"
- raw_log_root: .agent-work-mux/probes/<timestamp>/opencode/
- prompt_file_policy: for real worker dispatch, store the long prompt as a file
  but launch with `prompt_mode: inline` and pass the file text through the normal
  message, for example with `{{awm_prompt_text}}`; reserve `--file` for
  source/context files and place those args after the message.
- stdio_policy: on Windows, prefer file-handle redirection (`stdio_mode: file`)
  for background OpenCode workers; Node pipe capture can stall even when
  Start-Process redirection succeeds.
- required_env: for OpenCode DeepSeek dispatch, require `DEEPSEEK_API_KEY`; on
  Windows, a launcher may hydrate it from User/Machine scope, but missing auth is
  a critical launch error.
- capsule_handshake: required before goal dispatch; worker must write
  `result.json` into an existing capsule parent and must not create runner-owned
  directories or use `mkdir -p` for those paths.
- watcher: generated `awm-watch` should classify `CAPSULE_PRESENT`,
  `CAPSULE_IN_PROGRESS`, `INVALID_CAPSULE`, and `TIMEOUT_MISSING_CAPSULE` during
  onboarding without reading raw stdout/stderr by default.

## continue
- command: cn [--config <config-if-needed>] --readonly -p "<prompt>" --format json
- config_hint: if Continue's configured secret already populates model `apiKey`, no override is needed; if local env fallback returns DeepSeek 401, include `apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}` in the local model entry.
- server: cn serve --port <port>
- headless_status: pass
- safety: use `--readonly` for plan/read-only probes; use `--allow`, `--ask`, or `--exclude` for per-tool gates before enabling edits.
- auth: after setting a User-scope variable on Windows, open a fresh shell or inject `[Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")` into the probe process.

## codex
- default_check: codex --version
- live_command: codex exec --ephemeral --json --output-last-message <last-message-file> --cd <project> "<prompt>"
- headless_status: guarded_check_only
- guarded_policy: live prompt execution requires an explicit user request or `--live`.

## gemini
- default_check: gemini --version
- live_command: gemini --prompt "<prompt>" --approval-mode plan --output-format json --skip-trust
- headless_status: guarded_check_only
- guarded_policy: live prompt execution requires an explicit user request or `--live`, especially from Antigravity/Gemini contexts.

## aider
- command: aider --model deepseek/deepseek-chat --message "<prompt>" --no-git --no-auto-commits --no-stream --no-pretty --yes-always --no-analytics --input-history-file .agent-work-mux/tmp/aider/input.history --chat-history-file .agent-work-mux/tmp/aider/chat.history.md --llm-history-file .agent-work-mux/tmp/aider/llm.history
- headless_status: pass

## antigravity
- command: antigravity chat --mode ask "<prompt>"
- headless_status: gui_only
- correction_needed: exclude from worker dispatch unless a future version returns machine-readable stdout or a result file.

## cursor
- command: <Cursor install>/resources/app/bin/cursor.cmd --chat
- headless_status: gui_only
- correction_needed: exclude from worker dispatch unless a future version returns machine-readable stdout or a result file.

## claude
- default_check: claude --version; claude auth status
- live_command: claude -p "<prompt>" --output-format json --permission-mode plan --no-session-persistence
- version: Claude Code 2.1.132
- headless_status: guarded_check_only
- guarded_policy: live prompt execution requires an explicit user request or `--live`.
```

## Classification

- `untested` - alias was registered but no smoke probe has run yet.
- `pass` - command returned expected response in stdout or declared output file.
- `pass_with_warnings` - expected response returned, but non-fatal warnings
  appeared.
- `capsule_handshake_failed` - the command can respond, but it failed the runner
  contract for early capsule write, existing-directory behavior, atomic write, or
  watcher classification.
- `guarded_check_only` - guarded CLI is installed and optionally authenticated,
  but the default probe intentionally did not send a live prompt. This covers
  billing-metered and same-family recursive worker CLIs. Run live only after
  explicit user approval.
- `gui_only` - command opens or targets an interactive GUI/chat and provides no
  machine-readable result.
- `retest_required` - CLI is present but service/headless behavior is currently
  unreliable or deferred; do not use for real worker dispatch until retested.
- `missing_path` - executable not found.
- `auth_blocked` - command exists but auth/login or provider API auth failed;
  this can still prove config parsing and network wiring reached the provider.
- `billing_blocked` - command exists and the invocation shape is valid, but
  account billing, quota, or a probe budget cap prevented live completion.
- `error_paused` - command failed after one corrected retry.

## Completion

After probing:

1. Update `AIMemory/AGENTS.md` with compact call hints.
2. Update `.agent-work-mux/agents.local.md` with local command details.
3. Append a compact `NOTE` or `RUNNER_RESULT` to `AIMemory/work.log` if the
   project is installed.
4. Report pass/fail/warnings and any required user action.
