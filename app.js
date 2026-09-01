function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Useful for local development and direct links. In the portal, the placement
// context below is the source of truth.
function getTaskIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["taskId", "ID", "id", "ENTITY_ID"]) {
    const taskId = positiveInteger(params.get(key));
    if (taskId) return taskId;
  }
  return null;
}

// TASK_VIEW_TAB sends { taskId, URI } in PLACEMENT_OPTIONS. BX24.init is
// asynchronous, so the report must wait until the frame SDK is ready.
function getTaskIdFromPlacement() {
  return new Promise((resolve) => {
    if (!window.BX24?.ready || !window.BX24?.init || !window.BX24?.placement) {
      resolve(null);
      return;
    }

    try {
      window.BX24.ready(() => {
        window.BX24.init(() => {
          try {
            const info = window.BX24.placement.info();
            resolve(positiveInteger(info?.options?.taskId));
          } catch {
            resolve(null);
          }
        });
      });
    } catch {
      resolve(null);
    }
  });
}

async function getTaskId() {
  return (await getTaskIdFromPlacement()) || getTaskIdFromUrl();
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

getTaskId().then(loadReport);
