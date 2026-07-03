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
  return `# Grok ACP Run

- created_at_beijing: ${payload.createdAtBeijing}
- model: ${payload.model}
- cwd: ${payload.cwd}
- prompt_source: ${payload.promptSource}
- session_id: ${payload.sessionId}
- stop_reason: ${payload.stopReason ?? "unknown"}
- auth_method: ${payload.authMethod}
- prompt_total_tokens: ${payload.promptMeta?.totalTokens ?? "unknown"}
- prompt_model_id: ${payload.promptMeta?.modelId ?? "unknown"}

## Grok Reply

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
