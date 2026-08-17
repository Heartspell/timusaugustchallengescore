import { mkdirSync, writeFileSync } from "node:fs";

const LOG_FILE = "logs/update-scoreboard.log";
const lines = [];
let initialized = false;

export function initLogFile() {
  mkdirSync("logs", { recursive: true });
  lines.length = 0;
  initialized = true;
  writeFileSync(LOG_FILE, "");
}

export function logLoadRow(authorId, page, key, value = "") {
  const line = `${authorId} page=${page} ${key}=${value}`;
  console.log(line);
  lines.push(line);
}

export function flushLogFile() {
  if (!initialized) return;
  writeFileSync(LOG_FILE, lines.length ? `${lines.join("\n")}\n` : "");
}

process.once("exit", flushLogFile);
