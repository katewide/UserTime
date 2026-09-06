import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvUpwards(startDir, maxLevels = 4) {
  let dir = path.resolve(startDir);
  for (let level = 0; level <= maxLevels; level += 1) {
    const file = path.join(dir, ".env");
    if (existsSync(file)) {
      try {
        for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
          const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
          if (!m || m[1] in process.env) continue;
          process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
        }
      } catch {
        // Unreadable file — treat as absent and keep looking no further.
      }
      return file;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const KEY_FROM_ENVIRONMENT =
  typeof process.env.BITRIX_API_KEY === "string" &&
  process.env.BITRIX_API_KEY !== "";
const ENV_FILE = loadEnvUpwards(__dirname);

const PORT = process.env.PORT || 3000;
const BASE = process.env.BITRIX_API_BASE_URL || "";
const KEY = process.env.BITRIX_API_KEY || "";
// The deployed archive keeps index.html, app.js and styles.css in its root.
const PUBLIC_DIR = __dirname;

console.log(
  KEY
    ? `portal key loaded from ${KEY_FROM_ENVIRONMENT ? "the environment" : ENV_FILE}`
    : `NO portal key — /api/report will answer 503 until it appears`,
);

const cache = new Map();
async function cached(key, ttlMs, produce) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await produce();
  cache.set(key, { at: now, value });
  return value;
}

async function portal(pathname, { method = "GET", authorization = "" } = {}) {
  if (!KEY || !BASE) {
    const err = new Error("portal_not_connected");
    err.status = 503;
    throw err;
  }
  const headers = {
    "X-Api-Key": KEY,
    Accept: "application/json",
  };
  // In a Bitrix24 placement the VibeCode Gateway injects this short-lived
  // per-user session into the server request. OAuth app keys require it for
  // every API call; it is never exposed to browser JavaScript.
  if (authorization) headers.Authorization = authorization;

  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.error?.message || `portal_error_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function fetchTaskTimeEntries(taskId, authorization) {
  const limit = 50;
  let offset = 0;
  const entries = [];
  let total = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const body = await portal(`/tasks/${taskId}/time?${params.toString()}`, {
      authorization,
    });
    const rows = Array.isArray(body?.data) ? body.data : [];
    if (total === null) total = body?.meta?.total ?? null;
    entries.push(...rows);
    if (
      rows.length === 0 ||
      (Number.isFinite(total) && entries.length >= total) ||
      rows.length < limit
    ) {
      break;
    }
    offset += rows.length;
  }
  return { entries, total };
}

async function fetchUsers(authorization) {
  // The default users page is small. Time entries may refer to employees with
  // high IDs, so ask VibeCode to collect every employee page for this portal.
  const body = await portal("/users?limit=5000", { authorization });
  const users = Array.isArray(body?.data) ? body.data : [];
  const map = new Map();
  for (const u of users) {
    const name =
      [u?.lastName, u?.name, u?.secondName].filter(Boolean).join(" ") ||
      u?.login ||
      "";
    map.set(String(u?.id), {
      name: name || `ID ${u?.id}`,
      departmentIds: Array.isArray(u?.departmentId) ? u.departmentId : [],
    });
  }
  return map;
}

async function fetchDepartments(authorization) {
  const body = await portal("/departments?limit=5000", { authorization });
  const departments = Array.isArray(body?.data) ? body.data : [];
  return new Map(departments.map((department) => [
    String(department.id),
    department.name || `Отдел ${department.id}`,
  ]));
}

function formatDuration(totalSeconds) {
  return `${(totalSeconds / 3600).toFixed(2).replace(".", ",")} ч`;
}

function hasLabel(text, label) {
  // A hashtag is optional because historical comments may contain the word
  // without it. Unicode boundaries keep #ВРБ from matching #ВРБ15 or #ВРБ2.
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])#?${label}(?=$|[^\\p{L}\\p{N}_])`,
    "iu",
  );
  return pattern.test(text);
}

function classifyTimeEntry(entry) {
  const comment = String(entry?.commentText ?? entry?.comment ?? "");
  const isTraining = hasLabel(comment, "обучение");
  const isElros = hasLabel(comment, "элрос");

  // The requested priority is deliberate: training wins over Elros, and both
  // win over every ВРБ marker when more than one label occurs in a comment.
  if (isTraining) return "Обучение";
  if (isElros) return "Элрос";
  if (hasLabel(comment, "врб15")) return "ВРБ15";
  if (hasLabel(comment, "врб2")) return "ВРБ2";
  if (hasLabel(comment, "врб")) return "ВРБ";
  return "Без категории";
}

