# AgentWorkMux

[English README](README.md)

> AI 코딩 에이전트를 위한 마크다운 기반 작업 기억과 작업 라우팅 프로토콜.

AgentWorkMux는 Claude Code, ChatGPT Codex CLI, OpenCode, Antigravity,
Cursor, Aider, Cline, Continue, Windsurf, gemini-cli 같은 에이전트들이 같은
프로젝트 기억을 읽고, 목표 단위 작업을 나누고, 세션이 바뀌어도 이어서 일할
수 있게 해줍니다.

기본 저장소는 `AIMemory/`이고, 가장 중요한 사용법은 `/awm goal`입니다.

---

## 빠른 시작

프로젝트 루트에서 아무 에이전트나 열고 이렇게 말하세요.

```text
Fetch https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/prompt.md and apply it to this project.
```

또는:

```text
Install daystar7777/agent-work-mux into this project.
```

설치가 끝나면 `AIMemory/`가 만들어지고 AgentWorkMux 프로토콜이 적용됩니다.

---

## 핵심 사용법: `/awm goal`

목표 단위 오케스트레이션이 필요하면 `/awm goal`을 사용합니다.

```text
/awm goal "Ship the auth hardening slice. Claude implements, Codex reviews, and the current agent writes the final report."
```

`/awm goal`은 자연어 goal request를 받습니다. request의 첫 단어가 `list`나
`status` 같은 예약 subcommand가 아니면 따옴표는 생략할 수 있습니다.
AgentWorkMux는 목표 파일을 만들고, 프로젝트별 alias를 해석하고, 기본적으로
계획 수립 뒤 auto-run으로 진행합니다.

Headless 실행은 반드시 명시적인 `/awm` 명령이 있을 때만 시작합니다. 그냥
자연어로 “Claude가 구현하고 Gemini가 테스트해줘”라고 말하는 것만으로는
headless worker를 실행하지 않습니다.

---

## 새 세션에서 이어서 하기

다른 에이전트나 새 세션을 열었을 때는 이렇게 말하면 됩니다.

```text
Read the project structure and AIMemory, then tell me you understand the current state.
```

에이전트는 `AIMemory/INDEX.md`, `AIMemory/PROJECT_OVERVIEW.md`,
`AIMemory/work.log`의 최근 내용을 읽고 현재 상태를 파악합니다.

---

## 무엇을 기록하나요?

주요 기록은 `AIMemory/` 아래에 남습니다.

```text
AIMemory/
  INDEX.md
  PROJECT_OVERVIEW.md
  PROTOCOL.md
  INSTALLATION.md
  AGENTS.md
  work.log
  goals/
    ACTIVE.md
    INDEX.md
  archive/
  cold/
  handoff_*.md
```

- `work.log`: 프롬프트, 작업 시작/종료, 파일 변경, lifecycle 이벤트를 기록
- `goals/`: `/awm goal`의 현재 cursor, 상태, 결과, 오류, 최종 보고서 기록
- `goals/ACTIVE.md`: 현재 목표와 다음 재개 지점을 가리키는 pointer
- `goals/INDEX.md`: 이전 goal까지 포함한 상태, 실행 시각, token/cost, 결과 문서 ledger
- `AGENTS.md`: 프로젝트별 agent alias와 routing 정책
- `INSTALLATION.md`: 설치, 제거, 재설치 이력
- `handoff_*.md`: 수동 AICP handoff 메시지

Runner나 worker의 긴 원문 출력은 `AIMemory/`에 넣지 않습니다. raw log는
gitignore된 `.agent-work-mux/runs/`에 두고, orchestrator에는 요약 결과와 오류만
전달합니다.

---

## 명령

