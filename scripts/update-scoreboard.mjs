import { mkdir, readFile, writeFile } from "node:fs/promises";
import { initLogFile, logLoadRow } from "./logger.mjs";

const PAGES = Number(process.env.TIMUS_PAGES || 5);
const SUBMISSIONS_PER_PAGE = 100;
const BASE = "https://acm.timus.ru";
const CHALLENGE_START = Date.UTC(2026, 6, 31);
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

initLogFile();

const authors = await loadAuthors();
const days = await loadTaskDays();
const tasks = days.flat();
const hardTasks = getHardTaskSet(days);
const difficulties = await loadTaskDifficulties(tasks);
const rows = [];

for (const author of authors) {
  rows.push(await loadRow(author, tasks, difficulties, hardTasks));
}

rows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || b.difficultyScore - a.difficultyScore || a.name.localeCompare(b.name));

await mkdir("data", { recursive: true });
const scoreboard = {
  title: "TIMUS August 2026 Challenge",
  updatedAt: new Date().toISOString(),
  pages: PAGES,
  days,
  tasks,
  difficulties,
  rows,
};

await writeFile("data/scoreboard.json", JSON.stringify(scoreboard, null, 2) + "\n");

async function loadAuthors() {
  const body = await readFile("authors.txt", "utf8");
  return body
    .split(/\n+/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)(?:;(.+))?$/); // id;optional-alias
      if (!match) throw new Error(`Bad author line: ${line}`);
      return { id: Number(match[1]), alias: clean(match[2]) };
    });
}

async function loadTaskDays() {
  const body = await readFile("tasks.txt", "utf8");
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.replace(/#.*/g, " ").split(/[\s,;]+/).map(Number).filter(Boolean))
    .filter((block) => block.length > 0);
  const days = blocks.length > 1 ? blocks : chunk(blocks.flat(), 3);
  const seen = new Set();
  return days
    .map((day) => day.filter((task) => !seen.has(task) && seen.add(task)))
    .filter((day) => day.length > 0);
}

async function loadTaskDifficulties(tasks) {
  const pairs = [];
  for (const task of tasks) {
    pairs.push([task, await loadTaskDifficulty(task).catch(() => 0)]);
  }
  return Object.fromEntries(pairs);
}

async function loadTaskDifficulty(task) {
  const html = await fetchText(`${BASE}/problem.aspx?space=1&num=${task}&locale=en`);
  return Number(html.match(/Difficulty:\s*(\d+)/i)?.[1] || 0);
}

async function loadRow(author, tasks, difficulties, hardTasks) {
  const submissions = [];
  const taskSet = new Set(tasks);
  let timusName = "";
  let next = `/status.aspx?space=1&author=${author.id}&count=${SUBMISSIONS_PER_PAGE}&locale=en`;

  for (let page = 0; page < PAGES && next; page += 1) {
    const pageNumber = page + 1;
    const fetchUrl = `${BASE}${next}`;
    logLoadRow(author.id, pageNumber, "fetchUrl", fetchUrl);

    const html = await fetchText(fetchUrl);
    if (!timusName) timusName = parseStatusAuthorName(html);

    const pageSubmissions = parseSubmissions(html, author.id);
    logLoadRow(author.id, pageNumber, "pageSubmissions", pageSubmissions.length);

    const submissionsAfterChallengeStart = pageSubmissions.filter((item) => item.timestamp >= CHALLENGE_START);
    logLoadRow(author.id, pageNumber, "submissionsAfterChallengeStart", submissionsAfterChallengeStart.length);

    const submissionsInChallenge = submissionsAfterChallengeStart.filter((item) => taskSet.has(item.problemId));
    submissions.push(...submissionsInChallenge);

    const nextHref = parseNextHref(html);
    logLoadRow(author.id, pageNumber, "nextHref", nextHref || "");

    next = submissionsAfterChallengeStart.length < pageSubmissions.length
      ? ""
      : nextHref ? normalizeNextHref(nextHref) : "";
    logLoadRow(author.id, pageNumber, "next", next);
  }

  const uniqueSubmissions = uniqueById(submissions);
  const name = author.alias || uniqueSubmissions.find((item) => item.authorName)?.authorName || timusName || `#${author.id}`;
  const cells = tasks.map((task) => scoreTask(task, uniqueSubmissions, difficulties[task] || 0, hardTasks.has(task)));
  return enrichRow({
    id: author.id,
    name,
    cells,
  });
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function parseNextHref(html) {
  return html.match(/<td class="footer_right"[^>]*>[\s\S]*?<a href="([^"]*status\.aspx[^"]*from=\d+[^"]*)"/i)?.[1] || "";
}

function normalizeNextHref(href) {
  const value = decodeEntities(href);
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  }
  return `/${value.replace(/^\/+/, "")}`;
}

