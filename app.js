const PAGES = 5;
const REFRESH_MS = 60000;
const TIMUS = "https://acm.timus.ru";
const READER = "https://r.jina.ai/http://";
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
const VERDICTS = [
  "Compilation error",
  "Runtime error (access violation)",
  "Runtime error (non-zero exit code)",
  "Wrong answer",
  "Time limit exceeded",
  "Memory limit exceeded",
  "Output limit exceeded",
  "Presentation error",
  "Idleness limit exceeded",
  "Security violation",
  "Restricted function",
  "Runtime error",
  "Accepted",
];

const statusEl = document.querySelector("#status");
const loader = document.querySelector("#loader");
const reloadButton = document.querySelector("#reload");
const board = document.querySelector("#board");
const attempts = document.querySelector("#attempts");
const attemptsTitle = document.querySelector("#attemptsTitle");
const attemptsBody = attempts.querySelector("tbody");
const rankButtons = [...document.querySelectorAll("[data-rank]")];
let lastRows = [];
let lastTasks = [];
let lastDays = [];
let lastDifficulties = {};
let lastHardTasks = new Set();
let lastStatusPrefix = "";
let lastStatusSuffix = "";
let rankMode = "solved";
let resizeTimer = 0;
let loading = false;

reloadButton.addEventListener("click", () => loadLiveBoard());
rankButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rankMode = button.dataset.rank;
    setActiveRankButton();
    if (!lastDays.length) return;
    const view = renderBoard(lastRows, lastTasks, lastDays, lastDifficulties, lastHardTasks);
    updateStatus(view);
  });
});
setActiveRankButton();
loadLiveBoard();
setInterval(loadLiveBoard, REFRESH_MS);
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!lastDays.length) return;
    const view = renderBoard(lastRows, lastTasks, lastDays, lastDifficulties, lastHardTasks);
    updateStatus(view);
  }, 120);
});

async function loadLiveBoard() {
  if (loading) return;
  setLoading(true);
  try {
    statusEl.textContent = "parsing Timus";
    const [authors, days] = await Promise.all([loadAuthors(), loadTaskDays()]);
    const tasks = days.flat();
    const hardTasks = getHardTaskSet(days);
    const difficulties = await loadTaskDifficulties(tasks, await loadSavedDifficulties());
    const rows = await Promise.all(authors.map((author) => loadRow(author, tasks, difficulties, hardTasks)));
    const view = renderBoard(rows, tasks, days, difficulties, hardTasks);
    lastStatusPrefix = `live ${new Date().toLocaleTimeString("ru-RU")}`;
    lastStatusSuffix = "";
    updateStatus(view);
  } catch (error) {
    await loadSavedBoard(error);
  } finally {
    setLoading(false);
  }
}

async function loadSavedBoard(liveError) {
  try {
    const data = await fetchJson(`data/scoreboard.json?t=${Date.now()}`);
    const tasks = data.tasks || [];
    const days = data.days || chunk(tasks, 3);
    const hardTasks = getHardTaskSet(days);
    const difficulties = data.difficulties || {};
    const rows = enrichRows(data.rows || [], difficulties, hardTasks);
    const view = renderBoard(rows, tasks, days, difficulties, hardTasks);
    lastStatusPrefix = "saved data";
    lastStatusSuffix = ` (${liveError.message})`;
    updateStatus(view);
  } catch (error) {
    board.tBodies[0].innerHTML = `<tr><td>${escapeHtml(error.message)}</td></tr>`;
    statusEl.textContent = "error";
  }
}

async function loadAuthors() {
  const body = await fetchText(`authors.txt?t=${Date.now()}`);
  return body
    .split(/\n+/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)(?:\s+(.+))?$/);
      if (!match) throw new Error(`Bad author line: ${line}`);
      return { id: Number(match[1]), name: match[2] || `#${match[1]}` };
    });
}