```text
/awm setup
/awm agents
/awm agents test [--all | <agent-selector>] [--smoke]
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

`/awm setup`은 lifecycle 메타데이터, alias, runner pointer를 갱신하지만 그 자체로
worker를 실행하지 않습니다.

새 goal request는 첫 단어가 예약어가 아니면 따옴표 없이도 사용할 수 있습니다.
다만 request가 `list`, `history`, `status`, `pause`, `resume`, `stop`,
`clear`로 시작하면 subcommand와 충돌하므로 따옴표로 감싸야 합니다.

```text
/awm goal "다음 페이즈 설계하고 클로드로 구현한 뒤 제미나이로 테스트하고 결과 정리해줘"
```

`list`, `history`, `status`, `pause`, `resume`, `stop`, `clear`는 `/awm goal`
예약 subcommand입니다.

---

## Agent call probe

설치 직후 실제 goal을 맡기기 전에 작은 호출 테스트를 돌리는 것을 권장합니다.

```text
/awm agents test --all --smoke
```

이 명령은 `agent-call-probe.md`를 lazy-load하고, 각 worker agent에 아주 짧은
프롬프트를 보내 호출 가능 여부를 확인합니다. raw log는 ignored
`.agent-work-mux/probes/`에 두고, 재사용 가능한 요약 힌트만 `AIMemory/AGENTS.md`에
남깁니다.

에이전트 버전이 바뀌면 probe를 다시 돌려서 invocation hint와 알려진 오류/교정법을
갱신합니다. `/awm agents hints`는 agent를 호출하지 않고 기존 힌트만 읽습니다.

---

## `/awm goal` 동작 메커니즘

`/awm goal`은 Codex식 goal tracking에서 유용한 구조를 가져오되, 상태를
마크다운에 남겨 어떤 에이전트라도 이어받을 수 있게 합니다.

- `AIMemory/goals/ACTIVE.md`: 현재 goal, 상태, 마지막 완료 task, 다음 checkpoint,
  final report 작성 여부를 가리킵니다.
- `AIMemory/goals/INDEX.md`: `/awm goal list`나 `/awm status --all` 때만
  lazy-read하는 goal ledger입니다. 목표, 상태, 생성/수정/완료 시각, orchestrator,
  token/cost telemetry, final report 경로, goal record 경로를 보여줍니다.
- Goal record: objective, parsed tasks, worker assignment, policy, 결과, 오류,
  telemetry, completion guard 상태를 담습니다.
- State gate: 상태가 `active`일 때만 runner dispatch가 가능합니다.
  `awaiting_user`, `paused`, `error_paused`는 auto-run을 즉시 멈춥니다.
- Budget/telemetry loop: worker 결과마다 요약 counter와 checkpoint만 갱신하고,
  raw log는 `.agent-work-mux/runs/`에 둡니다.
- Completion guard: 모든 task가 정리되고, 오류/검증/최종 보고서가 기록되기 전에는
  `complete`로 바꾸지 않습니다.
- `stop`: 사용자가 goal을 더 진행하지 않기로 한 terminal state입니다.
- `clear`: 기본적으로 `ACTIVE.md`나 ledger 표시만 정리하고, goal record 원본은
  명시적인 삭제 확인 전에는 지우지 않습니다.

이 구조 덕분에 긴 작업도 메인 에이전트 컨텍스트를 불리지 않고 재개할 수 있습니다.
worker가 token 사용량을 제공하지 않으면 `unknown`, 추정치면 `estimated`로 기록합니다.

---

## Agent selector와 alias

에이전트 지정은 다음 형식을 씁니다.

```text
<agent>[:<model-or-tier>[:<profile>]]
```

예:

```text
claude
claude:opus-4.7:max
gemini:pro
codex:gpt-5-codex
```

에이전트 이름만 쓰면 orchestrator가 작업 난이도에 맞춰 모델/profile을 고르고,
그 선택을 goal record에 기록합니다.

`claude-max`, `deepseek-pro-max` 같은 alias는 프로젝트별로
`AIMemory/AGENTS.md`에 정의합니다.

---

## 설치, 업그레이드, 제거

`agent-work-mem`은 deprecated로 보고, 기존 설치가 감지될 때만
`migration.md`를 lazy-load합니다. migration은 `AIMemory/`를 보존하고, 중복
bootstrap을 하지 않으며, legacy reminder block만 AgentWorkMux sentinel로
교체합니다. `.agent-work-mem/` 로컬 상태는 사용자 동의가 있을 때만 삭제합니다.

기존 `AIMemory/`를 v3로 업그레이드:

```text
Fetch https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/upgrade.md and execute it on this project.
```

deprecated `agent-work-mem` 설치를 감지했을 때만 migration:

```text
Fetch https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/migration.md and execute it on this project.
```

`AIMemory/`를 보존한 채 AgentWorkMux 동작만 제거:

```text
Fetch https://raw.githubusercontent.com/daystar7777/agent-work-mux/main/uninstall.md and execute it on this project.
```

제거는 기본적으로 detach입니다. `AIMemory/`는 지우지 않고, 관리되는 reminder
block만 제거합니다. `.agent-work-mux/` 같은 로컬 runner 상태는 사용자가 명시적으로
동의할 때만 삭제합니다.

---

## 보안과 gitignore

다음은 git에 올리지 않는 것이 기본입니다.

```text
AIMemory/
.agent-work-mux/
.agent-work-mem/
.codex/
.claude/
.opencode/
```

`AGENTS.md`, `INSTALLATION.md`, `work.log`, goal record, handoff 파일에는 secret,
token, credential, 개인 실행 파일 경로를 넣지 마세요. 개인 경로나 인증 정보는
환경 변수나 ignored local override에 둡니다.

---

## 한 줄 요약

AgentWorkMux는 여러 AI 코딩 에이전트를 같은 프로젝트 기억에 연결하고,
명시적인 `/awm goal`로 목표 단위 작업을 라우팅하며, 결과와 오류만 깔끔하게
남기는 마크다운 우선 프로토콜입니다.
