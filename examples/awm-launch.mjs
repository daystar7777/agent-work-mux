#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, openSync, readSync, statSync } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";

const now = () => new Date().toISOString();
const STDERR_TAIL_LIMIT = 4096;
const DEFAULT_STARTUP_TIMEOUT_MS = 60000;
const DEFAULT_INLINE_PROMPT_MAX_BYTES = 24000;
const WINDOWS_WRAPPER_EXTENSIONS = new Set([".cmd", ".bat", ".ps1"]);
const PROMPT_MODES = new Set(["path_reference", "inline", "none"]);
const STDIO_MODES = new Set(["pipe", "file"]);
const OPTIONS_WITH_VALUES = new Set([
  "-f",
  "--file",
  "-m",
  "--model",
  "--variant",
  "--format",
  "--output",
  "--port",
  "--cwd",
  "--dir",
  "--directory",
  "--config"
]);

const criticalPatterns = [
  {
    category: "executable_not_found",
    pattern: /(spawn .* ENOENT|command not found|not recognized as|executable file not found)/i,
    retryable: false,
    recommended_retry: "Verify the agent executable path and PATH environment."
  },
  {
    category: "path_or_cwd",
    pattern: /(cannot find path|system cannot find the path|no such file or directory|not a directory|ENOENT|디렉터리 이름이 올바르지 않습니다)/i,
    retryable: true,
    recommended_retry: "Set cwd to the task root and remove duplicate --dir/--cwd path arguments."
  },
  {
    category: "invalid_arguments",
    pattern: /(unknown option|unrecognized option|invalid option|unexpected argument)/i,
    retryable: true,
    recommended_retry: "Regenerate launch args[] from the agent invocation hint."
  },
  {
    category: "auth_or_billing",
    pattern: /(401|403|unauthorized|authentication fails|billing|quota|insufficient_quota|payment required)/i,
    retryable: false,
    recommended_retry: "Pause for user auth, billing, or quota action."
  },
  {
    category: "permission",
    pattern: /(permission denied|EACCES|EPERM|access is denied)/i,
    retryable: true,
    recommended_retry: "Check workspace permissions and tool approval mode."
  },
  {
    category: "parse_failure",
    pattern: /(SyntaxError|JSON\.parse|Unexpected token|invalid json)/i,
    retryable: true,
    recommended_retry: "Check generated JSON and prompt/capsule formatting."
  }
];

const warningPatterns = [
  { category: "deprecation", pattern: /(deprecated|deprecation)/i },
  { category: "warning", pattern: /warning/i },
  { category: "retry", pattern: /(retrying|retry attempt|temporary failure)/i },
  { category: "rate_limit_soft", pattern: /(rate limit|too many requests)/i }
];

function usage() {
  console.error("Usage: node examples/awm-launch.mjs <launch.json>");
}

function resolveFrom(base, value, fallback) {
  const raw = value ?? fallback;
  if (!raw) return null;
  return isAbsolute(raw) ? raw : resolve(base, raw);
}

