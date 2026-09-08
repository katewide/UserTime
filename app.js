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

function formatRecords(count) {
  const value = Math.abs(Number(count) || 0);
  const lastTwo = value % 100;
  const last = value % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "записей"
      : last === 1
        ? "запись"
        : last >= 2 && last <= 4
          ? "записи"
          : "записей";
  return `${value} ${word}`;
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
  document.getElementById("vrb15Value").textContent = formatHours(report.summary.vrb15Seconds);
  document.getElementById("vrb2Value").textContent = formatHours(report.summary.vrb2Seconds);
  document.getElementById("vrbTotalValue").textContent = formatHours(
    report.summary.vrbSeconds + report.summary.vrb15Seconds + report.summary.vrb2Seconds,
  );
  document.getElementById("cleanValue").textContent = formatHours(report.summary.cleanSeconds);
}

function formatDate(value) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(date);
}

function formatAsOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Учёт времени по задаче";
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const pad = (number) => String(number).padStart(2, "0");
  return `Учёт времени по задаче на ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function renderChecklist(checklist) {
  const element = document.getElementById("taskChecklist");
  if (!checklist) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }

  const bzValue = checklist.bz?.url
    ? `<a href="${escapeHtml(checklist.bz.url)}" target="_blank" rel="noreferrer">${escapeHtml(checklist.bz.projectName || checklist.bz.url)}</a>`
    : escapeHtml(checklist.bz?.projectName || "—");
  const estimateValue = checklist.estimate?.length
    ? escapeHtml(checklist.estimate.join(", "))
    : "—";
  element.innerHTML = `
    <div class="task-checklist__item"><span>📌 БЗ:</span><strong>${bzValue}</strong></div>
    <div class="task-checklist__item"><span>🚀 Лимит:</span><strong>${escapeHtml(checklist.limit || "—")}</strong></div>
    <div class="task-checklist__item"><span>⏰ Оценка:</span><strong>${estimateValue}</strong></div>
  `;
  element.hidden = false;
}

function cleanSecondsForCategory(name, seconds) {
  if (name === "Элрос" || name === "Обучение") return 0;
  if (name === "ВРБ15") return seconds * 1.5;
  if (name === "ВРБ2") return seconds * 2;
  return seconds;
}

function renderTimePair(totalSeconds, cleanSeconds) {
  return `<span class="time-pair"><strong>${formatHours(totalSeconds)}</strong><strong class="time-pair__clean">${formatHours(cleanSeconds)}</strong></span>`;
}

function renderEmployee(employee) {
  const categoryRows = Object.entries(employee.categories)
    .filter(([, value]) => value.seconds > 0)
    .map(([name, value]) => {
      const records = [...value.records]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .map((entry) => `
          <li><time>${escapeHtml(formatDate(entry.date))}</time><span>${escapeHtml(entry.comment)}</span><strong>${formatHours(entry.seconds)}</strong></li>
        `)
        .join("");
      return `
        <li class="tag-group">
          <div class="tag-group__head"><span>${escapeHtml(name)}</span>${renderTimePair(value.seconds, cleanSecondsForCategory(name, value.seconds))}</div>
          <ul class="tag-records">${records}</ul>
        </li>
      `;
    })
    .join("");
  const taggedSeconds = Object.values(employee.categories).reduce((sum, item) => sum + item.seconds, 0);
  const taggedCleanSeconds = Object.entries(employee.categories).reduce(
    (sum, [name, item]) => sum + cleanSecondsForCategory(name, item.seconds),
    0,
  );
  const details = categoryRows
    ? `<details class="tags"><summary><span>Время с хештегами</span>${renderTimePair(taggedSeconds, taggedCleanSeconds)}</summary><ul>${categoryRows}</ul></details>`
    : "";
  const untaggedRows = employee.untaggedEntries
    .map((entry) => `
      <li><time>${escapeHtml(formatDate(entry.date))}</time><span>${escapeHtml(entry.comment)}</span><strong>${formatHours(entry.seconds)}</strong></li>
    `)
    .join("");
  const untaggedDetails = untaggedRows
    ? `<details class="untagged"><summary><span>Время без хэштегов</span>${renderTimePair(employee.untaggedSeconds, employee.untaggedSeconds)}</summary><ul>${untaggedRows}</ul></details>`
    : "";

  return `
    <article class="employee">
      <div class="employee__top">
        <div class="employee__name"><h3>${escapeHtml(employee.name)}</h3><span>${formatRecords(employee.entries)}</span></div>
        <div class="employee__metric"><strong>${formatHours(employee.totalSeconds)}</strong></div>
        <div class="employee__metric employee__metric--clean"><strong>${formatHours(employee.cleanSeconds)}</strong></div>
      </div>
      ${untaggedDetails}
      ${details}
    </article>
  `;
}

function renderDepartments(departments) {
  const target = document.getElementById("departments");
  target.innerHTML = departments
    .map(
      (department) => {
        const totalSeconds = department.employees.reduce(
          (sum, employee) => sum + employee.totalSeconds,
          0,
        );
        const cleanSeconds = department.employees.reduce(
          (sum, employee) => sum + employee.cleanSeconds,
          0,
        );
        return `
        <section class="department">
          <header class="department__head">
            <h2>${escapeHtml(department.name)}</h2>
            <div class="department__summary">
              <div class="department__metric"><span>Всего</span><strong>${formatHours(totalSeconds)}</strong></div>
              <div class="department__metric department__metric--clean"><span>Чистое время</span><strong>${formatHours(cleanSeconds)}</strong></div>
            </div>
          </header>
          <div class="employees">${department.employees.map(renderEmployee).join("")}</div>
        </section>
      `;
      },
    )
    .join("");
}

async function loadReport(taskId) {
  const state = document.getElementById("state");
  const meta = document.getElementById("meta");
  const target = document.getElementById("departments");
  const taskTitle = document.getElementById("taskTitle");
  const taskIdEl = document.getElementById("taskId");
  const summary = document.getElementById("summary");
  const checklist = document.getElementById("taskChecklist");
  target.innerHTML = "";
  state.hidden = true;

  if (!taskId) {
    summary.hidden = true;
    checklist.hidden = true;
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

    taskIdEl.textContent = `ID ${report.taskId}`;
    document.getElementById("asOf").textContent = formatAsOf(report.generatedAt);
    summary.hidden = report.totalSeconds <= 0;
    taskTitle.textContent = report.taskTitle || `Задача ${report.taskId}`;
    setSummary(report);
    renderChecklist(report.checklist);
    const employeeCount = report.departments.reduce((sum, item) => sum + item.employees.length, 0);
    meta.textContent = `${employeeCount} чел. · ${formatRecords(report.totalEntries ?? report.loadedEntries)}`;

    if (employeeCount === 0) {
      state.hidden = false;
      state.innerHTML = "По этой задаче пока нет записей затраченного времени.";
      return;
    }
    renderDepartments(report.departments);
  } catch (error) {
    summary.hidden = true;
    checklist.hidden = true;
    meta.textContent = "не удалось загрузить";
    taskTitle.textContent = "Данные недоступны";
    state.hidden = false;
    state.className = "state state--error";
    state.innerHTML = `<strong>Не удалось получить данные портала.</strong><br>${escapeHtml(error.message || "Неизвестная ошибка")}<br><button class="state__retry" id="retryBtn">Повторить</button>`;
    document.getElementById("retryBtn").addEventListener("click", () => loadReport(taskId));
  }
}

loadReport(getTaskId());
}

function formatDate(value) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(date);
}

function formatAsOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Учёт времени по задаче";
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const pad = (number) => String(number).padStart(2, "0");
  return `Учёт времени по задаче на ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function cleanSecondsForCategory(name, seconds) {
  if (name === "Элрос" || name === "Обучение") return 0;
  if (name === "ВРБ15") return seconds * 1.5;
  if (name === "ВРБ2") return seconds * 2;
  return seconds;
}

