# Goal: Auth hardening

**Goal-id**: auth-hardening-20260507
**Objective**: Ship the auth hardening slice.
**Created**: 2026-05-07T08:45:00Z
**Updated**: 2026-05-07T08:57:00Z
**Created by**: gpt-5-codex
**Orchestrator**: gpt-5-codex @ ChatGPT Codex CLI
**State**: active
**Auto-run**: true
**Policy**: implement_then_verify
**Budget hint**: none
**Raw-log root**: .agent-work-mux/runs/auth-hardening-20260507/

## User request

`/awm goal "Ship the auth hardening slice. Claude implements, Codex reviews."`

## Parsed plan
| Task | Agent selector | Resolved agent | Status | Result |
|------|----------------|----------------|--------|--------|
| Implement refresh-token lock fix | claude-max | claude:opus-4.7:max | complete | See Results. |
| Review race-safety and tests | codex | codex:gpt-5-codex:auto | active | Pending compact result. |

## Dispatch preview

- Goal: Ship the auth hardening slice.
- Output root: existing auth module and tests only.
- Policy: implement_then_verify
- Design summary: serialize refresh-token family updates in the persistence
  layer, keep the public refresh API stable, and prove the concurrent refresh
  path with regression tests.
- Phases:
  1. Implement refresh-token lock fix
     - Worker: claude:opus-4.7:max
     - Scope: `/repo/src/auth/refresh.ts`,
       `/repo/src/auth/__tests__/refresh.test.ts`
     - Expected capsule:
       `.agent-work-mux/runs/auth-hardening-20260507/implement/result.json`
     - Timeout: implementer 30m
  2. Verify race-safety and tests
     - Worker: codex:gpt-5-codex:auto
     - Scope: inspect changed auth files, run targeted auth tests, write verdict
     - Expected capsule:
       `.agent-work-mux/runs/auth-hardening-20260507/review/verdict.json`
     - Timeout: verifier 30m + finalization grace 3m
- Quality gates: no refresh-token race, targeted tests pass, score >= 85, no
  secret leakage, compact logs only.
- Controller boundary: controller owns design, dispatch, capsule validation, and
  final decision; verifier owns test/review details and raw-log summarization.

## Quality contract

- Minimum score: 85
- Hard fail gates: refresh-token race still possible; required tests fail;
  verifier score below threshold; missing compact verifier verdict.
- Warning gates: missing regression coverage detail; unclear migration notes.
- Domain checklist: row-level locking or equivalent atomicity, regression
  tests for concurrent refresh, no secret leakage, compact logs only.
- Stop conditions: accept PASS with no blockers and score >= 85; allow one
  narrow fix round for a precise verifier finding; pause on repeated missing
  capsules or ambiguous scope.
- Verifier capsule: write `verdict.json` skeleton before expensive checks and
  update it after each phase.
- Implementer capsule: write `result.json` skeleton before expensive or
  potentially long-running commands.
- Implementer boundary: when a verifier is assigned, the implementer creates
  code and scripts but does not run verifier-owned acceptance phases or direct
  long-running service commands.
- Optional cost/quality policy: `deepseek_build_verify_codex_fix` may be used
  when DeepSeek workers implement and verify while Codex applies only precise
  verifier findings.

## Integration contract

- Components: refresh-token API handler, token persistence layer, concurrent
  request test suite, final review verdict.
- Component contracts: refresh handler returns one valid replacement token per
  refresh family; persistence layer serializes competing refresh attempts; test
  suite simulates concurrent refresh calls.
- Assembly contract: handler and persistence layer together prevent token
  reuse/race while preserving the public refresh API.
- End-to-end acceptance: verifier proves the concurrent refresh regression
  fails before the fix or is represented by an equivalent test, passes after
  the fix, and no auth contract regressions are introduced.

## Results

- Implementation changed `/repo/src/auth/refresh.ts` and
  `/repo/src/auth/__tests__/refresh.test.ts`.
- Test command: `npm test -- refresh`.
- Implementer result capsule:
  `.agent-work-mux/runs/auth-hardening-20260507/implement/result.json`.
- Verifier verdict capsule:
  `.agent-work-mux/runs/auth-hardening-20260507/review/verdict.json`.
- Raw worker logs: `.agent-work-mux/runs/auth-hardening-20260507/`
  (load only if debugging is needed).

## Errors

(none yet)

## Telemetry

- Tasks total: 2
- Tasks complete: 1
- Worker token usage: unknown
- Worker token source: unknown
- Worker cost: unknown
- Orchestrator token usage: unknown
- Orchestrator token source: unknown
- Orchestrator cost: unknown
- Goal token total: unknown
- Metrics summary: .agent-work-mux/runs/auth-hardening-20260507/metrics/summary.json
- Last checkpoint: implementation compact result recorded; review running
- Compact result bytes: small
- Raw logs loaded into orchestrator: none
- Controller log policy: verifier_owned_logs
- Quality score: pending verifier verdict

## Completion guard

- [ ] Every parsed task is complete, skipped with reason, or blocked with final disposition.
- [x] Errors are fixed, documented, or accepted by the user.
- [ ] Required verification is recorded.
- [ ] Final report is written.
- [ ] ACTIVE.md is cleared or points to the completed goal.

## Final report

(written by orchestrator when state becomes `complete`)
