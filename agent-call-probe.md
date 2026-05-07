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
- Use tiny prompts such as `Reply with exactly: <AGENT>_OK`.
- Store raw stdout/stderr/JSON under ignored `.agent-work-mux/probes/`.
- Store only compact, non-secret hints in `AIMemory/AGENTS.md`.
- Put private command paths, account names, tokens, and local overrides in
  `.agent-work-mux/agents.local.md`, never in `AIMemory/`.
- If a command fails, record the failure and the corrected invocation that
  worked. Do not hide first-call errors.
- Re-run the probe when an agent CLI version changes.

## Commands

```text
/awm agents test [--all | <agent-selector>] [--smoke]
/awm agents hints [agent-selector]
```

`/awm agents test` runs the probe and updates the call hints.
`/awm agents hints` reads existing hints without running agents.

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
```

Raw logs are ignored by git and should not be loaded into the main
orchestrator context unless debugging.

## Public hint fields

Append or refresh an `Agent call hints` section in `AIMemory/AGENTS.md`:

```markdown
## Agent call hints
| Agent | Last tested | CLI/version | Headless status | Invocation hint | Telemetry | Known quirks |
|-------|-------------|-------------|-----------------|-----------------|-----------|--------------|
| opencode | <date> | opencode 1.14.33 | pass | opencode run --model <provider/model> --format json "<prompt>" | reported tokens/cost in step_finish | Put message before repeated --file args. |
| codex | <date> | codex-cli 0.128.0 | pass | codex exec --ephemeral --json -o <file> "<prompt>" | reported tokens in turn.completed | Plugin sync 403 warnings can be non-fatal if final message exists. |
| antigravity | <date> | Antigravity 1.107.0 | retest_required | antigravity chat --mode ask "<prompt>" | none on stdout | Service/headless behavior deferred; test only until revalidated. |
| claude | <date> | unknown | missing_path | configure in .agent-work-mux/agents.local.md | unknown | `claude` not found on PATH. |
```

Do not copy local absolute paths into `AIMemory/AGENTS.md`.

## Local override fields

Use `.agent-work-mux/agents.local.md` for machine-local details:

```markdown
# Local AgentWorkMux Agent Hints

## opencode
- command: opencode run --model deepseek/deepseek-v4-flash --format json "<prompt>"
- raw_log_root: .agent-work-mux/probes/<timestamp>/opencode/

## codex
- command: codex exec --ephemeral --json -o <last-message-file> "<prompt>"

## antigravity
- command: antigravity chat --mode ask "<prompt>"
- headless_status: retest_required
- correction_needed: re-run smoke test when the service is healthy

## claude
- headless_status: missing_path
- correction_needed: add Claude CLI command path or alias
```

## Classification

- `pass` - command returned expected response in stdout or declared output file.
- `pass_with_warnings` - expected response returned, but non-fatal warnings
  appeared.
- `gui_only` - command opens or targets an interactive GUI/chat and provides no
  machine-readable result.
- `retest_required` - CLI is present but service/headless behavior is currently
  unreliable or deferred; do not use for real worker dispatch until retested.
- `missing_path` - executable not found.
- `auth_blocked` - command exists but auth/login is required.
- `error_paused` - command failed after one corrected retry.

## Completion

After probing:

1. Update `AIMemory/AGENTS.md` with compact call hints.
2. Update `.agent-work-mux/agents.local.md` with local command details.
3. Append a compact `NOTE` or `RUNNER_RESULT` to `AIMemory/work.log` if the
   project is installed.
4. Report pass/fail/warnings and any required user action.