async function loadTaskDays() {
  const body = await fetchText(`tasks.txt?t=${Date.now()}`);
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.replace(/#.*/g, " ").split(/[\s,;]+/).map(Number).filter(Boolean))
    .filter((block) => block.length > 0);
  return blocks.length > 1 ? blocks : chunk(blocks.flat(), 3);
}

async function loadSavedDifficulties() {
  try {
    const data = await fetchJson(`data/scoreboard.json?t=${Date.now()}`);
    return data.difficulties || {};
  } catch {
    return {};
  }
}

async function loadTaskDifficulties(tasks, saved = {}) {
  const pairs = await Promise.all(tasks.map(async (task) => {
    const savedDifficulty = Number(saved[task] || 0);
    if (savedDifficulty) return [task, savedDifficulty];
    return [task, await loadTaskDifficulty(task).catch(() => 0)];
  }));
  return Object.fromEntries(pairs);
}

async function loadTaskDifficulty(task) {
  const text = await fetchText(`${READER}${TIMUS}/problem.aspx?space=1&num=${task}&locale=en`);
  return Number(text.match(/Difficulty:\s*(\d+)/i)?.[1] || 0);
}

async function loadRow(author, tasks, difficulties, hardTasks) {
  const submissions = [];
  let next = `${TIMUS}/status.aspx?space=1&author=${author.id}&count=100&locale=en`;

  for (let page = 0; page < PAGES && next; page += 1) {
    const text = await fetchText(`${READER}${next}`);
    submissions.push(...parseReaderSubmissions(text, author.id, tasks));
    const nextHref = text.match(/\[Next 100\]\((https:\/\/acm\.timus\.ru\/status\.aspx[^)]+)\)/i)?.[1]
      || text.match(/Next 100.*?\((https:\/\/acm\.timus\.ru\/status\.aspx[^)]+)\)/i)?.[1];
    next = nextHref || "";
  }

  const uniqueSubmissions = uniqueById(submissions);
  const name = uniqueSubmissions.find((item) => item.authorName)?.authorName || author.name;
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

function parseReaderSubmissions(text, authorId, tasks) {
  const taskSet = new Set(tasks);
  const pageAuthorName = clean(text.match(/Author:\s*\[([^\]]+)\]/)?.[1]);
  return [...text.matchAll(/\[(\d+)\]\([^)]+\)([\s\S]*?)(?=\[\d+\]\([^)]+\)|Show \[|$)/g)]
    .map((match) => {
      const block = match[2];
      const parsedDate = parseDate(block);
      const author = block.match(/\[([\s\S]*?)\]\(https:\/\/acm\.timus\.ru\/author\.aspx\?id=(\d+)\)/);
      const parsedAuthorId = Number(author?.[2]);
      if (parsedAuthorId && parsedAuthorId !== authorId) return null;
      const problem = block.match(/\[(\d+)\. ([\s\S]*?)\]\([^)]+\)/);
      const problemId = Number(problem?.[1]);
      if (!problem || !taskSet.has(problemId)) return null;

      const afterProblem = block.slice(block.indexOf(problem[0]) + problem[0].length);
      const verdict = VERDICTS.find((item) => afterProblem.includes(item)) || "";
      const language = verdict ? clean(afterProblem.slice(0, afterProblem.indexOf(verdict))) : clean(afterProblem);

      return {
        id: Number(match[1]),
        date: parsedDate.text,
        timestamp: parsedDate.timestamp,
        authorName: clean(author?.[1]) || pageAuthorName,
        problemId,
        problemName: clean(problem[2]),
        language,
        verdict,
      };
    })
    .filter(Boolean)
    .filter((item) => item.timestamp >= CHALLENGE_START);
}

function parseDate(block) {
  const match = block.match(/(\d{2}):(\d{2}):(\d{2})\s+(\d{1,2}) ([A-Za-z]+) (\d{4})/);
  if (!match) return { text: "", timestamp: 0 };
  return {
    text: `${match[1]}:${match[2]}:${match[3]} ${match[4]} ${match[5]} ${match[6]}`,
    timestamp: Date.UTC(Number(match[6]), MONTHS[match[5]], Number(match[4]), Number(match[1]), Number(match[2]), Number(match[3])),
  };
}

