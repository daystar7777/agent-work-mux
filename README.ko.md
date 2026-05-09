# AgentWorkMux

[English README](README.md)

> AI 코딩 에이전트를 위한 마크다운 기반 작업 기억과 작업 라우팅 프로토콜.

AgentWorkMux는 Claude Code, ChatGPT Codex CLI, OpenCode, Aider,
Continue, gemini-cli 같은 headless 가능 파일 에이전트들이 같은 프로젝트 기억을
읽고, 목표 단위 작업을 나누고, 세션이 바뀌어도 이어서 일할 수 있게 해줍니다.

Headless worker 지원은 마크다운 호환 범위보다 좁게 봅니다. 현재 probe에서
Cursor와 Antigravity처럼 창이나 chat만 여는 editor launcher는 stdout이나 결과
파일을 machine-readable하게 돌려주기 전까지 `gui_only`로 분류합니다.

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

새 goal 오케스트레이션은 반드시 `/awm goal <request>` 또는 `/awm goals <request>` 형식을 사용합니다. 그 외 AWM 명령은
`/awm ...`로 써도 되고, “AgentWorkMux 다시 setup 해줘”, “agents 목록 보여줘”,
“오픈코드의 딥시크를 등록해줘”, “모든 agents 테스트해줘”처럼 의도가 분명한
자연어로도 실행할 수 있습니다.

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
- `goals/INDEX.md`: 이전 goal까지 포함한 상태, 실행 시각, quality score,
  worker/orchestrator별 token/cost, 결과 문서 ledger
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
/awm agents list
/awm agents add <description> [--as <alias>] [--selector <agent[:model-or-tier[:profile]]>]
/awm agent add <alias> <selector-or-description>
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

`/awm setup`은 lifecycle 메타데이터, alias, runner pointer를 갱신하지만 그 자체로
worker를 실행하지 않습니다. Runner helper 실행파일은 repo의 정식 소스가 아니라
`*.js.md` helper spec에서 필요할 때 lazy 생성되는 로컬 산출물입니다. 이 spec에는
생성 유의점, OS/runtime별 차이, 검증 룰, 추출 가능한 OS별 code block이 함께
들어갑니다. 생성되는 helper는 기본적으로 새 외부 런타임 의존성을 만들지 않아야
합니다. Windows에서는 PowerShell과 필요 시 `.cmd` shim을, Unix 계열에서는 POSIX
`sh`를 우선 사용하고, `bash`, Node, .NET은 setup/probe가 사용 가능한 fallback으로
명시 선택한 경우에만 씁니다. Windows `.cmd`는 안정된 명령명을 위한 shim이며,
내부 runner 호출은 실제 helper entrypoint와 명시적 인자를 사용합니다. 생성 후에는
`.agent-work-mux/bin/` 아래의 안정된 runtime artifact로 재사용하고, goal 실행 중
prompt를 바꿔 다시 생성하지 않습니다.

`/awm agents`와 `/awm agents list`는 등록된 alias와 call hint만 보여주며 worker를
테스트하거나 실행하지 않습니다. “등록된 agents 보여줘” 같은 자연어도 여기에
매핑합니다.

`/awm agents add 오픈코드의 딥시크`처럼 말하면 `AIMemory/AGENTS.md`에
`opencode-deepseek -> opencode:deepseek:auto` 같은 안전한 프로젝트 alias를
등록합니다. 등록만 하고 worker 테스트나 실행은 하지 않습니다.

직접 alias를 정하고 싶으면 singular shortcut을 씁니다.
`/awm agent add 딥시크 오픈코드:딥시크`와
`/awm agent add 딥시크 오픈코드의 딥시크`는 둘 다
`딥시크 -> opencode:deepseek:auto`로 등록합니다.

자연어는 명확한 non-goal AWM 명령으로 라우팅할 수 있지만, 새 goal 생성은
자연어만으로 시작하지 않습니다. 목표 단위 오케스트레이션은 `/awm goal ...` 또는
`/awm goals ...`를 사용해야 합니다. Guarded CLI live 실행 규칙도 그대로 적용됩니다.

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

