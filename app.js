const SAVED_REFRESH_MS = 30000;
const VERSION_CHECK_MS = 120000;
const DAYS_PER_WEEK = 7;
const TIMUS = "https://acm.timus.ru";
const FETCH_TIMEOUT_MS = 15000;

const statusEl = document.querySelector("#status");
const loader = document.querySelector("#loader");
const reloadButton = document.querySelector("#reload");
const board = document.querySelector("#board");
const attempts = document.querySelector("#attempts");
const attemptsTitle = document.querySelector("#attemptsTitle");
const attemptsBody = attempts.querySelector("tbody");
const rankButtons = [...document.querySelectorAll("[data-rank]")];
const weekControls = document.querySelector("#weekControls");
const weekLabel = document.querySelector("#weekLabel");
const weekButtons = [...document.querySelectorAll("[data-week-step]")];
let lastRows = [];
let lastTasks = [];
let lastDays = [];
let lastDifficulties = {};
let lastHardTasks = new Set();
let lastStatusPrefix = "";
let lastStatusSuffix = "";
let rankMode = "solved";
let selectedWeek = 0;
let resizeTimer = 0;
let loading = false;
let assetVersion = currentAssetVersion();

reloadButton.addEventListener("click", () => loadSavedBoard({ manual: true }));
rankButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rankMode = button.dataset.rank;
    setActiveRankButton();
    if (!lastDays.length) return;
    const view = renderBoard(lastRows, lastTasks, lastDays, lastDifficulties, lastHardTasks);
    updateStatus(view);
  });
});
weekButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!lastDays.length) return;
    const weekCount = getWeekCount(lastDays);
    selectedWeek = clamp(selectedWeek + Number(button.dataset.weekStep), 1, weekCount);
    const view = renderBoard(lastRows, lastTasks, lastDays, lastDifficulties, lastHardTasks);
    updateStatus(view);
  });
});
setActiveRankButton();
loadSavedBoard();
setInterval(() => loadSavedBoard(), SAVED_REFRESH_MS);
setInterval(checkAssetVersion, VERSION_CHECK_MS);
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!lastDays.length) return;
    const view = renderBoard(lastRows, lastTasks, lastDays, lastDifficulties, lastHardTasks);
    updateStatus(view);
  }, 120);
});

async function loadSavedBoard(options = {}) {
  if (loading) {
    return;
  }
  setLoading(true);
  try {
    if (options.manual) hideAttempts();
    statusEl.textContent = options.manual ? "reloading saved board" : "loading saved board";
    const [data, authors] = await Promise.all([
      loadSavedData(),
      loadAuthors().catch(() => []),
    ]);
    const tasks = data.tasks || [];
    const days = data.days || chunk(tasks, 3);
    const hardTasks = getHardTaskSet(days);
    const difficulties = data.difficulties || {};
    const rows = applyAuthorAliases(normalizeRows(data.rows || [], tasks, difficulties, hardTasks), authors);
    const view = renderBoard(rows, tasks, days, difficulties, hardTasks);
    lastStatusPrefix = `saved ${formatSavedTime(data.updatedAt)}`;
    lastStatusSuffix = "";
    updateStatus(view);
  } catch (error) {
    board.tBodies[0].innerHTML = `<tr><td>${escapeHtml(error.message)}</td></tr>`;
    statusEl.textContent = "error";
  } finally {
    setLoading(false);
  }
}

async function loadSavedData() {
  return fetchJson(`data/scoreboard.json?t=${Date.now()}`);
}

