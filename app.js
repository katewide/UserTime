function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getTaskIdFromPlacementUrl() {
  const params = new URLSearchParams(window.location.search);
  try {
    const options = JSON.parse(params.get("placement_options") || "{}");
    return positiveInteger(options?.taskId);
  } catch {
    return null;
  }
}

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

function formatHours(seconds) {
  return `${(Number(seconds || 0) / 3600).toFixed(2).replace(".", ",")} ч`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setSummary(report) {
  document.getElementById("totalValue").textContent = formatHours(report.totalSeconds);
  document.getElementById("elrosValue").textContent = formatHours(report.summary.elrosSeconds);
  document.getElementById("trainingValue").textContent = formatHours(report.summary.trainingSeconds);
  document.getElementById("vrbValue").textContent = formatHours(report.summary.vrbSeconds);
  document.getElementById("cleanValue").textContent = formatHours(report.summary.cleanSeconds);
}

function renderEmployee(employee) {
  const categoryRows = Object.entries(employee.categories)
    .filter(([, value]) => value.seconds > 0)
    .map(([name, value]) => `
      <li><span>${escapeHtml(name)}</span><strong>${formatHours(value.seconds)}</strong><small>${value.entries} зап.</small></li>
    `)
    .join("");
  const details = categoryRows
    ? `<details class="tags"><summary>Время с хештегами <span>${formatHours(Object.values(employee.categories).reduce((sum, item) => sum + item.seconds, 0))}</span></summary><ul>${categoryRows}</ul></details>`
    : "";

  return `
    <article class="employee">
      <div class="employee__top">
        <h3>${escapeHtml(employee.name)}</h3>
        <div class="employee__metric"><span>Всего</span><strong>${formatHours(employee.totalSeconds)}</strong></div>
        <div class="employee__metric employee__metric--clean"><span>Чистое время</span><strong>${formatHours(employee.cleanSeconds)}</strong></div>
      </div>
      ${details}
    </article>
  `;
}

function renderDepartments(departments) {
  const target = document.getElementById("departments");
  target.innerHTML = departments
    .map(
      (department) => `
        <section class="department">
          <h2>${escapeHtml(department.name)}</h2>
          <div class="employees">${department.employees.map(renderEmployee).join("")}</div>
        </section>
      `,
    )
    .join("");
}

async function loadReport(taskId) {
  const state = document.getElementById("state");
  const meta = document.getElementById("meta");
  const target = document.getElementById("departments");
  const taskTitle = document.getElementById("taskTitle");
  const taskIdEl = document.getElementById("taskId");
  target.innerHTML = "";
  state.hidden = true;

  if (!taskId) {
    meta.textContent = "нет задачи";
    taskTitle.textContent = "Откройте приложение из карточки задачи";
    taskIdEl.textContent = "Контекст задачи не передан";
    state.hidden = false;
    state.innerHTML = "Чтобы увидеть расчёт, откройте приложение из блока «Приложения» в карточке задачи Bitrix24.";
    return;
  }

  try {
    const response = await fetch(`/api/task-report?taskId=${taskId}`);
    const report = await response.json().catch(() => null);
    if (!response.ok) throw new Error(report?.error || `Ошибка ${response.status}`);

    taskIdEl.textContent = `ID задачи ${report.taskId}`;
    taskTitle.textContent = report.taskTitle || `Задача ${report.taskId}`;
    setSummary(report);
    const employeeCount = report.departments.reduce((sum, item) => sum + item.employees.length, 0);
    meta.textContent = `${employeeCount} чел. · ${report.totalEntries ?? report.loadedEntries} записей`;

    if (employeeCount === 0) {
      state.hidden = false;
      state.innerHTML = "По этой задаче пока нет записей затраченного времени.";
      return;
    }
    renderDepartments(report.departments);
  } catch (error) {
    meta.textContent = "не удалось загрузить";
    taskTitle.textContent = "Данные недоступны";
    state.hidden = false;
    state.className = "state state--error";
    state.innerHTML = `<strong>Не удалось получить данные портала.</strong><br>${escapeHtml(error.message || "Неизвестная ошибка")}<br><button class="state__retry" id="retryBtn">Повторить</button>`;
    document.getElementById("retryBtn").addEventListener("click", () => loadReport(taskId));
  }
}

loadReport(getTaskId());
