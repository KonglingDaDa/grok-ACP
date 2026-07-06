#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);

  // 超时是可恢复的、区别于硬错误：退出码 2，并复述续跑线索，便于自动化区分。
  if (error && error.isTimeout) {
    const sessionId = error.resume?.sessionId;
    if (sessionId) {
      console.error(`\ngrokACP 超时 ≠ 失败：会话 ${sessionId} 仍在，可用 --session-id ${sessionId} --timeout-ms 1800000 续跑。`);
    }
    process.exitCode = 2;
    return;
  }

  process.exitCode = 1;
});