이 명령은 `agent-call-probe.md`를 lazy-load하고 각 worker agent를 probe합니다.
raw log는 ignored `.agent-work-mux/probes/`에 두고, 재사용 가능한 요약 힌트만
`AIMemory/AGENTS.md`에 남깁니다. Guarded CLI인 Codex CLI, Claude CLI,
Gemini CLI는 기본적으로 check-only입니다. 버전과, 가능한 경우 프롬프트를 보내지
않는 auth 상태만 확인하고, 사용자가 실제 실행을 명시하거나 `--live`를 붙였을 때만
프롬프트를 보냅니다. 이렇게 해서 Codex가 Codex CLI를, Claude가 Claude CLI를,
Antigravity/Gemini가 Gemini CLI를 기본값으로 재귀 호출하지 않게 합니다.

에이전트 버전이 바뀌면 probe를 다시 돌려서 invocation hint와 알려진 오류/교정법을
갱신합니다. `/awm agents hints`는 agent를 호출하지 않고 기존 힌트만 읽습니다.

현재 기본 worker smoke 형태는 `opencode run --format json`, `aider --message
... --no-git --no-auto-commits`에 history 파일을 `.agent-work-mux/tmp/` 아래로
돌리는 형태, Continue의 `cn --readonly -p ... --format json`입니다. Guarded live
형태인 `codex exec --json`, `gemini --prompt ... --approval-mode plan
--output-format json`, `claude -p ... --output-format json`은 사용자가 명시적으로
요청하거나 `--live`를 붙였을 때만 실행합니다.

Continue는 IDE 전용이 아니라 `cn` CLI로도 지원합니다. `cn -p "<prompt>"`는
headless 1샷 호출이고, `--format json`은 machine-readable 출력을 제공합니다.
`cn serve --port <port>`는 `/state`, `/message` HTTP server 표면을 엽니다.
`--readonly`는 plan/read-only mode이며, `--allow`, `--ask`, `--exclude`로
tool별 권한을 조절할 수 있습니다. DeepSeek은 Continue가 지원하는 어떤 secret
설정이든 model `apiKey`에 제대로 연결되어 있으면 그대로 쓰면 됩니다. 다만
local env fallback에서 `Bearer sk-` 문구가 들어간 DeepSeek 401이 나면, 그 로컬
config에는 `apiKey: ${{ secrets.//DEEPSEEK_API_KEY }}` 같은 명시적 secret
reference를 추가합니다.

Claude Code는 명시적 live probe에서 `claude -p "<prompt>" --output-format json
--permission-mode plan`을 씁니다. 기본값은 `claude --version`과 auth 상태 확인만
합니다. 사용자가 승인한 live 실행이 계정 결제, quota, 또는 probe budget cap 때문에
막히면 `missing_path`가 아니라 `billing_blocked`로 분류합니다.

---

## `/awm goal` 동작 메커니즘

`/awm goal`은 Codex식 goal tracking에서 유용한 구조를 가져오되, 상태를
마크다운에 남겨 어떤 에이전트라도 이어받을 수 있게 합니다.

- `AIMemory/goals/ACTIVE.md`: 현재 goal, 상태, 마지막 완료 task, 다음 checkpoint,
  final report 작성 여부를 가리킵니다.
- `AIMemory/goals/INDEX.md`: `/awm goal list`나 `/awm status --all` 때만
  lazy-read하는 goal ledger입니다. 목표, 상태, 생성/수정/완료 시각, orchestrator,
  quality score, worker/orchestrator별 token/cost telemetry, final report 경로,
  goal record 경로를 보여줍니다.
- Goal record: objective, parsed tasks, worker assignment, policy, 결과, 오류,
  telemetry, completion guard 상태를 담습니다.
- State gate: 상태가 `active`일 때만 runner dispatch가 가능합니다.
  `awaiting_user`, `paused`, `error_paused`는 auto-run을 즉시 멈춥니다.
- Budget/telemetry loop: worker 결과마다 요약 counter와 checkpoint만 갱신하고,
  raw log는 `.agent-work-mux/runs/`에 둡니다.
- Quality contract: 구현형 goal은 dispatch 전에 코드 품질 기준과 verifier rubric을
  명시합니다. worker가 단순히 visible spec과 테스트 통과에만 최적화하지 않도록
  합니다.
- Integration contract: orchestrator는 component boundary, public data/API
  contract, assembly rule, end-to-end acceptance를 정의해서 부품들의 합이
  요청한 전체가 되도록 설계합니다.
