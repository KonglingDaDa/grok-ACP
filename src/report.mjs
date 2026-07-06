import fs from "node:fs";
import path from "node:path";
import { ensureDir, nowBeijingIso, nowBeijingStamp } from "./config.mjs";

export function writeRunReport(options) {
  const outDir = path.resolve(options.outDir);
  ensureDir(outDir);

  const stamp = nowBeijingStamp();
  const safeName = slug(options.name || "grok-acp-run");
  const base = `${stamp}-${safeName}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const mdPath = path.join(outDir, `${base}.md`);

  const payload = {
    tool: "grokACP",
    createdAtBeijing: nowBeijingIso(),
    model: options.model,
    cwd: options.cwd,
    promptSource: options.promptSource,
    sessionId: options.result.sessionId,
    // status/error 仅在失败/超时的部分回执里出现；成功路径不传，输出保持不变
    status: options.result.status ?? null,
    error: options.result.error ?? null,
    stopReason: options.result.promptResult?.stopReason ?? null,
    promptMeta: options.result.promptResult?._meta ?? null,
    authMethod: options.result.authMethod,
    stderr: options.result.stderr,
    text: options.result.text,
    promptResult: options.result.promptResult,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(payload), "utf8");

  return { jsonPath, mdPath };
}

function renderMarkdown(payload) {
  const partial = payload.status && payload.status !== "done";
  return `# Grok ACP Run${partial ? ` (${payload.status})` : ""}

- created_at_beijing: ${payload.createdAtBeijing}
- model: ${payload.model}
- cwd: ${payload.cwd}
- prompt_source: ${payload.promptSource}
- session_id: ${payload.sessionId}
${payload.status ? `- status: ${payload.status}\n` : ""}- stop_reason: ${payload.stopReason ?? "unknown"}
- auth_method: ${payload.authMethod}
- prompt_total_tokens: ${payload.promptMeta?.totalTokens ?? "unknown"}
- prompt_model_id: ${payload.promptMeta?.modelId ?? "unknown"}
${payload.error ? `\n## Error\n\n\`\`\`text\n${payload.error}\n\`\`\`\n` : ""}
## Grok Reply${partial ? " (partial)" : ""}

${payload.text || "_No text returned._"}

## stderr

\`\`\`text
${payload.stderr || ""}
\`\`\`
`;
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "grok-acp-run";
}