function scoreTask(task, submissions, difficulty = 0, hard = false) {
  const list = submissions.filter((item) => item.problemId === task).sort((a, b) => a.id - b.id);
  const ac = list.find((item) => item.verdict === "Accepted");
  const wa = ac ? list.filter((item) => item.id < ac.id && item.verdict !== "Accepted").length : list.length;
  return {
    task,
    difficulty,
    hard,
    solved: Boolean(ac),
    wa,
    label: ac ? (wa ? `+(${wa})` : "+") : (wa ? `-${wa}` : ""),
    attempts: list.slice().reverse(),
  };
}

function enrichRows(rows, difficulties, hardTasks) {
  return rows.map((row) => enrichRow({
    ...row,
    cells: (row.cells || []).map((cell) => ({
      ...cell,
      difficulty: Number(cell.difficulty ?? difficulties[cell.task] ?? 0),
      hard: hardTasks.has(cell.task),
    })),
  }));
}

function enrichRow(row) {
  const cells = row.cells || [];
  const solvedCells = cells.filter((cell) => cell.solved);
  const hardCells = solvedCells.filter((cell) => cell.hard);
  return {
    ...row,
    solved: solvedCells.length,
    wa: cells.reduce((sum, cell) => sum + cell.wa, 0),
    difficultyScore: solvedCells.reduce((sum, cell) => sum + cell.difficulty, 0),
    hardSolved: hardCells.length,
    hardScore: hardCells.reduce((sum, cell) => sum + cell.difficulty, 0),
  };
}

function renderBoard(rows, tasks, days, difficulties = {}, hardTasks = getHardTaskSet(days)) {
  lastRows = rows;
  lastTasks = tasks;
  lastDays = days;
  lastDifficulties = difficulties;
  lastHardTasks = hardTasks;
  const rankedRows = sortRows(rows);
  const metricColumns = getMetricColumns();
  const taskDays = getVisibleTaskDays(days);
  const visibleTasks = taskDays.flatMap((day) => day.tasks);
  const visibleTaskSet = new Set(visibleTasks);
  const view = getBoardView(visibleTasks, days);
  board.classList.toggle("compact-board", view.compact);
  board.style.minWidth = `${view.minWidth}px`;
  board.tHead.innerHTML = `
    <tr>
      <th class="rank sticky" rowspan="2">#</th>
      <th class="name sticky-name" rowspan="2">Author</th>
      ${metricColumns.map((column, index) => `<th class="score sticky-metric-${index + 1}" rowspan="2">${column.title}</th>`).join("")}
      ${taskDays.map((day) => `<th class="day" colspan="${day.tasks.length}">Day ${day.index + 1}</th>`).join("")}
    </tr>
    <tr>
      ${visibleTasks.map((task) => taskHeaderHtml(task, difficulties[task] || 0)).join("")}
    </tr>
  `;

  if (rows.length === 0) {
    board.tBodies[0].innerHTML = `<tr><td colspan="${visibleTasks.length + metricColumns.length + 2}">no data</td></tr>`;
    return view;
  }

  board.tBodies[0].innerHTML = rankedRows.map((row, index) => `
    <tr>
      <td class="rank sticky">${index + 1}</td>
      <td class="name sticky-name"><a href="${TIMUS}/author.aspx?id=${row.id}" target="_blank" rel="noreferrer">${escapeHtml(row.name)}</a></td>
      ${metricColumns.map((column, columnIndex) => `<td class="score sticky-metric-${columnIndex + 1}">${row[column.key]}</td>`).join("")}
      ${row.cells.filter((cell) => visibleTaskSet.has(cell.task)).map((cell) => cellHtml(row, cell)).join("")}
    </tr>
  `).join("");

  board.querySelectorAll("[data-author][data-task]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const row = rankedRows.find((item) => item.id === Number(cell.dataset.author));
      const task = row.cells.find((item) => item.task === Number(cell.dataset.task));
      showAttempts(row, task);
    });
  });

  return view;
}

