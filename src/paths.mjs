import os from "node:os";
import path from "node:path";

export function getGrokAcpHome() {
  return process.env.GROK_ACP_HOME
    ? path.resolve(process.env.GROK_ACP_HOME)
    : path.join(os.homedir(), ".grok-acp");
}

export function getRunsDir(home = getGrokAcpHome()) {
  return path.join(home, "runs");
}