- Dispatch preview: 첫 worker launch 전에 orchestrator가 objective, output root,
  design summary, phase, phase별 worker/verifier 배정, capsule path, timeout
  policy, quality gate, controller/verifier role boundary를 compact하게 보여줍니다.
  사용자가 끊거나 계획이 애매하지 않으면 auto-run은 계속됩니다.
- Verifier-owned logs: verifier/tester task가 있으면 raw worker log는 verifier가
  읽고, orchestrator는 verifier가 남긴 compact `verdict.json`만 기다립니다.
- Controller trust discipline: dispatch 뒤에는 worker/verifier binding을 믿고,
  timeout, missing capsule, failed exit, 명시적 debug 요청이 없으면 source 검사,
  test 재실행, progress log 읽기를 반복하지 않습니다.
- Controller role boundary: verifier/tester가 배정되어 있으면 backend/frontend
  test, smoke test, live server/API/browser probe, 품질 리뷰, raw-log 요약은
  verifier/tester의 일입니다. orchestrator는 설계, dispatch, capsule 검증,
  최종 판정, 최종 보고서에 집중합니다.
- Capsule fail-fast: worker가 timebox 안에 필수 `result.json`/`verdict.json`
  capsule을 남기지 못하면 무한 진행으로 보지 않고 `TIMEOUT_MISSING_CAPSULE`로
  기록합니다. 산출물이 있으면 verifier에게 검토를 넘기고, 반복되면 pause합니다.
- Verifier capsule resilience: verifier는 비싼 검증을 시작하기 전에
  `verdict.json` skeleton을 먼저 만들고, 각 phase 뒤에 갱신합니다. timeout이
  나도 완전한 정보 없음 상태가 되지 않게 합니다.
- Split timebox: verifier timeout은 시작/무출력, active work, 최종 verdict 작성
  grace period를 분리해서 잡습니다. smoke PASS 직후 verdict 작성 직전에 죽이지
  않도록 합니다.
- 기본 code-goal timeout은 넓은 구현 30분, 검증 30분, 그리고 phase 완료 뒤
  verdict 작성 grace 3분입니다. 짧은 smoke probe는 더 작은 명시 limit를 쓸 수
  있습니다.
- Background dispatch는 shell-free `launch.json` contract를 사용합니다. `cwd`,
  `cmd`, `args[]`를 분리하고, worker CLI를 긴 `Start-Process` 문자열 하나로
  실행하지 않습니다.
- Helper 이름과 호출 파라미터는 ABI로 고정합니다. 현재 논리 명령은
  `awm-launch <launch.json>`,
  `awm-watch --run-dir <dir> --expected-capsule <file> --attempt-id <id>
  --timeout-ms <n> --idle-ms <n> --json`,
  `awm-helper-self-test --manifest <file> --json`,
  `awm-capsule-probe --agent <selector> --run-dir <dir> --expected-capsule <file>
  --timeout-ms <n> --json`입니다. OS별 wrapper 확장자는 허용하지만 이름과 필수
  parameter를 generation 중 마음대로 바꾸면 안 됩니다.
- 상대 path 구조도 ABI입니다. absolute project root나 output root는 바뀔 수 있지만,
  그 root 아래의 runner-owned 파일명과 위치는 고정입니다. 예를 들어
  `testprj001/phase001/` 아래에서 실행하면
  `testprj001/phase001/.agent-work-mux/runs/<goal-id>/<task-id>/launch.json`,
  `result.json`, `verdict.json`, `watch.json`,
  `.agent-work-mux/runs/<goal-id>/metrics/summary.json` 위치를 예측할 수 있어야 합니다.
- launcher/controller는 dispatch 전에 runner가 소유하는 task/capsule/log/status/
  diagnostic/prompt/metrics parent directory를 idempotent filesystem API로 먼저
  만듭니다. worker/verifier는 그 runner path를 직접 만들지 않는 것이 원칙입니다.
- Windows에서는 worker/verifier prompt나 bridge command에 `mkdir -p`를 넣지
  않습니다. app-owned directory가 필요하면 Node recursive mkdir 또는 PowerShell
  `New-Item -ItemType Directory -Force`를 쓰고, 이미 있는 directory는 성공으로
  봅니다.