function sortRows(rows) {
  const tie = (a, b) => a.name.localeCompare(b.name);
  if (rankMode === "difficulty") {
    return rows.slice().sort((a, b) => b.difficultyScore - a.difficultyScore || b.solved - a.solved || a.wa - b.wa || tie(a, b));
  }
  if (rankMode === "hard") {
    return rows.slice().sort((a, b) => b.hardSolved - a.hardSolved || b.hardScore - a.hardScore || b.solved - a.solved || a.wa - b.wa || tie(a, b));
  }
  return rows.slice().sort((a, b) => b.solved - a.solved || a.wa - b.wa || b.difficultyScore - a.difficultyScore || tie(a, b));
}

function getMetricColumns() {
  if (rankMode === "difficulty") return [{ title: "Diff", key: "difficultyScore" }];
  if (rankMode === "hard") return [{ title: "Hard", key: "hardSolved" }, { title: "Hard Diff", key: "hardScore" }];
  return [{ title: "Solved", key: "solved" }, { title: "WA", key: "wa" }];
}

function getVisibleTaskDays(days) {
  return days
    .map((day, index) => ({
      index,
      tasks: rankMode === "hard" ? day.slice(2, 3) : day,
    }))
    .filter((day) => day.tasks.length > 0);
}

function getBoardView(tasks, days) {
  const width = document.documentElement.clientWidth || window.innerWidth || 1024;
  const mobile = width <= 720;
  const tiny = width <= 420;
  const compact = days.length > 10;
  const fixedColumns = tiny ? 31 + 108 + 76 : mobile ? 31 + 128 + 84 : compact ? 41 + 190 + 104 : 53 + 248 + 128;
  const metricColumns = (tiny ? 38 : mobile ? 42 : compact ? 52 : 64) * getMetricColumns().length;
  const taskWidth = tiny ? 38 : mobile ? 42 : 58;
  const minWidth = fixedColumns + metricColumns + tasks.length * taskWidth;
  const label = days.length === 1 ? "Day 1/1" : `Day 1-${days.length}/${days.length}`;
  return { minWidth, label, compact };
}

function updateStatus(view) {
  statusEl.textContent = `${lastStatusPrefix}${lastStatusSuffix}`;
}

function setLoading(value) {
  loading = value;
  loader.hidden = !value;
  reloadButton.disabled = value;
}

function setActiveRankButton() {
  rankButtons.forEach((button) => {
    const active = button.dataset.rank === rankMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function taskHeaderHtml(task, difficulty) {
  const title = difficulty ? `difficulty ${difficulty}` : "difficulty unknown";
  return `<th class="task" title="${title}"><a href="${TIMUS}/problem.aspx?space=1&num=${task}" target="_blank" rel="noreferrer">${task}</a></th>`;
}

function cellHtml(row, cell) {
  const cls = cell.solved ? "ok" : cell.wa ? "bad" : "empty";
  const attrs = cell.attempts.length ? `data-author="${row.id}" data-task="${cell.task}"` : "";
  return `<td class="task ${cls}" ${attrs}>${escapeHtml(cell.label)}</td>`;
}

function getHardTaskSet(days) {
  return new Set(days.map((day) => day[2]).filter(Boolean));
}

function showAttempts(row, cell) {
  attempts.hidden = false;
  attemptsTitle.textContent = `${row.name} / ${cell.task}`;
  attemptsBody.innerHTML = cell.attempts.map((item) => `
    <tr>
      <td><a href="${TIMUS}/getsubmit.aspx/${item.id}" target="_blank">${item.id}</a></td>
      <td>${escapeHtml(item.date)}</td>
      <td>${item.problemId}. ${escapeHtml(item.problemName)}</td>
      <td>${escapeHtml(item.verdict)}</td>
      <td>${escapeHtml(item.language)}</td>
    </tr>
  `).join("");
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}