async function checkAssetVersion() {
  try {
    const html = await fetchText(`index.html?t=${Date.now()}`);
    const nextVersion = clean(html.match(/app\.js\?v=([^"]+)/)?.[1]);
    if (nextVersion && assetVersion && nextVersion !== assetVersion) location.reload();
    assetVersion = nextVersion || assetVersion;
  } catch (error) {
    console.warn("version check failed", error);
  }
}

async function loadAuthors() {
  const body = await fetchText(`authors.txt?t=${Date.now()}`);
  return body
    .split(/\n+/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)(?:;(.+))?$/);
      if (!match) throw new Error(`Bad author line: ${line}`);
      return { id: Number(match[1]), alias: clean(match[2]) };
    });
}

function normalizeRows(rows, tasks, difficulties, hardTasks) {
  return rows.map((row) => normalizeRow(row, tasks, difficulties, hardTasks));
}

function normalizeRow(row, tasks, difficulties, hardTasks) {
  const cells = new Map((row.cells || []).map((cell) => [cell.task, cell]));
  return enrichRow({
    ...row,
    cells: tasks.map((task) => {
      const cell = cells.get(task) || { task, solved: false, label: "", attempts: [] };
      const penalty = getPenalty(cell);
      return {
        ...cell,
        task,
        penalty,
        wa: penalty,
        difficulty: Number(cell.difficulty ?? difficulties[task] ?? 0),
        hard: hardTasks.has(task),
        attempts: cell.attempts || [],
      };
    }),
  });
}

function applyAuthorAliases(rows, authors) {
  const aliases = new Map(authors.filter((author) => author.alias).map((author) => [author.id, author.alias]));
  return rows.map((row) => ({
    ...row,
    name: aliases.get(row.id) || row.name,
  }));
}

function enrichRow(row) {
  const cells = row.cells || [];
  const solvedCells = cells.filter((cell) => cell.solved);
  const hardCells = solvedCells.filter((cell) => cell.hard);
  return {
    ...row,
    solved: solvedCells.length,
    penalty: cells.reduce((sum, cell) => sum + getPenalty(cell), 0),
    wa: cells.reduce((sum, cell) => sum + getPenalty(cell), 0),
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
  const metricColumns = getMetricColumns();
  syncSelectedWeek(days);
  renderWeekControls(days);
  const taskDays = getVisibleTaskDays(days);
  const visibleTasks = taskDays.flatMap((day) => day.tasks);
  const visibleTaskSet = new Set(visibleTasks);
  const rankedRows = sortRows(rows);
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
    return rows.slice().sort((a, b) => b.difficultyScore - a.difficultyScore || b.solved - a.solved || getPenalty(a) - getPenalty(b) || tie(a, b));
  }
  if (rankMode === "hard") {
    return rows.slice().sort((a, b) => b.hardSolved - a.hardSolved || b.hardScore - a.hardScore || b.solved - a.solved || getPenalty(a) - getPenalty(b) || tie(a, b));
  }
  return rows.slice().sort((a, b) => b.solved - a.solved || getPenalty(a) - getPenalty(b) || b.difficultyScore - a.difficultyScore || tie(a, b));
}

function getMetricColumns() {
  if (rankMode === "difficulty") return [{ title: "Diff", key: "difficultyScore" }];
  if (rankMode === "hard") return [{ title: "Hard", key: "hardSolved" }, { title: "Hard Diff", key: "hardScore" }];
  return [{ title: "Solved", key: "solved" }, { title: "Penalty", key: "penalty" }];
}

function getVisibleTaskDays(days) {
  const weekStart = (selectedWeek - 1) * DAYS_PER_WEEK;
  const weekEnd = Math.min(days.length, selectedWeek * DAYS_PER_WEEK);
  return days.slice(weekStart, weekEnd)
    .map((day, offset) => ({
      index: weekStart + offset,
      tasks: rankMode === "hard" ? day.slice(2, 3) : day,
    }))
    .filter((day) => day.tasks.length > 0);
}

function getWeekCount(days) {
  return Math.max(1, Math.ceil(days.length / DAYS_PER_WEEK));
}

function syncSelectedWeek(days) {
  const weekCount = getWeekCount(days);
  selectedWeek = selectedWeek ? clamp(selectedWeek, 1, weekCount) : weekCount;
}

function renderWeekControls(days) {
  const weekCount = getWeekCount(days);
  const lastDay = Math.min(days.length, selectedWeek * DAYS_PER_WEEK);
  const firstDay = (selectedWeek - 1) * DAYS_PER_WEEK + 1;
  const dayLabel = firstDay === lastDay ? `Day ${lastDay}` : `Day ${firstDay}-${lastDay}`;
  weekControls.hidden = days.length === 0;
  weekLabel.textContent = `Week ${selectedWeek} / ${weekCount} (${dayLabel})`;
  weekButtons.forEach((button) => {
    const step = Number(button.dataset.weekStep);
    const disabled = step < 0 ? selectedWeek <= 1 : selectedWeek >= weekCount;
    button.disabled = disabled;
    button.title = step < 0 ? `Week ${Math.max(1, selectedWeek - 1)}` : `Week ${Math.min(weekCount, selectedWeek + 1)}`;
  });
  if (firstDay > lastDay) weekLabel.textContent = `Week ${selectedWeek} / ${weekCount}`;
}

function getBoardView(tasks, days) {
  const width = document.documentElement.clientWidth || window.innerWidth || 1024;
  const mobile = width <= 720;
  const tiny = width <= 420;
  const compact = days.length > 10;
  const fixedColumns = tiny ? 31 + 108 : mobile ? 31 + 128 : compact ? 41 + 190 : 53 + 248;
  const metricColumns = (tiny ? 52 : mobile ? 58 : compact ? 52 : 64) * getMetricColumns().length;
  const taskWidth = tiny ? 38 : mobile ? 42 : 58;
  const minWidth = fixedColumns + metricColumns + tasks.length * taskWidth;
  const label = days.length === 1 ? "Day 1/1" : `Day 1-${days.length}/${days.length}`;
  return { minWidth, label, compact };
}

function updateStatus(view) {
  statusEl.textContent = `${lastStatusPrefix}${lastStatusSuffix}`;
}

function formatSavedTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "data";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
  const cls = cell.solved ? "ok" : getPenalty(cell) ? "bad" : "empty";
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

function hideAttempts() {
  attempts.hidden = true;
  attemptsTitle.textContent = "";
  attemptsBody.innerHTML = "";
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function getPenalty(item) {
  return Number(item?.penalty ?? item?.wa ?? 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function currentAssetVersion() {
  return clean(document.querySelector('script[src^="app.js?v="]')?.src.match(/[?&]v=([^&]+)/)?.[1]);
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
