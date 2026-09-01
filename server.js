import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loads `.env` for a LOCAL run, searching upwards from this file's directory —
// never relative to the working directory. On the deployed server there is no
// `.env` (excluded from the archive) and the three managed variables already
// arrive via the process environment, so this is a no-op there.
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
const PUBLIC_DIR = path.join(__dirname, "public");

console.log(
  KEY
    ? `portal key loaded from ${KEY_FROM_ENVIRONMENT ? "the environment" : ENV_FILE}`
    : `NO portal key — /api/report will answer 503 until it appears`,
);

// Simple TTL cache: the portal rate-limits per key, so cache the aggregated
// report briefly to keep shared-key usage low.
const cache = new Map();
async function cached(key, ttlMs, produce) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await produce();
  cache.set(key, { at: now, value });
  return value;
}

async function portal(pathname, { method = "GET" } = {}) {
  if (!KEY || !BASE) {
    const err = new Error("portal_not_connected");
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "X-Api-Key": KEY,
      Accept: "application/json",
    },
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

// Fetch all time entries of ONE task with page-based pagination.
// Every entry carries userId + seconds; meta.total marks the final page.
async function fetchTaskTimeEntries(taskId) {
  const limit = 50;
  let offset = 0;
  const entries = [];
  let total = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    // The nested endpoint makes the task boundary explicit: it cannot return
    // time entries belonging to a different task.
    const body = await portal(`/tasks/${taskId}/time?${params.toString()}`);
    const rows = Array.isArray(body?.data) ? body.data : [];
    if (total === null) total = body?.meta?.total ?? null;
    entries.push(...rows);
    // The time endpoint returns meta.total, not meta.hasMore.
    // Continue until that total is reached; the short-page condition is a
    // defensive fallback for older/partial API responses.
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

// Map user id -> display name. Falls back to "ID …" when a profile is missing.
async function fetchUserNames() {
  const body = await portal("/users");
  const users = Array.isArray(body?.data) ? body.data : [];
  const map = new Map();
  for (const u of users) {
    const name = [u?.name, u?.lastName].filter(Boolean).join(" ") || u?.login || "";
    map.set(String(u?.id), name || `ID ${u?.id}`);
  }
  return map;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

async function buildTaskReport(taskId) {
  const [timeRes, taskRes] = await Promise.allSettled([
    fetchTaskTimeEntries(taskId),
    portal(`/tasks/${taskId}`),
  ]);

  if (timeRes.status === "rejected") throw timeRes.reason;
  const { entries, total } = timeRes.value;
  const names = await fetchUserNames();

  const taskData = taskRes.status === "fulfilled" ? taskRes.value?.data : null;
  const taskTitle = taskData?.title || taskData?.name || "";

  // Aggregate seconds per user across the task's entries.
  const byUser = new Map();
  for (const e of entries) {
    const uid = String(e?.userId ?? "");
    const secs = Number(e?.seconds) || 0;
    if (!uid || secs <= 0) continue;
    const row = byUser.get(uid) || { userId: uid, seconds: 0, entries: 0 };
    row.seconds += secs;
    row.entries += 1;
    byUser.set(uid, row);
  }

  const rows = [...byUser.values()]
    .map((r) => ({
      userId: Number(r.userId),
      name: names.get(r.userId) || `ID ${r.userId}`,
      seconds: r.seconds,
      entries: r.entries,
      label: formatDuration(r.seconds),
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const totalSeconds = rows.reduce((s, r) => s + r.seconds, 0);
  return {
    taskId: Number(taskId),
    taskTitle,
    generatedAt: new Date().toISOString(),
    totalEntries: total ?? entries.length,
    loadedEntries: entries.length,
    totalSeconds,
    totalLabel: formatDuration(totalSeconds),
    rows,
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
      // Cache briefly per task — pulls all time entries of the task.
      const report = await cached(`report:${taskId}`, 30_000, () =>
        buildTaskReport(taskId),
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

  // Static files — served only from PUBLIC_DIR.
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