function renderTimePair(totalSeconds, cleanSeconds) {
  return `<span class="time-pair"><strong>${formatHours(totalSeconds)}</strong><strong class="time-pair__clean">${formatHours(cleanSeconds)}</strong></span>`;
}

function renderEmployee(employee) {
  const categoryRows = Object.entries(employee.categories)
    .filter(([, value]) => value.seconds > 0)
    .map(([name, value]) => {
      const records = [...value.records]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .map((entry) => `
          <li><time>${escapeHtml(formatDate(entry.date))}</time><span>${escapeHtml(entry.comment)}</span><strong>${formatHours(entry.seconds)}</strong></li>
        `)
        .join("");
      return `
        <li class="tag-group">
          <div class="tag-group__head"><span>${escapeHtml(name)}</span>${renderTimePair(value.seconds, cleanSecondsForCategory(name, value.seconds))}</div>
          <ul class="tag-records">${records}</ul>
        </li>
      `;
    })
    .join("");
  const taggedSeconds = Object.values(employee.categories).reduce((sum, item) => sum + item.seconds, 0);
  const taggedCleanSeconds = Object.entries(employee.categories).reduce(
    (sum, [name, item]) => sum + cleanSecondsForCategory(name, item.seconds),
    0,
  );
  const details = categoryRows
    ? `<details class="tags"><summary><span>Время с хештегами</span>${renderTimePair(taggedSeconds, taggedCleanSeconds)}</summary><ul>${categoryRows}</ul></details>`
    : "";
  const untaggedRows = employee.untaggedEntries
    .map((entry) => `
      <li><time>${escapeHtml(formatDate(entry.date))}</time><span>${escapeHtml(entry.comment)}</span><strong>${formatHours(entry.seconds)}</strong></li>
    `)
    .join("");
  const untaggedDetails = untaggedRows
    ? `<details class="untagged"><summary><span>Время без хэштегов</span>${renderTimePair(employee.untaggedSeconds, employee.untaggedSeconds)}</summary><ul>${untaggedRows}</ul></details>`
    : "";

  return `
    <article class="employee">
      <div class="employee__top">
        <div class="employee__name"><h3>${escapeHtml(employee.name)}</h3><span>${formatRecords(employee.entries)}</span></div>
        <div class="employee__metric"><strong>${formatHours(employee.totalSeconds)}</strong></div>
        <div class="employee__metric employee__metric--clean"><strong>${formatHours(employee.cleanSeconds)}</strong></div>
      </div>
      ${untaggedDetails}
      ${details}
    </article>
  `;
}

