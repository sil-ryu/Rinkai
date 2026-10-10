// PreToolUse hook (Bash and PowerShell): block committing .env and force-pushing.
// Exit 2 = block; stderr is shown to Claude as the reason.
import { readFileSync } from "node:fs";

let cmd = "";
try { cmd = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? ""; } catch {}

const bad = [
  /git\s+(add|commit)\b[^\n;&|]*\.env(\s|$|["'])/,
  /git\s+push\b[^\n;&|]*(--force|\s-f(\s|$))/,
];
if (bad.some((re) => re.test(cmd))) {
  console.error("Blocked by scripts/guard-bash.mjs: never commit .env or force-push.");
  process.exit(2);
}
process.exit(0);
