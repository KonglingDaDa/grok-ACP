import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MODEL = "grok-composer-2.5-fast";
export const DEFAULT_ZQ_CWD = "/home/desk/dev/repos/zq";
/**
 * JSON-RPC request timeout when --timeout-ms is omitted (run, compact, new).
 *
 * 20 分钟。不要无理由调小 —— 曾经是 120_000（2 分钟），一次重构把它设回 2 分钟，
 * 导致 Docker rebuild / C2C smoke / migration 这类正常任务在 session/prompt 阶段
 * 误超时。PM 派发的任务几乎都不是"秒级"的；宁可等，也不要假超时。
 * 重型 infra 任务（Docker + E2E + 资金链路）应显式 `--timeout-ms 1800000`（30 分钟）。
 */
export const DEFAULT_TIMEOUT_MS = 1_200_000;

export function parseArgs(argv) {
  const result = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      result[toCamel(arg.slice(2, eqIndex))] = arg.slice(eqIndex + 1);
      continue;
    }

    const key = toCamel(arg.slice(2));
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    i += 1;
  }

  return result;
}

export function readPrompt(options) {
  const hasPromptFile = typeof options.promptFile === "string";
  const hasPromptText = typeof options.promptText === "string";

  if (hasPromptFile && hasPromptText) {
    throw new Error("Use only one of --prompt-file or --prompt-text.");
  }
  if (hasPromptFile) {
    return {
      text: fs.readFileSync(options.promptFile, "utf8"),
      source: path.resolve(options.promptFile),
    };
  }
  if (hasPromptText) {
    return { text: options.promptText, source: "inline --prompt-text" };
  }

  throw new Error("Missing prompt. Provide --prompt-file <path> or --prompt-text <text>.");
}

export function numberOption(value, fallback, name) {
  if (value === undefined || value === true || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

export function boolOption(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  if (value === false) return false;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function nowBeijingIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+08:00`;
}

export function nowBeijingStamp() {
  const iso = nowBeijingIso();
  return iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function toCamel(input) {
  return input.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