function renderDepartments(departments) {
  const target = document.getElementById("departments");
  target.innerHTML = departments
    .map(
      (department) => {
        const totalSeconds = department.employees.reduce(
          (sum, employee) => sum + employee.totalSeconds,
          0,
        );
        const cleanSeconds = department.employees.reduce(
          (sum, employee) => sum + employee.cleanSeconds,
          0,
        );
        return `
        <section class="department">
          <header class="department__head">
            <h2>${escapeHtml(department.name)}</h2>
            <div class="department__summary">
              <div class="department__metric"><span>Всего</span><strong>${formatHours(totalSeconds)}</strong></div>
              <div class="department__metric department__metric--clean"><span>Чистое время</span><strong>${formatHours(cleanSeconds)}</strong></div>
            </div>
          </header>
          <div class="employees">${department.employees.map(renderEmployee).join("")}</div>
        </section>
      `;
      },
    )
    .join("");
}

async function loadReport(taskId) {
  const state = document.getElementById("state");
  const meta = document.getElementById("meta");
  const target = document.getElementById("departments");
  const taskTitle = document.getElementById("taskTitle");
  const taskIdEl = document.getElementById("taskId");
  const summary = document.getElementById("summary");
  target.innerHTML = "";
  state.hidden = true;

  if (!taskId) {
    summary.hidden = true;
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

    taskIdEl.textContent = `ID ${report.taskId}`;
    document.getElementById("asOf").textContent = formatAsOf(report.generatedAt);
    summary.hidden = report.totalSeconds <= 0;
    taskTitle.textContent = report.taskTitle || `Задача ${report.taskId}`;
    setSummary(report);
    const employeeCount = report.departments.reduce((sum, item) => sum + item.employees.length, 0);
    meta.textContent = `${employeeCount} чел. · ${formatRecords(report.totalEntries ?? report.loadedEntries)}`;

    if (employeeCount === 0) {
      state.hidden = false;
      state.innerHTML = "По этой задаче пока нет записей затраченного времени.";
      return;
    }
    renderDepartments(report.departments);
  } catch (error) {
    summary.hidden = true;
    meta.textContent = "не удалось загрузить";
    taskTitle.textContent = "Данные недоступны";
    state.hidden = false;
    state.className = "state state--error";
    state.innerHTML = `<strong>Не удалось получить данные портала.</strong><br>${escapeHtml(error.message || "Неизвестная ошибка")}<br><button class="state__retry" id="retryBtn">Повторить</button>`;
    document.getElementById("retryBtn").addEventListener("click", () => loadReport(taskId));
  }
}

loadReport(getTaskId());