async function atomicJson(file, data) {
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

async function writeJsonl(file, records) {
  if (!file || records.length === 0) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

async function ensureParentDirs(paths) {
  const seen = new Set();
  const created = [];

  for (const file of paths.filter(Boolean)) {
    const dir = dirname(file);
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await mkdir(dir, { recursive: true });
    created.push(dir);
  }

  return created;
}

async function exists(file) {
  if (!file) return false;
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(file) {
  if (!file) return { exists: false, value: null, error: null };
  try {
    const text = await readFile(file, "utf8");
    return { exists: true, value: JSON.parse(text.replace(/^\uFEFF/, "")), error: null };
  } catch (error) {
    return { exists: await exists(file), value: null, error: error.message };
  }
}

async function firstAccessible(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function pathCandidates(command) {
  if (command.includes("\\") || command.includes("/")) return [command];

  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const pathext = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1")
    .split(";")
    .map((ext) => ext.toLowerCase())
    .filter(Boolean);
  const commandExt = extname(command).toLowerCase();
  const names = commandExt ? [command] : [command, ...pathext.map((ext) => `${command}${ext}`)];
  const seen = new Set();
  const candidates = [];

  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = resolve(dir, name);
      const key = candidate.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

async function resolveFromPath(command) {
  if (isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    return (await firstAccessible([command])) ?? command;
  }
  return (await firstAccessible(pathCandidates(command))) ?? command;
}

function parseNodeShimEntrypoint(shimPath, text) {
  if (!/node_modules/i.test(text)) return null;

  const patterns = [
    /\$basedir[\\/](node_modules[^"'\r\n]+)/i,
    /%dp0%\\([^"\r\n]*node_modules[^"\r\n]*)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const relative = match[1].replace(/^[/\\]+/, "");
      return join(dirname(shimPath), ...relative.split(/[\\/]+/));
    }
  }

  return null;
}

async function resolveNodeExecutable(shimPath) {
  const basedir = dirname(shimPath);
  const localNode = process.platform === "win32" ? join(basedir, "node.exe") : join(basedir, "node");
  const pathNode = await resolveFromPath(process.platform === "win32" ? "node.exe" : "node");
  return (await firstAccessible([localNode, pathNode])) ?? "node";
}

async function resolveLaunchCommand(command, args) {
  if (process.platform !== "win32") {
    return {
      cmd: command,
      args,
      kind: "as_provided",
      requested_cmd: command
    };
  }

  const candidate = await resolveFromPath(command);
  let text = "";
  try {
    text = await readFile(candidate, "utf8");
  } catch {
    // Binary executables and inaccessible files can still be valid spawn targets.
  }

  const shimEntrypoint = parseNodeShimEntrypoint(candidate, text);
  if (shimEntrypoint) {
    return {
      cmd: await resolveNodeExecutable(candidate),
      args: [shimEntrypoint, ...args],
      kind: "windows_node_shim",
      requested_cmd: command,
      shim_path: candidate,
      shim_entrypoint: shimEntrypoint
    };
  }

  const extension = extname(candidate).toLowerCase();
  if (WINDOWS_WRAPPER_EXTENSIONS.has(extension) || text.startsWith("#!")) {
    throw new Error(
      `Resolved command is a shell wrapper (${candidate}) but no Node entrypoint could be parsed; provide a real executable or JS entrypoint.`
    );
  }

  return {
    cmd: candidate,
    args,
    kind: candidate === command ? "as_provided" : "path_resolved",
    requested_cmd: command
  };
}

function isOpenCodeResolution(resolution) {
  const parts = [
    resolution.requested_cmd,
    resolution.shim_path,
    resolution.shim_entrypoint,
    resolution.cmd
  ].filter(Boolean);

  return parts.some((part) => {
    const normalizedBase = basename(String(part)).toLowerCase();
    return normalizedBase === "opencode" ||
      normalizedBase === "opencode.cmd" ||
      normalizedBase === "opencode.ps1" ||
      String(part).toLowerCase().includes("opencode-ai");
  });
}

function detectOpenCodeFileMessageHazard(args) {
  let seenFile = false;
  let awaitingValueFor = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (awaitingValueFor) {
      awaitingValueFor = null;
      continue;
    }

    if (arg === "--") {
      if (seenFile && args[index + 1]) {
        return {
          token: args[index + 1],
          index: index + 1,
          reason: "positional token after --file separator"
        };
      }
      break;
    }

    if (arg === "--file" || arg === "-f") {
      seenFile = true;
      awaitingValueFor = arg;
      continue;
    }

    if (arg.startsWith("--file=")) {
      seenFile = true;
      continue;
    }

    if (arg.startsWith("-")) {
      const optionName = arg.includes("=") ? arg.split("=")[0] : arg;
      if (!arg.includes("=") && OPTIONS_WITH_VALUES.has(optionName)) {
        awaitingValueFor = optionName;
      }
      continue;
    }

    if (seenFile) {
      return {
        token: arg,
        index,
        reason: "positional message appears after --file"
      };
    }
  }

  return null;
}

async function removeIfExists(file) {
  if (!file) return;
  try {
    await unlink(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function limitTail(existing, text) {
  const combined = `${existing}${text}`;
  return combined.length > STDERR_TAIL_LIMIT ? combined.slice(-STDERR_TAIL_LIMIT) : combined;
}

function firstMatch(text, patterns) {
  return patterns.find((entry) => entry.pattern.test(text)) ?? null;
}

function expandPlaceholders(value, context) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const normalized = key.toLowerCase().replace(/[.-]/g, "_");
    return context[normalized] === undefined || context[normalized] === null ? match : String(context[normalized]);
  });
}

function expandObjectPlaceholders(value, context) {
  if (typeof value === "string") return expandPlaceholders(value, context);
  if (Array.isArray(value)) return value.map((item) => expandObjectPlaceholders(item, context));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expandObjectPlaceholders(item, context)])
  );
}

function hasPromptTextPlaceholder(args) {
  return args.some((arg) => /\{\{\s*awm[_.-]?prompt[_.-]?text\s*\}\}/i.test(arg));
}

function normalizePromptMode(value, hasPromptFile, openCode) {
  const raw = value ?? (hasPromptFile ? (openCode ? "inline" : "path_reference") : "none");
  const normalized = String(raw).toLowerCase().replace(/-/g, "_");
  if (!PROMPT_MODES.has(normalized)) {
    throw new Error(`prompt_mode must be one of ${Array.from(PROMPT_MODES).join(", ")}`);
  }
  if (normalized === "inline" && !hasPromptFile) {
    throw new Error("prompt_mode inline requires prompt_file");
  }
  return normalized;
}

function normalizeStdioMode(value, openCode) {
  const raw = value ?? (process.platform === "win32" && openCode ? "file" : "pipe");
  const normalized = String(raw).toLowerCase().replace(/-/g, "_");
  if (!STDIO_MODES.has(normalized)) {
    throw new Error(`stdio_mode must be one of ${Array.from(STDIO_MODES).join(", ")}`);
  }
  return normalized;
}

function fileSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function readUtf8Tail(file, limit) {
  let fd = null;
  try {
    const size = fileSize(file);
    if (size <= 0) return "";
    const bytesToRead = Math.min(size, limit);
    const buffer = Buffer.alloc(bytesToRead);
    fd = openSync(file, "r");
    readSync(fd, buffer, 0, bytesToRead, size - bytesToRead);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function findLastPositionalArgIndex(args) {
  let awaitingValueFor = null;
  let last = -1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (awaitingValueFor) {
      awaitingValueFor = null;
      continue;
    }

    if (arg === "--") {
      return args[index + 1] ? args.length - 1 : last;
    }

    if (arg.startsWith("-")) {
      const optionName = arg.includes("=") ? arg.split("=")[0] : arg;
      if (!arg.includes("=") && OPTIONS_WITH_VALUES.has(optionName)) {
        awaitingValueFor = optionName;
      }
      continue;
    }

    last = index;
  }

  return last;
}

function applyInlinePrompt(args, promptText, promptFile, placeholderUsed) {
  if (!promptText) return args;
  if (placeholderUsed) return args;

  const promptBlock = [
    "",
    "",
    `--- BEGIN AWM PROMPT FILE ${promptFile} ---`,
    promptText,
    "--- END AWM PROMPT FILE ---"
  ].join("\n");
  const updated = [...args];
  const messageIndex = findLastPositionalArgIndex(updated);

  if (messageIndex >= 0 && updated[messageIndex] !== "run") {
    updated[messageIndex] = `${updated[messageIndex]}${promptBlock}`;
    return updated;
  }

  updated.push(promptText);
  return updated;
}

function normalizeRequiredEnv(value) {
  const entries = value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
  const names = [];
  const seen = new Set();

  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error("required_env entries must be environment variable names");
    }
    const key = name.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }

  return names;
}

function inferRequiredEnv(resolution, args) {
  if (!isOpenCodeResolution(resolution)) return [];
  return args.some((arg) => /deepseek/i.test(arg)) ? ["DEEPSEEK_API_KEY"] : [];
}

function readWindowsScopedEnv(name, scope) {
  if (process.platform !== "win32") return "";
  const safeName = name.replace(/'/g, "''");
  const safeScope = scope.replace(/'/g, "''");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('${safeName}','${safeScope}')`
    ],
    {
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (result.status !== 0) return "";
  return String(result.stdout ?? "").replace(/\r?\n$/, "");
}

function hydrateRequiredEnv(env, requiredNames, allowWindowsScope) {
  const hydrated = [];
  const missing = [];

  for (const name of requiredNames) {
    if (env[name]) continue;

    let value = "";
    if (allowWindowsScope) {
      value = readWindowsScopedEnv(name, "User") || readWindowsScopedEnv(name, "Machine");
    }

    if (value) {
      env[name] = value;
      hydrated.push(name);
    } else {
      missing.push(name);
    }
  }

  return { hydrated, missing };
}

function numberOption(primary, fallback, defaultValue) {
  const value = primary ?? fallback ?? defaultValue;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : defaultValue;
}

function classifyWarning(line) {
  if (firstMatch(line, criticalPatterns)) return null;
  const match = firstMatch(line, warningPatterns);
  return match ? { category: match.category, line } : null;
}

function classifyCritical(status, stderrTail, extra = {}) {
  if (status === "CAPSULE_PRESENT") {
    return null;
  }

  const source = `${extra.error ?? ""}\n${stderrTail ?? ""}`;
  const match = firstMatch(source, criticalPatterns);
  if (match) {
    return {
      status,
      category: match.category,
      fatal_pattern: match.pattern.source,
      stderr_excerpt: stderrTail,
      retryable: match.retryable,
      recommended_retry: match.recommended_retry
    };
  }

  if (status === "LAUNCH_FAILED") {
    return {
      status,
      category: "launch_failed",
      fatal_pattern: "process did not start",
      stderr_excerpt: stderrTail,
      retryable: true,
      recommended_retry: "Regenerate launch.json with shell-free cmd/args and verify cwd."
    };
  }

  if (status === "RUNTIME_FAILED_NO_CAPSULE") {
    return {
      status,
      category: "missing_capsule_after_exit",
      fatal_pattern: "expected capsule missing after process exit",
      stderr_excerpt: stderrTail,
      retryable: true,
      recommended_retry: "Retry only after checking short stderr and launch/capsule paths."
    };
  }

  if (status === "TIMEOUT_MISSING_CAPSULE") {
    return {
      status,
      category: "timeout_missing_capsule",
      fatal_pattern: "timebox expired without expected capsule",
      stderr_excerpt: stderrTail,
      retryable: false,
      recommended_retry: "Pause or retry with a narrower task/timebox only if policy allows."
    };
  }

  if (status === "EXIT_NONZERO") {
    return {
      status,
      category: "nonzero_exit",
      fatal_pattern: "non-zero exit without accepted capsule",
      stderr_excerpt: stderrTail,
      retryable: true,
      recommended_retry: "Inspect short stderr and route to verifier or narrow fixer."
    };
  }

  return null;
}

function validateSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("launch spec must be a JSON object");
  }
  if ("commandLine" in spec) {
    throw new Error("commandLine is forbidden; use cmd plus args[]");
  }
  if (typeof spec.cmd !== "string" || spec.cmd.trim() === "") {
    throw new Error("cmd must be a non-empty string");
  }
  if (!Array.isArray(spec.args) || !spec.args.every((arg) => typeof arg === "string")) {
    throw new Error("args must be an array of strings");
  }
  if (spec.env !== undefined && (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env))) {
    throw new Error("env must be an object when provided");
  }
}

