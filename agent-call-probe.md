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
| opencode | <date> | opencode 1.14.33 | pass | opencode run --model <provider/model> --format json "<prompt>" | JSON events include step_finish tokens/cost | Put message before repeated --file args. |
| continue | <date> | Continue CLI 1.5.45 | pass | cn [--config <config-if-needed>] --readonly -p "<prompt>" --format json | JSON output in headless mode; `cn serve --port <port>` exposes HTTP `/state` and `/message` | Any working Continue secret setup is valid; if local env fallback returns DeepSeek 401, add `apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}`. |
| codex | <date> | codex-cli 0.128.0 | pass_with_warnings | codex exec --ephemeral --json --output-last-message <file> --cd <project> "<prompt>" | JSONL turn.completed usage reports tokens | Plugin sync 403, PowerShell shell snapshot, and plugin manifest warnings can be non-fatal if the final message exists. |
| gemini | <date> | gemini-cli 0.41.2 | pass | gemini --prompt "<prompt>" --approval-mode plan --output-format json --skip-trust | JSON stats include model, token, tool, and file counters | Use `approval-mode plan` for read-only smoke probes. |
| aider | <date> | aider 0.86.2 | pass | aider --model <provider/model> --message "<prompt>" --no-git --no-auto-commits --no-stream --no-pretty --yes-always --no-analytics --input-history-file .agent-work-mux/tmp/aider/input.history --chat-history-file .agent-work-mux/tmp/aider/chat.history.md --llm-history-file .agent-work-mux/tmp/aider/llm.history | stdout includes tokens/cost | Include "Do not edit files" in smoke prompts; redirect history files to ignored local state. |
| antigravity | <date> | Antigravity 1.107.0 | gui_only | antigravity chat --mode ask "<prompt>" | none | Command opens/targets the GUI chat and returned no stdout/stderr result. |
| cursor | <date> | Cursor 3.3.22 | gui_only | <Cursor install>/resources/app/bin/cursor.cmd --chat | none | CLI is an editor/chat launcher and may not be on PATH. |
| claude | <date> | Claude Code 2.1.132 | billing_blocked | claude -p "<prompt>" --output-format json --permission-mode plan --no-session-persistence | JSON result with usage/error metadata | CLI and auth can be valid while billing, quota, or probe budget blocks live completion. |
```

Do not copy local absolute paths into `AIMemory/AGENTS.md`.

## Local override fields

Use `.agent-work-mux/agents.local.md` for machine-local details:

```markdown
# Local AgentWorkMux Agent Hints

## opencode
- command: opencode run --model deepseek/deepseek-v4-flash --format json "<prompt>"
- raw_log_root: .agent-work-mux/probes/<timestamp>/opencode/

## continue
- command: cn [--config <config-if-needed>] --readonly -p "<prompt>" --format json
- config_hint: if Continue's configured secret already populates model `apiKey`, no override is needed; if local env fallback returns DeepSeek 401, include `apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}` in the local model entry.
- server: cn serve --port <port>
- headless_status: pass
- safety: use `--readonly` for plan/read-only probes; use `--allow`, `--ask`, or `--exclude` for per-tool gates before enabling edits.
- auth: after setting a User-scope variable on Windows, open a fresh shell or inject `[Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")` into the probe process.

## codex
- command: codex exec --ephemeral --json --output-last-message <last-message-file> --cd <project> "<prompt>"

## gemini
- command: gemini --prompt "<prompt>" --approval-mode plan --output-format json --skip-trust
- headless_status: pass

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
- command: claude -p "<prompt>" --output-format json --permission-mode plan --no-session-persistence
- version: Claude Code 2.1.132
- headless_status: billing_blocked
- correction_needed: confirm account billing/quota or raise the probe budget cap, then re-run `/awm agents test claude --smoke`.
```

## Classification

- `untested` - alias was registered but no smoke probe has run yet.
- `pass` - command returned expected response in stdout or declared output file.
- `pass_with_warnings` - expected response returned, but non-fatal warnings
  appeared.
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
