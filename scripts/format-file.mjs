// PostToolUse hook: format the file Claude just edited. Never fails the tool call.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let f = "";
try { f = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.file_path ?? ""; } catch {}

const run = (cmd, cwd) => {
  if (existsSync(cwd)) spawnSync(cmd, { cwd, stdio: "ignore", shell: true, timeout: 30000 });
};

if (f && existsSync(f)) {
  if (/\.py$/.test(f)) run(`uv run ruff format "${f}"`, join(root, "backend"));
  else if (/\.(ts|tsx|js|mjs|json|css|md)$/.test(f)) run(`npx --no-install prettier --write "${f}"`, join(root, "frontend"));
}
process.exit(0);