function parseSubmissions(html, authorId) {
  return [...html.matchAll(/<tr class="(?:even|odd)">([\s\S]*?)<\/tr>/gi)]
    .map((match) => {
      const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
      const submitId = Number(stripTags(cells[0]));
      const parsedAuthorId = Number((cells[2] || "").match(/author\.aspx\?id=(\d+)/i)?.[1]);
      const problemId = Number((cells[3] || "").match(/problem\.aspx\?space=1&amp;num=(\d+)/i)?.[1]);
      if (!submitId || parsedAuthorId !== authorId || !problemId) return null;
      const parsedDate = parseTimusDate(stripTags(cells[1]));

      return {
        id: submitId,
        date: parsedDate.text,
        timestamp: parsedDate.timestamp,
        authorName: clean(stripTags(cells[2])),
        problemId,
        problemName: clean(stripTags((cells[3] || "").match(/<span class="problemname">([\s\S]*?)<\/span>/i)?.[1] || "")).replace(/^\.\s*/, ""),
        language: clean(stripTags(cells[4])),
        verdict: clean(stripTags(cells[5])),
      };
    })
    .filter(Boolean);
}

function parseStatusAuthorName(html) {
  const match = html.match(/Author:\s*<A[^>]*>([\s\S]*?)<\/A>/i);
  return clean(stripTags(match?.[1] || ""));
}

function scoreTask(task, submissions, difficulty = 0, hard = false) {
  const list = submissions.filter((item) => item.problemId === task).sort((a, b) => a.id - b.id);
  const ac = list.find((item) => item.verdict === "Accepted");
  const penalty = list.filter((item) => item.verdict !== "Accepted").length;
  return {
    task,
    difficulty,
    hard,
    solved: Boolean(ac),
    penalty,
    wa: penalty,
    label: ac ? (penalty ? `+(${penalty})` : "+") : (penalty ? `-${penalty}` : ""),
    attempts: list.slice().reverse(),
  };
}

function enrichRow(row) {
  const cells = row.cells || [];
  const solvedCells = cells.filter((cell) => cell.solved);
  const hardCells = solvedCells.filter((cell) => cell.hard);
  return {
    ...row,
    solved: solvedCells.length,
    penalty: cells.reduce((sum, cell) => sum + cell.penalty, 0),
    wa: cells.reduce((sum, cell) => sum + cell.penalty, 0),
    difficultyScore: solvedCells.reduce((sum, cell) => sum + cell.difficulty, 0),
    hardSolved: hardCells.length,
    hardScore: hardCells.reduce((sum, cell) => sum + cell.difficulty, 0),
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "timus-august-2026-challenge/1.0" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function stripTags(value = "") {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function parseTimusDate(value = "") {
  const match = clean(value).match(/(\d{2}):(\d{2}):(\d{2}) (\d{1,2}) ([A-Za-z]+) (\d{4})/);
  if (!match) return { text: "", timestamp: 0 };
  return {
    text: `${match[1]}:${match[2]}:${match[3]} ${match[4]} ${match[5]} ${match[6]}`,
    timestamp: Date.UTC(Number(match[6]), MONTHS[match[5]], Number(match[4]), Number(match[1]), Number(match[2]), Number(match[3])),
  };
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function getHardTaskSet(days) {
  return new Set(days.map((day) => day[2]).filter(Boolean));
}
