import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const LOG_FILE = "logs/update-scoreboard.log";

export function initLogFile() {
  mkdirSync("logs", { recursive: true });
  writeFileSync(LOG_FILE, "");
}

export function logLoadRow(authorId, page, key, value = "") {
  const line = `${authorId} page=${page} ${key}=${value}`;
  console.log(line);
  appendFileSync(LOG_FILE, `${line}\n`);
}