const CATEGORY_ORDER = ["Обучение", "Элрос", "ВРБ", "ВРБ15", "ВРБ2"];

async function buildTaskReport(taskId, authorization) {
  const [timeRes, taskRes, usersRes, departmentsRes] = await Promise.allSettled([
    fetchTaskTimeEntries(taskId, authorization),
    portal(`/tasks/${taskId}`, { authorization }),
    fetchUsers(authorization),
    fetchDepartments(authorization),
  ]);

  if (timeRes.status === "rejected") throw timeRes.reason;
  const { entries, total } = timeRes.value;
  if (usersRes.status === "rejected") throw usersRes.reason;
  if (departmentsRes.status === "rejected") throw departmentsRes.reason;
  const users = usersRes.value;
  const departmentsById = departmentsRes.value;

  const taskData = taskRes.status === "fulfilled" ? taskRes.value?.data : null;
  const taskTitle = taskData?.title || taskData?.name || "";
  const byDepartment = new Map();
  const categoryTotals = Object.fromEntries(CATEGORY_ORDER.map((name) => [name, 0]));

  for (const e of entries) {
    const uid = String(e?.userId ?? "");
    const secs = Number(e?.seconds) || 0;
    if (!uid || secs <= 0) continue;
    const category = classifyTimeEntry(e);
    const user = users.get(uid) || { name: `ID ${uid}`, departmentIds: [] };
    const departmentId = user.departmentIds[0] ?? null;
    const departmentName = departmentId
      ? departmentsById.get(String(departmentId)) || `Отдел ${departmentId}`
      : "Без отдела";
    const department = byDepartment.get(departmentName) || new Map();
    const employee = department.get(uid) || {
      userId: Number(uid),
      name: user.name,
      totalSeconds: 0,
      entries: 0,
      categories: Object.fromEntries(CATEGORY_ORDER.map((name) => [name, {
        seconds: 0,
        entries: 0,
      }])),
    };
    employee.totalSeconds += secs;
    employee.entries += 1;
    if (categoryTotals[category] !== undefined) {
      categoryTotals[category] += secs;
      employee.categories[category].seconds += secs;
      employee.categories[category].entries += 1;
    }
    department.set(uid, employee);
    byDepartment.set(departmentName, department);
  }

  const totalSeconds = entries.reduce((sum, entry) => sum + (Number(entry?.seconds) || 0), 0);
  const elrosSeconds = categoryTotals["Элрос"];
  const trainingSeconds = categoryTotals["Обучение"];
  const vrbSeconds = categoryTotals["ВРБ"] + categoryTotals["ВРБ15"] + categoryTotals["ВРБ2"];
  const groupedDepartments = [...byDepartment.entries()]
    .map(([name, employees]) => ({
      name,
      employees: [...employees.values()]
        .map((employee) => ({
          ...employee,
          cleanSeconds: employee.totalSeconds - employee.categories["Элрос"].seconds - employee.categories["Обучение"].seconds,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return {
    taskId: Number(taskId),
    taskTitle,
    generatedAt: new Date().toISOString(),
    totalEntries: total ?? entries.length,
    loadedEntries: entries.length,
    totalSeconds,
    totalLabel: formatDuration(totalSeconds),
    summary: {
      elrosSeconds,
      trainingSeconds,
      vrbSeconds,
      cleanSeconds: totalSeconds - elrosSeconds - trainingSeconds,
    },
    departments: groupedDepartments,
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (url.pathname === "/api/task-report") {
    try {
      const taskId = Number(url.searchParams.get("taskId"));
      if (!Number.isInteger(taskId) || taskId <= 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Укажите задачу (taskId)" }));
        return;
      }
      const authorization =
        typeof req.headers["x-vibe-authorization"] === "string"
          ? req.headers["x-vibe-authorization"]
          : "";
      const userId =
        typeof req.headers["x-vibe-user-id"] === "string"
          ? req.headers["x-vibe-user-id"]
          : "service";
      const report = await cached(`report:${userId}:${taskId}`, 30_000, () =>
        buildTaskReport(taskId, authorization),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report));
    } catch (err) {
      const status = err.status || 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            status === 503
              ? "Портал не подключён"
              : err.message || "Не удалось получить данные",
        }),
      );
    }
    return;
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const isDotfile = rel.split("/").some((seg) => seg.startsWith("."));
  const filePath = path.resolve(PUBLIC_DIR, rel);
  const insidePublic =
    filePath === PUBLIC_DIR || filePath.startsWith(PUBLIC_DIR + path.sep);
  if (isDotfile || !insidePublic) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : ext === ".css"
        ? "text/css; charset=utf-8"
        : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => console.log(`listening on ${PORT}`));
