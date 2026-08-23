import { createServer } from "node:http";

const REPOSITORY = process.env.GITHUB_REPOSITORY || "Heartspell/timusaugustchallengescore";
const EVENT_TYPE = process.env.GITHUB_EVENT_TYPE || "update-scoreboard";
const INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 5 * 60 * 1000);
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.GITHUB_TOKEN;

let lastRun = null;
let lastStatus = "starting";
let lastError = "";

if (!TOKEN) {
  lastStatus = "missing_token";
  console.warn("GITHUB_TOKEN is not set; dispatch requests will fail.");
}

createServer((request, response) => {
  const body = JSON.stringify({
    status: lastStatus,
    lastRun,
    lastError,
    repository: REPOSITORY,
    eventType: EVENT_TYPE,
    intervalMs: INTERVAL_MS,
  });

  response.writeHead(request.url === "/health" ? 200 : 200, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${body}\n`);
}).listen(PORT, () => {
  console.log(`scoreboard pinger listening on ${PORT}`);
});

await ping();
setInterval(ping, INTERVAL_MS);

async function ping() {
  lastRun = new Date().toISOString();
  try {
    if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/dispatches`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${TOKEN}`,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "timus-scoreboard-pinger/1.0",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ event_type: EVENT_TYPE }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub dispatch failed: HTTP ${response.status} ${text}`);
    }

    lastStatus = "ok";
    lastError = "";
    console.log(`${lastRun} dispatched ${EVENT_TYPE} for ${REPOSITORY}`);
  } catch (error) {
    lastStatus = "error";
    lastError = error?.message || String(error);
    console.error(`${lastRun} ${lastError}`);
  }
}
