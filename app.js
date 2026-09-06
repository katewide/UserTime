function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// VibeCode's placement handler forwards Bitrix24's PLACEMENT_OPTIONS as the
// lowercase placement_options URL parameter. Read it first: after the handler
// redirect the native BX24 SDK has no parent-window context and BX24.init()
// never completes.
function getTaskIdFromPlacementUrl() {
  const params = new URLSearchParams(window.location.search);
  try {
    const options = JSON.parse(params.get("placement_options") || "{}");
    return positiveInteger(options?.taskId);
  } catch {
    return null;
  }
}

// Useful for local development and manually composed direct links.
function getTaskIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["taskId", "ID", "id", "ENTITY_ID"]) {
    const taskId = positiveInteger(params.get(key));
    if (taskId) return taskId;
  }
  return null;
}

function getTaskId() {
  return getTaskIdFromPlacementUrl() || getTaskIdFromUrl();
}

async function loadReport(taskId) {
  const state = document.getElementById("state");
  const meta = document.getElementById("meta");
  const list = document.getElementById("leaderboard");
  const totalValue = document.getElementById("totalValue");
  const taskTitleEl = document.getElementById("taskTitle");

  list.innerHTML = "";
  state.hidden = true;
  meta.textContent = "загружаем…";

  if (!taskId) {
    meta.textContent = "нет задачи";
    taskTitleEl.textContent = "Откройте задачу";
    state.hidden = false;
    state.className = "state";
    state.innerHTML =
      "Вкладка открыта вне карточки задачи. Откройте её из карточки задачи в Bitrix24, чтобы увидеть затраченное время по сотрудникам.";
    return;
  }

  let data;
  try {
    const res = await fetch(`/api/task-report?taskId=${taskId}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error || `Ошибка ${res.status}`);
    }
    data = body;
  } catch (err) {
    meta.textContent = "не удалось загрузить";
    state.hidden = false;
    state.className = "state state--error";
    state.innerHTML =
      "<strong>Не удалось получить данные портала.</strong><br>" +
      escapeHtml(err.message || "Неизвестная ошибка") +
      '<br><button class="state__retry" id="retryBtn">Повторить</button>';
    document
      .getElementById("retryBtn")
      .addEventListener("click", () => loadReport(taskId));
    return;
  }

  taskTitleEl.textContent = data.taskTitle || `Задача ${data.taskId}`;
  totalValue.textContent = data.totalLabel || "—";
  meta.textContent = `${data.rows.length} чел. · ${data.totalEntries ?? data.loadedEntries} записей времени`;

  if (!data.rows || data.rows.length === 0) {
    state.hidden = false;
    state.className = "state";
    state.innerHTML =
      "По этой задаче пока нет записей затраченного времени — добавьте время во вкладке «Учёт времени» задачи.";
    return;
  }

  const max = data.rows[0]?.seconds || 1;
  data.rows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "row";
    li.style.animationDelay = `${i * 0.045}s`;

    const share = Math.min(100, Math.round((row.seconds / max) * 100));
    li.innerHTML = `
      <div class="row__rank">${i + 1}</div>
      <div class="row__body">
        <div class="row__name">${escapeHtml(row.name)}</div>
        <div class="row__delta">${row.entries} зап.</div>
        <div class="row__bar">
          <div class="row__bar-fill" data-w="${share}"></div>
        </div>
      </div>
      <div class="row__time">${escapeHtml(row.label)}</div>
    `;
    list.appendChild(li);
  });

  requestAnimationFrame(() => {
    list.querySelectorAll(".row__bar-fill").forEach((el) => {
      el.style.width = el.dataset.w + "%";
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

loadReport(getTaskId());