function launcherExitCodeFor(status, childCode, signal) {
  if (status === "CAPSULE_PRESENT") return 0;
  if (status === "EXITED") return typeof childCode === "number" ? childCode : 0;
  if (status === "LAUNCH_FAILED") return 127;
  if (status === "EXIT_NONZERO") return typeof childCode === "number" ? childCode : signal ? 128 : 1;
  return 1;
}

async function main() {
  const launchArg = process.argv[2];
  if (!launchArg) {
    usage();
    return 2;
  }

  const launchPath = resolve(process.cwd(), launchArg);
  const launchDir = dirname(launchPath);
  let spec;

  try {
    const launchText = await readFile(launchPath, "utf8");
    spec = JSON.parse(launchText.replace(/^\uFEFF/, ""));
    validateSpec(spec);
  } catch (error) {
    console.error(`Invalid launch spec: ${error.message}`);
    return 2;
  }

  const cwd = resolveFrom(launchDir, spec.cwd, launchDir);
  const stdoutPath = resolveFrom(launchDir, spec.stdout, "stdout.log");
  const stderrPath = resolveFrom(launchDir, spec.stderr, "stderr.log");
  const warningsPath = resolveFrom(launchDir, spec.warnings_file ?? spec.warningsFile, "warnings.jsonl");
  const criticalErrorPath = resolveFrom(
    launchDir,
    spec.critical_error_file ?? spec.criticalErrorFile,
    "critical-error.json"
  );
  const diagnosticsPath = resolveFrom(launchDir, spec.diagnostics_file ?? spec.diagnosticsFile, "diagnostics.json");
  const pidFile = resolveFrom(launchDir, spec.pid_file ?? spec.pidFile, "pid.json");
  const heartbeatFile = resolveFrom(launchDir, spec.heartbeat_file ?? spec.heartbeatFile, "heartbeat.json");
  const statusFile = resolveFrom(launchDir, spec.status_file ?? spec.statusFile, "controller_status.json");
  const expectedCapsule = resolveFrom(launchDir, spec.expected_capsule ?? spec.expectedCapsule, null);
  const promptFile = resolveFrom(launchDir, spec.prompt_file ?? spec.promptFile, null);
  const timeoutMs = numberOption(spec.timeout_ms, spec.timeoutMs, 0);
  const startupTimeoutMs = numberOption(spec.startup_timeout_ms, spec.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
  const inlinePromptMaxBytes = numberOption(
    spec.inline_prompt_max_bytes,
    spec.inlinePromptMaxBytes,
    DEFAULT_INLINE_PROMPT_MAX_BYTES
  );
  const launcherStartedMs = Date.now();
  const launcherStartedAt = new Date(launcherStartedMs).toISOString();
  const attemptId = String(
    spec.attempt_id ??
      spec.attemptId ??
      `${spec.task_id ?? spec.taskId ?? spec.role ?? "task"}-${launcherStartedMs}`
  );
  let processStartedMs = null;
  let processStartedAt = null;
  let deadlineAt = null;
  let stdioMode = null;
  const baseStatus = {
    version: 1,
    launch_path: launchPath,
    attempt_id: attemptId,
    goal_id: spec.goal_id ?? spec.goalId ?? null,
    task_id: spec.task_id ?? spec.taskId ?? null,
    role: spec.role ?? null,
    cwd,
    cmd: spec.cmd,
    args_count: spec.args.length,
    expected_capsule: expectedCapsule,
    prompt_file: promptFile,
    diagnostics_file: diagnosticsPath,
    critical_error_file: criticalErrorPath,
    warnings_file: warningsPath,
    queued_at: spec.queued_at ?? spec.queuedAt ?? null,
    launcher_started_at: launcherStartedAt,
    startup_timeout_ms: startupTimeoutMs,
    task_timeout_ms: timeoutMs
  };

  const precreatedParentDirs = await ensureParentDirs([
    stdoutPath,
    stderrPath,
    warningsPath,
    criticalErrorPath,
    diagnosticsPath,
    pidFile,
    heartbeatFile,
    statusFile,
    expectedCapsule
  ]);
  Object.assign(baseStatus, {
    precreated_parent_dirs: precreatedParentDirs
  });
  await removeIfExists(criticalErrorPath);
  await removeIfExists(warningsPath);
  await removeIfExists(diagnosticsPath);
  await atomicJson(diagnosticsPath, {
    ...baseStatus,
    status: "STARTING",
    stdout_bytes: 0,
    stderr_bytes: 0,
    warnings_count: 0,
    critical_error: false,
    updated_at: now()
  });
  await atomicJson(statusFile, { ...baseStatus, status: "STARTING", updated_at: now() });

  try {
    await access(cwd);
  } catch (error) {
    const critical = classifyCritical("LAUNCH_FAILED", "", { error: error.message });
    await atomicJson(criticalErrorPath, {
      ...critical,
      error: error.message,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      stderr_bytes: 0,
      stdout_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      error: `cwd is not accessible: ${error.message}`,
      updated_at: now()
    });
    return 127;
  }

  let commandResolution;
  try {
    commandResolution = await resolveLaunchCommand(spec.cmd, spec.args);
    stdioMode = normalizeStdioMode(spec.stdio_mode ?? spec.stdioMode, isOpenCodeResolution(commandResolution));
    Object.assign(baseStatus, {
      requested_cmd: spec.cmd,
      resolved_cmd: commandResolution.cmd,
      resolved_args_count: commandResolution.args.length,
      command_resolution: commandResolution.kind,
      command_shim_path: commandResolution.shim_path ?? null,
      command_shim_entrypoint: commandResolution.shim_entrypoint ?? null,
      stdio_mode: stdioMode
    });
  } catch (error) {
    const critical = {
      status: "LAUNCH_FAILED",
      category: "command_resolution",
      fatal_pattern: "shell wrapper could not be resolved under shell:false",
      stderr_excerpt: "",
      retryable: true,
      recommended_retry: "Resolve the CLI shim to a real executable or Node JS entrypoint in launch.json."
    };
    await atomicJson(criticalErrorPath, {
      ...critical,
      error: error.message,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      stdout_bytes: 0,
      stderr_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      critical_error_file: criticalErrorPath,
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      error: error.message,
      critical_error: true,
      updated_at: now()
    });
    return 127;
  }

  const taskStartedMs = Date.now();
  const taskStartedAt = new Date(taskStartedMs).toISOString();
  const taskDeadlineAt = timeoutMs > 0 ? new Date(taskStartedMs + timeoutMs).toISOString() : null;
  let promptMode = "none";
  let promptText = "";
  let promptInlineBytes = 0;

  try {
    promptMode = normalizePromptMode(spec.prompt_mode ?? spec.promptMode, Boolean(promptFile), isOpenCodeResolution(commandResolution));
    if (promptMode === "inline") {
      promptText = await readFile(promptFile, "utf8");
      promptInlineBytes = Buffer.byteLength(promptText, "utf8");
      if (promptInlineBytes > inlinePromptMaxBytes) {
        throw new Error(`prompt_file is ${promptInlineBytes} bytes, above inline_prompt_max_bytes ${inlinePromptMaxBytes}`);
      }
    }
    Object.assign(baseStatus, {
      prompt_mode: promptMode,
      prompt_inline_bytes: promptInlineBytes,
      inline_prompt_max_bytes: inlinePromptMaxBytes
    });
  } catch (error) {
    const critical = {
      status: "LAUNCH_FAILED",
      category: "prompt_file",
      fatal_pattern: "prompt file could not be prepared",
      stderr_excerpt: "",
      retryable: true,
      recommended_retry: "Fix prompt_file path, prompt_mode, or inline_prompt_max_bytes before retry."
    };
    await atomicJson(criticalErrorPath, {
      ...critical,
      prompt_file: promptFile,
      prompt_mode: spec.prompt_mode ?? spec.promptMode ?? null,
      error: error.message,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      stdout_bytes: 0,
      stderr_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      critical_error_file: criticalErrorPath,
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      critical_error: true,
      error: error.message,
      updated_at: now()
    });
    return 127;
  }

  const timingContext = {
    awm_goal_id: spec.goal_id ?? spec.goalId ?? "",
    awm_task_id: spec.task_id ?? spec.taskId ?? "",
    awm_attempt_id: attemptId,
    awm_launcher_started_at: launcherStartedAt,
    awm_task_started_at: taskStartedAt,
    awm_process_started_at: taskStartedAt,
    awm_timeout_started_at: taskStartedAt,
    awm_deadline_at: taskDeadlineAt ?? "",
    awm_timeout_ms: timeoutMs,
    awm_expected_capsule: expectedCapsule ?? "",
    awm_prompt_file: promptFile ?? "",
    awm_status_file: statusFile,
    awm_diagnostics_file: diagnosticsPath,
    awm_critical_error_file: criticalErrorPath,
    awm_warnings_file: warningsPath,
    awm_resolved_cmd: commandResolution.cmd,
    awm_command_resolution: commandResolution.kind,
    awm_command_shim_path: commandResolution.shim_path ?? "",
    awm_command_shim_entrypoint: commandResolution.shim_entrypoint ?? "",
    awm_prompt_text: promptText
  };
  const promptTextPlaceholderUsed = hasPromptTextPlaceholder(commandResolution.args);
  const expandedArgsBase = commandResolution.args.map((arg) => expandPlaceholders(arg, timingContext));
  const expandedArgs = promptMode === "inline"
    ? applyInlinePrompt(expandedArgsBase, promptText, promptFile, promptTextPlaceholderUsed)
    : expandedArgsBase;
  const expandedSpecEnv = expandObjectPlaceholders(spec.env ?? {}, timingContext);
  const opencodeFileHazard = isOpenCodeResolution(commandResolution)
    ? detectOpenCodeFileMessageHazard(expandedArgs)
    : null;

  if (opencodeFileHazard) {
    const critical = {
      status: "LAUNCH_FAILED",
      category: "opencode_file_argument_order",
      fatal_pattern: "OpenCode positional message appears after --file",
      stderr_excerpt: "",
      retryable: true,
      recommended_retry:
        "Move the message before --file args, or avoid --file for prompt files and inline the prompt_file text into the normal message."
    };
    await atomicJson(criticalErrorPath, {
      ...critical,
      offending_token: opencodeFileHazard.token,
      offending_index: opencodeFileHazard.index,
      reason: opencodeFileHazard.reason,
      prompt_file: promptFile,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      stdout_bytes: 0,
      stderr_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      critical_error_file: criticalErrorPath,
      command_arg_hazard: "opencode_file_argument_order",
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      critical_error: true,
      error: "OpenCode --file argument order would likely consume the message as a file argument.",
      updated_at: now()
    });
    return 127;
  }

  let requiredEnv;
  try {
    requiredEnv = normalizeRequiredEnv([
      ...(spec.infer_required_env === false ? [] : inferRequiredEnv(commandResolution, expandedArgs)),
      ...normalizeRequiredEnv(spec.required_env ?? spec.requiredEnv)
    ]);
    Object.assign(baseStatus, {
      required_env: requiredEnv
    });
  } catch (error) {
    const critical = {
      status: "LAUNCH_FAILED",
      category: "required_env",
      fatal_pattern: "required_env is invalid",
      stderr_excerpt: "",
      retryable: true,
      recommended_retry: "Regenerate launch.json with required_env as env var names only."
    };
    await atomicJson(criticalErrorPath, {
      ...critical,
      error: error.message,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      stdout_bytes: 0,
      stderr_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      critical_error_file: criticalErrorPath,
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      critical_error: true,
      error: error.message,
      updated_at: now()
    });
    return 127;
  }

  const env = {
    ...process.env,
    ...expandedSpecEnv,
    AWM_GOAL_ID: timingContext.awm_goal_id,
    AWM_TASK_ID: timingContext.awm_task_id,
    AWM_ATTEMPT_ID: timingContext.awm_attempt_id,
    AWM_LAUNCHER_STARTED_AT: timingContext.awm_launcher_started_at,
    AWM_TASK_STARTED_AT: timingContext.awm_task_started_at,
    AWM_PROCESS_STARTED_AT: timingContext.awm_process_started_at,
    AWM_TIMEOUT_STARTED_AT: timingContext.awm_timeout_started_at,
    AWM_DEADLINE_AT: timingContext.awm_deadline_at,
    AWM_TIMEOUT_MS: String(timingContext.awm_timeout_ms),
    AWM_EXPECTED_CAPSULE: timingContext.awm_expected_capsule,
    AWM_PROMPT_FILE: timingContext.awm_prompt_file,
    AWM_PROMPT_MODE: promptMode,
    AWM_PROMPT_INLINE_BYTES: String(promptInlineBytes),
    AWM_STATUS_FILE: timingContext.awm_status_file,
    AWM_DIAGNOSTICS_FILE: timingContext.awm_diagnostics_file,
    AWM_CRITICAL_ERROR_FILE: timingContext.awm_critical_error_file,
    AWM_WARNINGS_FILE: timingContext.awm_warnings_file,
    AWM_RESOLVED_CMD: timingContext.awm_resolved_cmd,
    AWM_COMMAND_RESOLUTION: timingContext.awm_command_resolution,
    AWM_COMMAND_SHIM_PATH: timingContext.awm_command_shim_path,
    AWM_COMMAND_SHIM_ENTRYPOINT: timingContext.awm_command_shim_entrypoint
  };

  const envHydration = hydrateRequiredEnv(
    env,
    requiredEnv,
    process.platform === "win32" && spec.hydrate_env_from_windows_scope !== false
  );
  Object.assign(baseStatus, {
    required_env_hydrated: envHydration.hydrated,
    missing_required_env: envHydration.missing
  });

  if (envHydration.missing.length > 0) {
    const critical = {
      status: "LAUNCH_FAILED",
      category: "missing_required_env",
      fatal_pattern: "required environment variable missing",
      stderr_excerpt: "",
      retryable: false,
      recommended_retry:
        "Configure the worker provider secret, then open a fresh shell or allow launcher env hydration from Windows User/Machine scope."
    };
    await atomicJson(criticalErrorPath, {
      ...critical,
      missing_required_env: envHydration.missing,
      updated_at: now()
    });
    await atomicJson(diagnosticsPath, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      stdout_bytes: 0,
      stderr_bytes: 0,
      warnings_count: 0,
      critical_error: true,
      critical_error_file: criticalErrorPath,
      updated_at: now()
    });
    await atomicJson(statusFile, {
      ...baseStatus,
      status: "LAUNCH_FAILED",
      task_started_at: taskStartedAt,
      timeout_started_at: taskStartedAt,
      deadline_at: taskDeadlineAt,
      critical_error: true,
      error: `Missing required env: ${envHydration.missing.join(", ")}`,
      updated_at: now()
    });
    return 127;
  }

  let stdoutFd = null;
  let stderrFd = null;
  let child;
  const spawnOptions = {
    cwd,
    env,
    shell: false,
    windowsHide: true
  };

  if (stdioMode === "file") {
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");
    child = spawn(commandResolution.cmd, expandedArgs, {
      ...spawnOptions,
      stdio: ["ignore", stdoutFd, stderrFd]
    });
  } else {
    child = spawn(commandResolution.cmd, expandedArgs, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let heartbeatTimer = null;
  let timeoutTimer = null;
  let startupTimer = null;
  let timedOut = false;
  let stderrTail = "";
  let stderrLineBuffer = "";
  const warnings = [];

  const stdout = stdioMode === "pipe" ? createWriteStream(stdoutPath, { flags: "w" }) : null;
  const stderr = stdioMode === "pipe" ? createWriteStream(stderrPath, { flags: "w" }) : null;

  child.stdout?.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    stdout?.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderrBytes += chunk.length;
    const text = chunk.toString("utf8");
    stderrTail = limitTail(stderrTail, text);
    stderrLineBuffer += text;
    const lines = stderrLineBuffer.split(/\r?\n/);
    stderrLineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const warning = classifyWarning(line);
      if (warning) warnings.push({ ...warning, observed_at: now() });
    }
    stderr?.write(chunk);
  });

  const exitCode = await new Promise((resolveExit) => {
    let settled = false;
    let running = false;

    const finishFinalizationFailure = async (attemptedStatus, error, code = 1, extra = {}) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (startupTimer) clearTimeout(startupTimer);
      if (stdioMode === "file") {
        stdoutBytes = fileSize(stdoutPath);
        stderrBytes = fileSize(stderrPath);
        stderrTail = readUtf8Tail(stderrPath, STDERR_TAIL_LIMIT);
      }
      const capsule = await readJsonIfExists(expectedCapsule);
      const capsuleExists = capsule.exists;
      const fallbackStatus = expectedCapsule && capsuleExists ? "CAPSULE_PRESENT" : attemptedStatus;
      const critical = fallbackStatus === "CAPSULE_PRESENT"
        ? null
        : {
            status: fallbackStatus,
            category: "launcher_finalization_failed",
            fatal_pattern: "launcher failed while writing terminal compact status",
            stderr_excerpt: stderrTail,
            retryable: true,
            recommended_retry:
              "Inspect finalization_error and retry only after confirming capsule/status paths and filesystem permissions."
          };

      if (critical) {
        await atomicJson(criticalErrorPath, {
          ...critical,
          exit_code: extra.exit_code ?? null,
          signal: extra.signal ?? null,
          finalization_error: error?.message ?? String(error),
          updated_at: now()
        });
      }
      await atomicJson(diagnosticsPath, {
        ...baseStatus,
        status: fallbackStatus,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
        launcher_elapsed_ms: Date.now() - launcherStartedMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        warnings_count: warnings.length,
        critical_error: Boolean(critical),
        critical_error_file: critical ? criticalErrorPath : null,
        capsule_exists: capsuleExists,
        capsule_status: capsule.value?.status ?? null,
        capsule_parse_error: capsule.error,
        finalization_error: error?.message ?? String(error),
        updated_at: now()
      });
      await atomicJson(statusFile, {
        ...baseStatus,
        status: fallbackStatus,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
        launcher_elapsed_ms: Date.now() - launcherStartedMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        warnings_count: warnings.length,
        critical_error: Boolean(critical),
        finalization_error: error?.message ?? String(error),
        updated_at: now(),
        ...extra
      });
      if (stdout) stdout.end();
      if (stderr) stderr.end();
      if (stdoutFd !== null) {
        try {
          closeSync(stdoutFd);
        } catch {
          // The fallback is already reporting finalization trouble.
        }
        stdoutFd = null;
      }
      if (stderrFd !== null) {
        try {
          closeSync(stderrFd);
        } catch {
          // The fallback is already reporting finalization trouble.
        }
        stderrFd = null;
      }
      resolveExit(fallbackStatus === "CAPSULE_PRESENT" ? 0 : code);
    };

    const finish = async (status, extra, code) => {
      if (settled) return;
      settled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (startupTimer) clearTimeout(startupTimer);
      if (stdioMode === "file") {
        stdoutBytes = fileSize(stdoutPath);
        stderrBytes = fileSize(stderrPath);
        stderrTail = readUtf8Tail(stderrPath, STDERR_TAIL_LIMIT);
        for (const line of stderrTail.split(/\r?\n/)) {
          const warning = classifyWarning(line);
          if (warning) warnings.push({ ...warning, observed_at: now() });
        }
      }
      if (stderrLineBuffer) {
        const warning = classifyWarning(stderrLineBuffer);
        if (warning) warnings.push({ ...warning, observed_at: now() });
        stderrLineBuffer = "";
      }
      const critical = classifyCritical(status, stderrTail, extra);
      if (critical) {
        await atomicJson(criticalErrorPath, {
          ...critical,
          exit_code: extra.exit_code ?? null,
          signal: extra.signal ?? null,
          error: extra.error ?? null,
          updated_at: now()
        });
      }
      await writeJsonl(warningsPath, warnings);
      await atomicJson(diagnosticsPath, {
        ...baseStatus,
        status,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
        launcher_elapsed_ms: Date.now() - launcherStartedMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        warnings_count: warnings.length,
        critical_error: Boolean(critical),
        critical_error_file: critical ? criticalErrorPath : null,
        stderr_excerpt_bytes: stderrTail.length,
        capsule_exists: extra.capsule_exists ?? null,
        exit_code: extra.exit_code ?? null,
        signal: extra.signal ?? null,
        updated_at: now()
      });
      if (stdout) stdout.end();
      if (stderr) stderr.end();
      if (stdoutFd !== null) {
        closeSync(stdoutFd);
        stdoutFd = null;
      }
      if (stderrFd !== null) {
        closeSync(stderrFd);
        stderrFd = null;
      }
      await atomicJson(statusFile, {
        ...baseStatus,
        status,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
        launcher_elapsed_ms: Date.now() - launcherStartedMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        warnings_count: warnings.length,
        critical_error: Boolean(critical),
        updated_at: now(),
        ...extra
      });
      resolveExit(code);
    };

    const markRunning = async () => {
      if (settled || running) return;
      running = true;
      if (startupTimer) clearTimeout(startupTimer);
      const spawnConfirmedAt = now();
      processStartedMs = taskStartedMs;
      processStartedAt = taskStartedAt;
      deadlineAt = taskDeadlineAt;
      await atomicJson(pidFile, {
        attempt_id: attemptId,
        pid: child.pid,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        spawn_confirmed_at: spawnConfirmedAt,
        launch_path: launchPath
      });
      await atomicJson(heartbeatFile, {
        attempt_id: attemptId,
        status: "RUNNING",
        pid: child.pid,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        spawn_confirmed_at: spawnConfirmedAt,
        updated_at: now()
      });
      await atomicJson(statusFile, {
        ...baseStatus,
        status: "RUNNING",
        pid: child.pid,
        task_started_at: taskStartedAt,
        process_started_at: processStartedAt,
        timeout_started_at: processStartedAt,
        deadline_at: deadlineAt,
        spawn_confirmed_at: spawnConfirmedAt,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        updated_at: now()
      });
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(async () => {
          timedOut = true;
          if (stdioMode === "file") {
            stdoutBytes = fileSize(stdoutPath);
            stderrBytes = fileSize(stderrPath);
          }
          await atomicJson(statusFile, {
            ...baseStatus,
            status: "TIMEOUT_MISSING_CAPSULE",
            pid: child.pid ?? null,
            task_started_at: taskStartedAt,
            process_started_at: processStartedAt,
            timeout_started_at: processStartedAt,
            deadline_at: deadlineAt,
            task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
            launcher_elapsed_ms: Date.now() - launcherStartedMs,
            stdout_bytes: stdoutBytes,
            stderr_bytes: stderrBytes,
            updated_at: now(),
            note: "Task timeout reached from process_started_at before the expected capsule was observed."
          });
          child.kill();
        }, timeoutMs);
      }
      heartbeatTimer = setInterval(() => {
        if (stdioMode === "file") {
          stdoutBytes = fileSize(stdoutPath);
          stderrBytes = fileSize(stderrPath);
        }
        atomicJson(heartbeatFile, {
          attempt_id: attemptId,
          status: "RUNNING",
          pid: child.pid,
          task_started_at: taskStartedAt,
          process_started_at: processStartedAt,
          timeout_started_at: processStartedAt,
          deadline_at: deadlineAt,
          task_elapsed_ms: processStartedMs ? Date.now() - processStartedMs : null,
          updated_at: now(),
          stdout_bytes: stdoutBytes,
          stderr_bytes: stderrBytes
        }).catch(() => {});
      }, Number(spec.heartbeat_interval_ms ?? spec.heartbeatIntervalMs ?? 10000));
    };

    child.once("spawn", () => {
      markRunning().catch((error) => {
        finish("LAUNCH_FAILED", { error: error.message }, 127).catch((finishError) => {
          finishFinalizationFailure("LAUNCH_FAILED", finishError, 127, { error: error.message }).catch(() => resolveExit(127));
        });
      });
    });

    child.once("error", (error) => {
      finish(
        "LAUNCH_FAILED",
        {
          error: error.message,
          code: error.code ?? null
        },
        127
      ).catch((finishError) => {
        finishFinalizationFailure("LAUNCH_FAILED", finishError, 127, {
          error: error.message,
          code: error.code ?? null
        }).catch(() => resolveExit(127));
      });
    });

    if (startupTimeoutMs > 0) {
      startupTimer = setTimeout(() => {
        finish(
          "LAUNCH_FAILED",
          {
            error: "Startup timeout reached before process_started_at/heartbeat was written.",
            startup_timeout_ms: startupTimeoutMs,
            launcher_elapsed_ms: Date.now() - launcherStartedMs
          },
          127
        ).catch((finishError) => {
          finishFinalizationFailure("LAUNCH_FAILED", finishError, 127, {
            error: "Startup timeout reached before process_started_at/heartbeat was written.",
            startup_timeout_ms: startupTimeoutMs,
            launcher_elapsed_ms: Date.now() - launcherStartedMs
          }).catch(() => resolveExit(127));
        });
      }, startupTimeoutMs);
    }

    child.once("exit", async (code, signal) => {
      const capsule = await readJsonIfExists(expectedCapsule);
      const capsuleExists = capsule.exists;
      const status = expectedCapsule && capsuleExists
        ? "CAPSULE_PRESENT"
        : timedOut
          ? "TIMEOUT_MISSING_CAPSULE"
          : expectedCapsule
          ? "RUNTIME_FAILED_NO_CAPSULE"
          : code === 0
            ? "EXITED"
            : "EXIT_NONZERO";
      finish(
        status,
        {
          exit_code: code,
          signal: signal ?? null,
          capsule_exists: capsuleExists,
          capsule_status: capsule.value?.status ?? null,
          capsule_parse_error: capsule.error,
          ended_at: now()
        },
        launcherExitCodeFor(status, code, signal)
      ).catch((finishError) => {
        finishFinalizationFailure(
          status,
          finishError,
          launcherExitCodeFor(status, code, signal),
          {
            exit_code: code,
            signal: signal ?? null,
            capsule_exists: capsuleExists,
            capsule_status: capsule.value?.status ?? null,
            capsule_parse_error: capsule.error,
            ended_at: now()
          }
        ).catch(() => resolveExit(1));
      });
    });

    if (child.pid) {
      setImmediate(() => {
        markRunning().catch((error) => {
          finish("LAUNCH_FAILED", { error: error.message }, 127).catch((finishError) => {
            finishFinalizationFailure("LAUNCH_FAILED", finishError, 127, { error: error.message }).catch(() => resolveExit(127));
          });
        });
      });
    } else {
      setImmediate(() => {
        if (!settled && !child.pid) {
          finish(
            "LAUNCH_FAILED",
            {
              error: "Process did not report a pid after spawn; check cmd and cwd."
            },
            127
          ).catch((finishError) => {
            finishFinalizationFailure("LAUNCH_FAILED", finishError, 127, {
              error: "Process did not report a pid after spawn; check cmd and cwd."
            }).catch(() => resolveExit(127));
          });
        }
      });
    }
  });

  return exitCode;
}

process.exitCode = await main();