- `result.json`, `verdict.json`, `controller_status.json`, `diagnostics.json`,
  metrics summary 같은 compact runner file은 같은 directory의 temp file에 쓴 뒤
  rename하는 atomic write를 기본으로 합니다.
- Windows npm/global shim인 `opencode.cmd`, `opencode.ps1` 같은 wrapper는 spawn
  전에 실제 executable과 package entrypoint로 정규화합니다. 예: `node.exe` +
  CLI JS entrypoint. 이를 위해 `shell: true`로 돌아가지 않습니다.
- Windows OpenCode background worker는 launch `"stdio_mode": "file"` 또는 같은
  bridge를 사용합니다. Node pipe stream으로 stdout/stderr를 잡지 말고 파일에
  직접 연결한 뒤 file size로 heartbeat byte count를 계산합니다.
- OpenCode prompt file은 `prompt_file`과 `"prompt_mode": "inline"`으로
  기록하고, 일반 message 안의 `{{awm_prompt_text}}`로 직접 전달합니다. 큰
  구현 작업에서 worker가 자기 prompt 파일을 읽는 데 의존하지 말고, worker
  prompt 자체를 OpenCode `--file`로 넘기지 않으며, source-file용 `--file`이
  필요하면 message 뒤에 둡니다.
- provider secret은 launch `required_env`에 둡니다. OpenCode DeepSeek는
  `DEEPSEEK_API_KEY`를 요구하고, launcher가 가능하면 Windows User/Machine
  scope에서 주입합니다. 필수 auth 누락은 verifier finding이 아니라 critical
  launch failure입니다.
- launcher가 이미 `cwd`를 정했으면 같은 workspace 경로를 `--dir`, `--cwd`,
  positional path arg로 다시 넘기지 않습니다. task workspace 기준 상대 경로를
  우선합니다.
- Launch/runtime failure는 verifier 판단과 분리합니다. `LAUNCH_FAILED`는 process가
  제대로 시작되지 않은 상태이고, `RUNTIME_FAILED_NO_CAPSULE`은 process가 빨리
  종료됐지만 기대 capsule을 남기지 않은 상태입니다.
- 기대 capsule이 있으면 bridge exit-code 불확실성보다 capsule을 우선합니다.
  이 경우 `CAPSULE_PRESENT`로 분류하고, `ExitCode = null` 또는 non-zero child
  exit은 diagnostics에만 남기며 `critical-error.json`을 남기지 않습니다.
- Diagnostic output은 action 가능성 기준으로 분리합니다. `stderr.log`는 raw
  private evidence로 남기고, `warnings.jsonl`은 verifier에게 흘려보내며,
  `critical-error.json`은 controller 개입 신호로 봅니다. `diagnostics.json`은
  compact status와 byte count를 담습니다.
- Timeout check는 task-attempt 단위입니다. runtime timeout은 현재 pid/heartbeat의
  `process_started_at`부터 재고, goal 생성 시각, run directory mtime,
  `launch.json` mtime, 이전 attempt의 stale status file을 기준으로 삼지 않습니다.
- launcher는 현재 attempt의 `task_started_at`을 기록하고
  `AWM_TASK_STARTED_AT`, `AWM_DEADLINE_AT` 같은 env var 또는 prompt placeholder로
  worker에게 넘깁니다. 그래서 capsule도 같은 시간 기준을 보고할 수 있습니다.
- Bounded repair loop: verifier 이후 수정은 정확한 finding, 허용 파일 범위,
  기대 capsule이 있는 narrow fix만 허용합니다. 기본은 구현 1회 + narrow fix 1회,
  필요할 때만 두 번째 narrow fix를 허용합니다.
- `deepseek_build_verify_codex_fix`: 비용/품질 균형용 기본 프리셋입니다.
  DeepSeek이 구현하고, DeepSeek이 품질검증/verdict를 쓰고, Codex는 정확한
  verifier finding이 있을 때만 좁게 수정하고, 최종 판정은 다시 DeepSeek verifier가
  합니다.
- Implementer boundary: verifier/tester가 배정되어 있으면 implementer는 앱,
  script, artifact를 만들되 backend/frontend/smoke/live-server acceptance phase나
  `npm start` 같은 장시간 foreground command를 직접 실행하지 않습니다. live
  service check와 process cleanup은 verifier/tester의 일입니다.
