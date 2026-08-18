import { appendFileSync, mkdirSync } from "node:fs";

const LOG_FILE = `logs/update-scoreboard-${new Date().toISOString().slice(0, 10)}.log`;
const lines = [];
let initialized = false;

export function initLogFile() {
  mkdirSync("logs", { recursive: true });
  lines.length = 0;
  initialized = true;
}

export function logLoadRow(authorId, page, key, value = "") {
  const line = `${authorId} page=${page} ${key}=${value}`;
  console.log(line);
  lines.push(line);
}

export function flushLogFile() {
  if (!initialized || lines.length === 0) return;
  appendFileSync(LOG_FILE, `# ${new Date().toISOString()}\n${lines.join("\n")}\n`);
  lines.length = 0;
}

process.once("exit", flushLogFile);