- Capsule skeleton: implementer는 비싼 check나 hang 가능성이 있는 command 전에
  parse 가능한 `result.json` skeleton을 먼저 남깁니다. 그러면 뒤에서 멈춰도
  missing-capsule만 남는 정보 없는 실패가 되지 않습니다.
- Capsule-first exit: 기대한 capsule이 없으면 child process가 `0`으로 끝났어도
  launcher는 non-zero로 종료해야 합니다. 성공 여부는 raw child exit code가 아니라
  compact capsule/status가 결정합니다.
- Completion guard: 모든 task가 정리되고, 오류/검증/최종 보고서가 기록되기 전에는
  `complete`로 바꾸지 않습니다.
- `stop`: 사용자가 goal을 더 진행하지 않기로 한 terminal state입니다.
- `clear`: 기본적으로 `ACTIVE.md`나 ledger 표시만 정리하고, goal record 원본은
  명시적인 삭제 확인 전에는 지우지 않습니다.

이 구조 덕분에 긴 작업도 메인 에이전트 컨텍스트를 불리지 않고 재개할 수 있습니다.
worker가 token 사용량을 제공하지 않으면 `unknown`, 추정치면 `estimated`로 기록합니다.

구현형 goal의 기본 quality gate에는 입력 검증, request body size limit, atomic JSON
write, 안전한 localhost bind, Markdown/link XSS 방지, tag 정규화/중복 제거,
deterministic ordering, README/run instruction, `.gitignore`, generated dependency
folder 제외, phase test와 smoke check가 포함됩니다. verifier는 테스트 재실행뿐
아니라 이 기준으로 0-100점 점수, blockers, warnings, controller action을 남깁니다.

설계 단계에서는 integration contract도 남깁니다. 어떤 component가 있고, 각
component의 public contract가 무엇이며, 어떻게 조립되어야 전체 기능이 성립하는지,
그리고 어떤 end-to-end 동작이 이를 증명하는지를 tester/verifier에게 넘깁니다.

verifier가 `PASS`, blocker 없음, quality threshold 이상을 반환하면 추가 품질점수를
쫓지 않고 accept합니다. 측정은 `.agent-work-mux/runs/<goal-id>/metrics/summary.json`에
worker와 orchestrator token/cost를 분리해서 남기며, 실패/timeout 시도도 포함합니다.

Node.js goal에서는 generated dependency folder를 산출물 기준으로 판단합니다.
implementer는 `npm install` 전에 `.gitignore`를 만들고 `node_modules`를 제외해야
합니다. 검증 뒤 working directory에 `node_modules`가 있어도 ignore되어 있고
`artifact_paths`에 없으면 자동 hard fail은 아닙니다. verifier는 dependency folder를
재귀 스캔하지 않고 top-level 존재, `.gitignore`, artifact manifest만 확인합니다.

`deepseek_build_verify_codex_fix`에서 Codex는 장시간 reviewer가 아니라 narrow
patcher입니다. verifier가 `controller_action: fix`와 정확한 finding, 허용 파일
범위를 줄 때만 수정합니다. 현재 orchestrator가 Codex이면 이 단계에서 Codex CLI를
따로 호출하지 않고 현재 세션의 Codex가 patch를 적용합니다.

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

새 alias는 `/awm agents add <description>`로 등록할 수 있습니다. 예를 들어
`/awm agents add 오픈코드의 딥시크`는 별도 지정이 없으면
`opencode-deepseek -> opencode:deepseek:auto`로 정규화합니다. `--as`로 alias를,
`--selector`로 정확한 selector를 지정할 수 있습니다. 새 alias는
`/awm agents test <alias> --smoke`가 통과하기 전까지 untested로 봅니다.

alias를 첫 인자로 직접 주는 `/awm agent add <alias> <selector-or-description>`
형태도 지원합니다. 그래서 `/awm agent add 딥시크 오픈코드:딥시크`와
`/awm agent add 딥시크 오픈코드의 딥시크`는 같은 결과를 냅니다.

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
명시적인 `/awm goal`로 새 목표 단위 작업을 라우팅하며, 그 밖의 AWM 관리 명령은
자연어로도 받아들이는 마크다운 우선 프로토콜입니다.
