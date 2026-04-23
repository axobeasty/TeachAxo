const LEGACY_STORAGE_KEY = "teachaxo_data_v2";

const PERMISSIONS = {
  manage_classes: "Управление классами",
  manage_students: "Управление учениками",
  manage_grades: "Управление оценками",
  manage_schedule: "Управление расписанием",
  print_data: "Печать данных",
  manage_roles: "Управление ролями",
  manage_users: "Управление пользователями"
};

const SECTION_PERMISSIONS = {
  classes: "manage_classes",
  students: "manage_students",
  grades: "manage_grades",
  schedule: "manage_schedule"
};

const state = {
  classes: [],
  students: [],
  grades: [],
  schedule: [],
  scheduleSettings: {
    firstLessonStart: "08:00",
    lessonDurationMin: 45
  },
  databaseConfig: {
    mode: "local",
    localName: "teachaxo_local.db",
    remote: {
      host: "",
      port: "3306",
      user: "",
      password: "",
      database: ""
    }
  },
  storageInfo: {
    provider: "sqlite",
    sqlitePath: "-"
  },
  roles: [],
  users: [],
  currentUserId: null,
  auth: {
    rememberSession: false,
    rememberedUserId: null
  },
  appMeta: {
    appName: "TeachAxo",
    appVersion: "0.0.0",
    buildVersion: "0.0.0"
  },
  runtimeUpdate: {
    state: "idle",
    message: "Проверка обновлений не выполнялась.",
    availableVersion: null
  },
  updatePromptedVersion: null,
  searchQuery: "",
  classSearchQuery: ""
};

const dayOrder = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const CURRENT_VERSION_CHANGELOG = [
  "Ускорено автообновление за счет параллельного скачивания архива.",
  "Приложение работает в режиме SQLite-only для хранения данных.",
  "Добавлена миграция данных в удаленную MySQL из настроек.",
  "Обновлен SPA-интерфейс с боковой навигацией и улучшенной сеткой."
];

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toMinutes(timeValue) {
  const [hours, minutes] = String(timeValue || "00:00")
    .split(":")
    .map((value) => Number(value));
  return hours * 60 + minutes;
}

function fromMinutes(totalMinutes) {
  const minutesInDay = 24 * 60;
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minutes = String(normalized % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function calculateLessonTime(lessonNumber) {
  const lessonIndex = Number(lessonNumber) - 1;
  if (!Number.isInteger(lessonIndex) || lessonIndex < 0) return null;
  const baseStartMinutes = toMinutes(state.scheduleSettings.firstLessonStart);
  const duration = Number(state.scheduleSettings.lessonDurationMin);
  const start = fromMinutes(baseStartMinutes + lessonIndex * duration);
  const end = fromMinutes(baseStartMinutes + (lessonIndex + 1) * duration);
  return { start, end };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeVersionValue(value, fallback = "0.0.0") {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || /^0(?:\.0)+(?:\.0)?$/.test(raw)) return fallback;
  return raw;
}

function getVersionLabel() {
  const appVersion = normalizeVersionValue(state.appMeta.appVersion, "0.0.0");
  const buildVersion = normalizeVersionValue(state.appMeta.buildVersion, appVersion);
  return buildVersion === appVersion ? appVersion : `${appVersion} (build ${buildVersion})`;
}

function getCurrentUser() {
  return state.users.find((user) => user.id === state.currentUserId) ?? null;
}

function getRole(roleId) {
  return state.roles.find((role) => role.id === roleId) ?? null;
}

function hasPermission(permission) {
  const user = getCurrentUser();
  if (!user) return false;
  const role = getRole(user.roleId);
  if (!role) return false;
  return role.permissions.includes(permission);
}

function canAccessSection(section) {
  if (section === "home" || section === "settings") return true;
  if (section === "access") return hasPermission("manage_roles") || hasPermission("manage_users");
  return hasPermission(SECTION_PERMISSIONS[section] ?? "");
}

function applyLoadedState(parsed) {
  if (!parsed) return;
  state.classes = Array.isArray(parsed.classes) ? parsed.classes : [];
  state.students = Array.isArray(parsed.students) ? parsed.students : [];
  state.grades = Array.isArray(parsed.grades) ? parsed.grades : [];
  state.schedule = Array.isArray(parsed.schedule) ? parsed.schedule : [];
  state.scheduleSettings = {
    firstLessonStart: parsed.scheduleSettings?.firstLessonStart || "08:00",
    lessonDurationMin: Number(parsed.scheduleSettings?.lessonDurationMin) || 45
  };
  state.databaseConfig = {
    mode: parsed.databaseConfig?.mode === "remote" ? "remote" : "local",
    localName: parsed.databaseConfig?.localName || "teachaxo_local.db",
    remote: {
      host: parsed.databaseConfig?.remote?.host || "",
      port: parsed.databaseConfig?.remote?.port || "3306",
      user: parsed.databaseConfig?.remote?.user || "",
      password: parsed.databaseConfig?.remote?.password || "",
      database: parsed.databaseConfig?.remote?.database || ""
    }
  };
  state.roles = Array.isArray(parsed.roles) ? parsed.roles : [];
  state.users = Array.isArray(parsed.users) ? parsed.users : [];
  state.currentUserId = parsed.currentUserId ?? null;
  const hasAuthSettings = parsed.auth && typeof parsed.auth === "object";
  state.auth = {
    rememberSession: hasAuthSettings ? Boolean(parsed.auth?.rememberSession) : Boolean(parsed.currentUserId),
    rememberedUserId: hasAuthSettings ? parsed.auth?.rememberedUserId ?? null : parsed.currentUserId ?? null
  };
}

function readLegacyLocalStorageState() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function loadState() {
  try {
    if (!window.teachAxoDb?.getState || !window.teachAxoDb?.saveState) {
      throw new Error("SQLite API недоступен. Приложение должно работать только через SQLite.");
    }

    const dbState = await window.teachAxoDb.getState();
    if (dbState) {
      applyLoadedState(dbState);
    } else {
      // One-time migration for users who had data in old localStorage builds.
      const legacyState = readLegacyLocalStorageState();
      if (legacyState) {
        applyLoadedState(legacyState);
        await window.teachAxoDb.saveState({
          classes: state.classes,
          students: state.students,
          grades: state.grades,
          schedule: state.schedule,
          scheduleSettings: state.scheduleSettings,
          databaseConfig: state.databaseConfig,
          roles: state.roles,
          users: state.users,
          currentUserId: state.currentUserId,
          auth: state.auth
        });
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }

    const info = await window.teachAxoDb.getInfo();
    if (info?.provider) state.storageInfo.provider = info.provider;
    if (info?.sqlitePath) state.storageInfo.sqlitePath = info.sqlitePath;
  } catch (error) {
    console.error("Не удалось прочитать данные TeachAxo из SQLite:", error);
  }
}

function saveState() {
  const snapshot = {
    classes: state.classes,
    students: state.students,
    grades: state.grades,
    schedule: state.schedule,
    scheduleSettings: state.scheduleSettings,
    databaseConfig: state.databaseConfig,
    roles: state.roles,
    users: state.users,
    currentUserId: state.currentUserId,
    auth: state.auth
  };
  if (!window.teachAxoDb?.saveState) {
    console.error("SQLite API недоступен. Сохранение отменено.");
    return;
  }
  window.teachAxoDb.saveState(snapshot).catch((error) => {
    console.error("Не удалось сохранить данные в SQLite:", error);
  });
}

function seedAccessData() {
  if (state.roles.length === 0) {
    state.roles.push({
      id: uid(),
      name: "Администратор",
      permissions: Object.keys(PERMISSIONS),
      isSystem: true
    });
  }

  const adminRole = state.roles.find((role) => role.name === "Администратор") ?? state.roles[0];
  const adminExists = state.users.some((user) => user.username.toLowerCase() === "admin");
  if (!adminExists) {
    state.users.push({
      id: uid(),
      username: "admin",
      password: "admin123",
      roleId: adminRole.id,
      isSystem: true
    });
  }
}

function activateSection(section) {
  const target = canAccessSection(section) ? section : "home";
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    const allowed = canAccessSection(item.dataset.section);
    item.classList.toggle("hidden", !allowed);
  });
  document.querySelectorAll(".section").forEach((panel) => panel.classList.remove("active"));
  const activeNav = document.querySelector(`.nav-item[data-section="${target}"]`);
  const activePanel = document.querySelector(`[data-section-panel="${target}"]`);
  if (activeNav) activeNav.classList.add("active");
  if (activePanel) activePanel.classList.add("active");
}

function applyAccessControl() {
  document.querySelectorAll(".quick-nav-button").forEach((button) => {
    button.classList.toggle("hidden", !canAccessSection(button.dataset.goSection));
  });
  document.getElementById("print-class-list").classList.toggle("hidden", !hasPermission("print_data"));
  document.getElementById("print-schedule").classList.toggle("hidden", !hasPermission("print_data"));
}

function setupNav() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => activateSection(item.dataset.section));
  });
  document.querySelectorAll(".quick-nav-button").forEach((button) => {
    button.addEventListener("click", () => activateSection(button.dataset.goSection));
  });
}

function ensureClassExists(className) {
  const normalized = className.trim().toLowerCase();
  if (!normalized) return;
  const exists = state.classes.some((item) => item.name.trim().toLowerCase() === normalized);
  if (!exists) state.classes.push({ id: uid(), name: className.trim(), note: "" });
}

function renderClasses() {
  const tbody = document.getElementById("classes-table-body");
  const query = state.classSearchQuery.toLowerCase().trim();
  const filtered = state.classes.filter((classItem) =>
    `${classItem.name} ${classItem.note}`.toLowerCase().includes(query)
  );
  tbody.innerHTML = filtered
    .map((classItem) => {
      const studentsCount = state.students.filter((student) => student.className === classItem.name).length;
      return `<tr>
        <td>${escapeHtml(classItem.name)}</td>
        <td>${escapeHtml(classItem.note || "-")}</td>
        <td>${studentsCount}</td>
        <td><button class="ui mini red button" data-delete-class="${classItem.id}">Удалить</button></td>
      </tr>`;
    })
    .join("");
}

function renderClassesDatalist() {
  document.getElementById("classes-datalist").innerHTML = state.classes
    .map((classItem) => `<option value="${escapeHtml(classItem.name)}"></option>`)
    .join("");
}

function renderStudents() {
  const tbody = document.getElementById("students-table-body");
  const query = state.searchQuery.toLowerCase().trim();
  const filtered = state.students.filter((student) =>
    `${student.name} ${student.className} ${student.subject}`.toLowerCase().includes(query)
  );
  tbody.innerHTML = filtered
    .map(
      (student) => `<tr>
        <td>${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.className)}</td>
        <td>${escapeHtml(student.subject || "-")}</td>
        <td>${escapeHtml(student.contact || "-")}</td>
        <td><button class="ui mini red button" data-delete-student="${student.id}">Удалить</button></td>
      </tr>`
    )
    .join("");
}

function renderGradeStudentsDropdown() {
  document.getElementById("grade-student").innerHTML = [
    `<option value="">Выберите ученика</option>`,
    ...state.students.map(
      (student) => `<option value="${student.id}">${escapeHtml(student.name)} (${escapeHtml(student.className)})</option>`
    )
  ].join("");
}

function renderGrades() {
  const tbody = document.getElementById("grades-table-body");
  const sorted = [...state.grades].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = sorted
    .map((grade) => {
      const student = state.students.find((s) => s.id === grade.studentId);
      return `<tr>
        <td>${escapeHtml(grade.date)}</td>
        <td>${escapeHtml(student?.name || "Удаленный ученик")}</td>
        <td>${escapeHtml(student?.className || "-")}</td>
        <td><strong>${escapeHtml(grade.value)}</strong></td>
        <td>${escapeHtml(grade.comment || "-")}</td>
      </tr>`;
    })
    .join("");
}

function renderSchedule() {
  const tbody = document.getElementById("schedule-table-body");
  const sorted = [...state.schedule].sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
  });
  tbody.innerHTML = sorted
    .map(
      (entry) => `<tr>
        <td>${escapeHtml(entry.day)}</td>
        <td>${escapeHtml(entry.start)} - ${escapeHtml(entry.end)}</td>
        <td>${escapeHtml(entry.className)}</td>
        <td>${escapeHtml(entry.subject)}</td>
        <td>${escapeHtml(entry.room || "-")}</td>
        <td>${escapeHtml(entry.notes || "-")}</td>
        <td><button class="ui mini red button" data-delete-schedule="${entry.id}">Удалить</button></td>
      </tr>`
    )
    .join("");
}

function getCurrentUserScheduleEntries() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  return state.schedule.filter(
    (entry) => entry.userId === currentUser.id || !entry.userId
  );
}

function renderHomeSchedule() {
  const tbody = document.getElementById("home-schedule-table-body");
  const sorted = [...getCurrentUserScheduleEntries()].sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
  });

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="center aligned">У вас пока нет записей в расписании.</td></tr>`;
    return;
  }

  const slotKeys = [...new Set(sorted.map((entry) => `${entry.start}-${entry.end}`))].sort((a, b) => {
    const [startA] = a.split("-");
    const [startB] = b.split("-");
    return startA.localeCompare(startB);
  });

  const byDayAndTime = new Map();
  sorted.forEach((entry) => {
    byDayAndTime.set(`${entry.day}|${entry.start}-${entry.end}`, entry);
  });

  tbody.innerHTML = slotKeys
    .map((slot) => {
      const [start, end] = slot.split("-");
      const cells = dayOrder
        .map((day) => {
          const entry = byDayAndTime.get(`${day}|${slot}`);
          if (!entry) return `<td class="weekly-empty-cell">-</td>`;
          return `<td>
            <div class="weekly-schedule-entry">
              <div class="subject">${escapeHtml(entry.subject)}</div>
              <div>${escapeHtml(entry.className)}</div>
              <div class="meta">Кабинет: ${escapeHtml(entry.room || "-")}</div>
              <div class="meta">${escapeHtml(entry.notes || "")}</div>
            </div>
          </td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(start)} - ${escapeHtml(end)}</td>${cells}</tr>`;
    })
    .join("");
}

function renderHomeDashboard() {
  const classesCount = state.classes.length;
  const studentsCount = state.students.length;
  const gradesCount = state.grades.length;
  const scheduleCount = getCurrentUserScheduleEntries().length;
  const currentUser = getCurrentUser();

  document.getElementById("home-stat-classes").textContent = String(classesCount);
  document.getElementById("home-stat-students").textContent = String(studentsCount);
  document.getElementById("home-stat-grades").textContent = String(gradesCount);
  document.getElementById("home-stat-schedule").textContent = String(scheduleCount);

  const subtitle = currentUser
    ? `Добро пожаловать, ${currentUser.username}. Ваша текущая нагрузка: ${scheduleCount} урок(ов) в расписании.`
    : "Добро пожаловать в TeachAxo. Здесь собрана вся ключевая информация по классам, ученикам и урокам.";
  document.getElementById("home-hero-subtitle").textContent = subtitle;

  const sorted = [...getCurrentUserScheduleEntries()].sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
  });
  const nextLessons = sorted.slice(0, 5);
  const nextLessonsContainer = document.getElementById("home-next-lessons");

  if (nextLessons.length === 0) {
    nextLessonsContainer.innerHTML = `<div class="ui message">Пока нет уроков в расписании.</div>`;
    return;
  }

  nextLessonsContainer.innerHTML = nextLessons
    .map(
      (entry) => `<div class="home-next-lesson">
      <div class="title">${escapeHtml(entry.day)} • ${escapeHtml(entry.start)} - ${escapeHtml(entry.end)}</div>
      <div>${escapeHtml(entry.subject)} (${escapeHtml(entry.className)})</div>
      <div class="meta">Кабинет: ${escapeHtml(entry.room || "-")} ${entry.notes ? `• ${escapeHtml(entry.notes)}` : ""}</div>
    </div>`
    )
    .join("");
}

function renderSettingsPage() {
  const currentUser = getCurrentUser();
  const currentRole = currentUser ? getRole(currentUser.roleId) : null;
  const appVersion = normalizeVersionValue(state.appMeta.appVersion, "-");
  const buildVersion = normalizeVersionValue(state.appMeta.buildVersion, appVersion);
  const versionLabel = getVersionLabel();

  document.getElementById("settings-app-version").textContent = appVersion;
  document.getElementById("settings-build-version").textContent = buildVersion;
  document.getElementById("settings-version-label").textContent = versionLabel;
  document.getElementById("settings-current-user").textContent = currentUser?.username || "-";
  document.getElementById("settings-current-role").textContent = currentRole?.name || "Без роли";
  document.getElementById("settings-storage-provider").textContent = String(state.storageInfo.provider || "sqlite").toUpperCase();
  document.getElementById("settings-sqlite-path").textContent = state.storageInfo.sqlitePath || "-";
  document.getElementById("home-current-version").textContent = versionLabel;

  document.getElementById("current-version-changelog").innerHTML = CURRENT_VERSION_CHANGELOG
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  document.getElementById("database-mode").value = state.databaseConfig.mode;
  document.getElementById("database-local-name").value = state.databaseConfig.localName;
  document.getElementById("database-remote-host").value = state.databaseConfig.remote.host;
  document.getElementById("database-remote-port").value = state.databaseConfig.remote.port;
  document.getElementById("database-remote-user").value = state.databaseConfig.remote.user;
  document.getElementById("database-remote-password").value = state.databaseConfig.remote.password;
  document.getElementById("database-remote-name").value = state.databaseConfig.remote.database;

  const isRemote = state.databaseConfig.mode === "remote";
  document.getElementById("database-local-fields").classList.toggle("hidden", isRemote);
  document.getElementById("database-remote-fields").classList.toggle("hidden", !isRemote);
}

function renderRoles() {
  const tbody = document.getElementById("roles-table-body");
  tbody.innerHTML = state.roles
    .map((role) => `<tr>
      <td>${escapeHtml(role.name)}</td>
      <td>${role.permissions.map((p) => escapeHtml(PERMISSIONS[p])).join(", ") || "-"}</td>
      <td><button class="ui mini red button" data-delete-role="${role.id}">Удалить</button></td>
    </tr>`)
    .join("");
}

function renderUsers() {
  const tbody = document.getElementById("users-table-body");
  const roleSelect = document.getElementById("user-role");
  roleSelect.innerHTML = [
    `<option value="">Выберите роль</option>`,
    ...state.roles.map((role) => `<option value="${role.id}">${escapeHtml(role.name)}</option>`)
  ].join("");

  tbody.innerHTML = state.users
    .map((user) => {
      const role = getRole(user.roleId);
      return `<tr>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(role?.name || "Без роли")}</td>
        <td><button class="ui mini red button" data-delete-user="${user.id}">Удалить</button></td>
      </tr>`;
    })
    .join("");
}

function renderStatusBar() {
  const dbProvider = String(state.storageInfo.provider || "sqlite").toUpperCase();
  const dbPath = state.storageInfo.sqlitePath || "-";
  const dbStateNode = document.getElementById("statusbar-db-state");
  if (dbStateNode) {
    dbStateNode.textContent = `${dbProvider}: ${dbPath}`;
  }

  const updateStateNode = document.getElementById("statusbar-update-state");
  if (updateStateNode) {
    updateStateNode.textContent = state.runtimeUpdate.message || "Проверка обновлений не выполнялась.";
  }

  const installButton = document.getElementById("statusbar-install-update");
  if (installButton) {
    const hasUpdate =
      (state.runtimeUpdate.state === "available" || state.runtimeUpdate.state === "downloaded") &&
      Boolean(state.runtimeUpdate.availableVersion);
    installButton.classList.toggle("hidden", !hasUpdate);
    if (hasUpdate) {
      installButton.textContent =
        state.runtimeUpdate.state === "downloaded"
          ? `Установить ${state.runtimeUpdate.availableVersion}`
          : `Обновить до ${state.runtimeUpdate.availableVersion}`;
    } else {
      installButton.textContent = "Обновить";
    }
  }
}

function renderAll() {
  renderClasses();
  renderClassesDatalist();
  renderStudents();
  renderGradeStudentsDropdown();
  renderGrades();
  renderSchedule();
  renderHomeSchedule();
  renderHomeDashboard();
  renderSettingsPage();
  renderRoles();
  renderUsers();
  renderStatusBar();
  applyAccessControl();
}

function requirePermission(permission) {
  if (hasPermission(permission)) return true;
  alert("Недостаточно прав для этого действия.");
  return false;
}

function setupClassesHandlers() {
  const form = document.getElementById("class-form");
  const search = document.getElementById("class-search");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_classes")) return;
    const name = document.getElementById("class-name").value.trim();
    const note = document.getElementById("class-note").value.trim();
    if (!name) return;
    if (state.classes.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) {
      alert("Такой класс уже есть.");
      return;
    }
    state.classes.push({ id: uid(), name, note });
    form.reset();
    saveState();
    renderAll();
  });
  search.addEventListener("input", (event) => {
    state.classSearchQuery = event.target.value;
    renderClasses();
  });
  document.getElementById("classes-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_classes")) return;
    const classId = event.target.dataset.deleteClass;
    if (!classId) return;
    const classItem = state.classes.find((item) => item.id === classId);
    if (!classItem) return;
    if (state.students.some((student) => student.className === classItem.name)) {
      alert("Нельзя удалить класс, пока в нем есть ученики.");
      return;
    }
    state.classes = state.classes.filter((item) => item.id !== classId);
    saveState();
    renderAll();
  });
}

function setupStudentHandlers() {
  const form = document.getElementById("student-form");
  document.getElementById("student-search").addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderStudents();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_students")) return;
    const name = document.getElementById("student-name").value.trim();
    const className = document.getElementById("student-class").value.trim();
    const subject = document.getElementById("student-subject").value.trim();
    const contact = document.getElementById("student-contact").value.trim();
    const notes = document.getElementById("student-notes").value.trim();
    if (!name || !className) return;
    ensureClassExists(className);
    state.students.push({ id: uid(), name, className, subject, contact, notes });
    form.reset();
    saveState();
    renderAll();
  });
  document.getElementById("students-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_students")) return;
    const studentId = event.target.dataset.deleteStudent;
    if (!studentId) return;
    state.students = state.students.filter((student) => student.id !== studentId);
    state.grades = state.grades.filter((grade) => grade.studentId !== studentId);
    saveState();
    renderAll();
  });
}

function setupGradesHandlers() {
  const form = document.getElementById("grade-form");
  const dateInput = document.getElementById("grade-date");
  dateInput.valueAsDate = new Date();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_grades")) return;
    const studentId = document.getElementById("grade-student").value;
    const value = document.getElementById("grade-value").value;
    const date = document.getElementById("grade-date").value;
    const comment = document.getElementById("grade-comment").value.trim();
    if (!studentId || !value || !date) return;
    state.grades.push({ id: uid(), studentId, value, date, comment });
    form.reset();
    dateInput.valueAsDate = new Date();
    saveState();
    renderGrades();
  });
}

function setupScheduleHandlers() {
  const form = document.getElementById("schedule-form");
  const settingsForm = document.getElementById("schedule-settings-form");
  const firstLessonStartInput = document.getElementById("schedule-first-lesson-start");
  const lessonDurationSelect = document.getElementById("schedule-lesson-duration");
  const lessonNumberInput = document.getElementById("schedule-lesson-number");
  const startInput = document.getElementById("schedule-start");
  const endInput = document.getElementById("schedule-end");

  const applyCalculatedTime = () => {
    const lessonNumber = Number(lessonNumberInput.value);
    const timeRange = calculateLessonTime(lessonNumber);
    if (!timeRange) {
      startInput.value = "";
      endInput.value = "";
      return;
    }
    startInput.value = timeRange.start;
    endInput.value = timeRange.end;
  };

  const syncSettingsForm = () => {
    firstLessonStartInput.value = state.scheduleSettings.firstLessonStart;
    lessonDurationSelect.value = String(state.scheduleSettings.lessonDurationMin);
  };

  syncSettingsForm();
  applyCalculatedTime();

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_schedule")) return;
    const firstLessonStart = firstLessonStartInput.value;
    const lessonDurationMin = Number(lessonDurationSelect.value);
    if (!firstLessonStart || ![40, 45, 90].includes(lessonDurationMin)) {
      alert("Проверьте настройки расписания.");
      return;
    }
    state.scheduleSettings = { firstLessonStart, lessonDurationMin };
    saveState();
    applyCalculatedTime();
    alert("Настройки конструктора расписания сохранены.");
  });

  lessonNumberInput.addEventListener("input", applyCalculatedTime);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_schedule")) return;
    const day = document.getElementById("schedule-day").value;
    const lessonNumber = Number(lessonNumberInput.value);
    const timeRange = calculateLessonTime(lessonNumber);
    const start = startInput.value || timeRange?.start || "";
    const end = endInput.value || timeRange?.end || "";
    const className = document.getElementById("schedule-class").value.trim();
    const subject = document.getElementById("schedule-subject").value.trim();
    const room = document.getElementById("schedule-room").value.trim();
    const notes = document.getElementById("schedule-notes").value.trim();
    if (!day || !start || !end || !className || !subject || !Number.isInteger(lessonNumber) || lessonNumber < 1) {
      alert("Заполните день, номер урока, класс и предмет.");
      return;
    }
    if (start >= end) {
      alert("Время начала должно быть раньше времени окончания.");
      return;
    }
    state.schedule.push({
      id: uid(),
      userId: state.currentUserId,
      day,
      lessonNumber,
      start,
      end,
      className,
      subject,
      room,
      notes
    });
    form.reset();
    applyCalculatedTime();
    saveState();
    renderSchedule();
    renderHomeSchedule();
  });
  document.getElementById("schedule-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_schedule")) return;
    const entryId = event.target.dataset.deleteSchedule;
    if (!entryId) return;
    state.schedule = state.schedule.filter((entry) => entry.id !== entryId);
    saveState();
    renderSchedule();
    renderHomeSchedule();
  });
}

function setupAccessHandlers() {
  document.getElementById("role-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_roles")) return;
    const roleName = document.getElementById("role-name").value.trim();
    const permissions = [...document.querySelectorAll(".role-permission:checked")].map((el) => el.value);
    if (!roleName) return;
    if (state.roles.some((role) => role.name.toLowerCase() === roleName.toLowerCase())) {
      alert("Роль с таким названием уже существует.");
      return;
    }
    state.roles.push({ id: uid(), name: roleName, permissions, isSystem: false });
    document.getElementById("role-form").reset();
    saveState();
    renderAll();
  });

  document.getElementById("roles-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_roles")) return;
    const roleId = event.target.dataset.deleteRole;
    if (!roleId) return;
    const role = getRole(roleId);
    if (!role) return;
    if (role.isSystem) {
      alert("Системную роль удалить нельзя.");
      return;
    }
    if (state.users.some((user) => user.roleId === roleId)) {
      alert("Нельзя удалить роль, пока она назначена пользователям.");
      return;
    }
    state.roles = state.roles.filter((item) => item.id !== roleId);
    saveState();
    renderAll();
  });

  document.getElementById("user-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_users")) return;
    const username = document.getElementById("user-username").value.trim();
    const password = document.getElementById("user-password").value;
    const roleId = document.getElementById("user-role").value;
    if (!username || !password || !roleId) return;
    if (password.length < 4) {
      alert("Пароль должен быть не короче 4 символов.");
      return;
    }
    if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      alert("Пользователь с таким логином уже существует.");
      return;
    }
    state.users.push({ id: uid(), username, password, roleId, isSystem: false });
    document.getElementById("user-form").reset();
    saveState();
    renderAll();
  });

  document.getElementById("users-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_users")) return;
    const userId = event.target.dataset.deleteUser;
    if (!userId) return;
    const user = state.users.find((item) => item.id === userId);
    if (!user) return;
    if (user.id === state.currentUserId) {
      alert("Нельзя удалить текущего пользователя.");
      return;
    }
    if (user.isSystem) {
      alert("Системного пользователя удалить нельзя.");
      return;
    }
    state.users = state.users.filter((item) => item.id !== userId);
    saveState();
    renderAll();
  });
}

function setupDatabaseSettingsHandlers() {
  const form = document.getElementById("database-settings-form");
  const modeSelect = document.getElementById("database-mode");
  const localFields = document.getElementById("database-local-fields");
  const remoteFields = document.getElementById("database-remote-fields");
  const status = document.getElementById("database-settings-status");
  const migrateButton = document.getElementById("database-migrate-button");
  const testConnectionButton = document.getElementById("database-test-connection-button");

  const buildDatabaseConfigFromForm = () => {
    const mode = modeSelect.value === "remote" ? "remote" : "local";
    const localName = document.getElementById("database-local-name").value.trim() || "teachaxo_local.db";
    const remote = {
      host: document.getElementById("database-remote-host").value.trim(),
      port: document.getElementById("database-remote-port").value.trim() || "3306",
      user: document.getElementById("database-remote-user").value.trim(),
      password: document.getElementById("database-remote-password").value,
      database: document.getElementById("database-remote-name").value.trim()
    };
    return { mode, localName, remote };
  };

  modeSelect.addEventListener("change", () => {
    const isRemote = modeSelect.value === "remote";
    localFields.classList.toggle("hidden", isRemote);
    remoteFields.classList.toggle("hidden", !isRemote);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { mode, localName, remote } = buildDatabaseConfigFromForm();

    if (mode === "remote" && (!remote.host || !remote.port || !remote.user || !remote.database)) {
      status.textContent = "Для удаленной базы заполните host, port, пользователя и имя БД.";
      status.className = "ui tiny red message";
      return;
    }

    state.databaseConfig = { mode, localName, remote };
    saveState();
    try {
      if (!window.teachAxoDb?.applyRuntimeConfig) {
        throw new Error("Сервис применения настроек БД недоступен.");
      }
      status.textContent = "Применяем настройки БД и перезапускаем приложение...";
      status.className = "ui tiny info message";
      await window.teachAxoDb.applyRuntimeConfig({ mode, remote });
    } catch (error) {
      status.textContent = `Ошибка применения настроек БД: ${error.message}`;
      status.className = "ui tiny red message";
    }
  });

  testConnectionButton.addEventListener("click", async () => {
    try {
      if (!window.teachAxoDb?.testMysqlConnection) {
        throw new Error("Сервис проверки подключения к БД недоступен.");
      }
      const config = buildDatabaseConfigFromForm();
      if (config.mode !== "remote") {
        throw new Error("Для проверки выберите режим удаленной БД.");
      }
      status.textContent = "Проверяем подключение к MySQL...";
      status.className = "ui tiny info message";
      await window.teachAxoDb.testMysqlConnection(config);
      status.textContent = "Подключение к MySQL успешно установлено.";
      status.className = "ui tiny positive message";
    } catch (error) {
      status.textContent = `Ошибка подключения: ${error.message}`;
      status.className = "ui tiny red message";
    }
  });

  migrateButton.addEventListener("click", async () => {
    try {
      if (!window.teachAxoDb?.migrateToMysql) {
        throw new Error("Сервис миграции БД недоступен.");
      }
      const config = buildDatabaseConfigFromForm();
      if (config.mode !== "remote") {
        throw new Error("Для миграции выберите режим удаленной БД.");
      }
      status.textContent = "Выполняем миграцию данных в MySQL...";
      status.className = "ui tiny info message";
      await window.teachAxoDb.migrateToMysql(config);
      status.textContent = "Миграция в MySQL успешно завершена.";
      status.className = "ui tiny positive message";
    } catch (error) {
      status.textContent = `Ошибка миграции: ${error.message}`;
      status.className = "ui tiny red message";
    }
  });
}

function setupStatusBarHandlers() {
  const checkButton = document.getElementById("statusbar-check-updates");
  const installButton = document.getElementById("statusbar-install-update");

  const applyUpdateStatus = (payload) => {
    state.runtimeUpdate = {
      state: payload?.state || "idle",
      message: payload?.message || "Проверка обновлений не выполнялась.",
      availableVersion: payload?.availableVersion || null
    };
    renderStatusBar();

    const canPromptInstall =
      state.runtimeUpdate.state === "downloaded" &&
      state.runtimeUpdate.availableVersion &&
      state.updatePromptedVersion !== state.runtimeUpdate.availableVersion;
    if (!canPromptInstall) return;

    state.updatePromptedVersion = state.runtimeUpdate.availableVersion;
    const shouldInstallNow = window.confirm(
      `Обновление ${state.runtimeUpdate.availableVersion} уже загружено. Установить сейчас?`
    );
    if (!shouldInstallNow || !window.teachAxo?.installUpdate) return;
    window.teachAxo.installUpdate().catch((error) => {
      applyUpdateStatus({
        state: "error",
        message: `Ошибка запуска обновления: ${error.message}`,
        availableVersion: state.runtimeUpdate.availableVersion
      });
    });
  };

  if (window.teachAxo?.onUpdateStatus) {
    window.teachAxo.onUpdateStatus((payload) => applyUpdateStatus(payload));
  }

  if (checkButton) {
    checkButton.addEventListener("click", async () => {
      if (!window.teachAxo?.checkUpdates) return;
      checkButton.disabled = true;
      try {
        const status = await window.teachAxo.checkUpdates();
        applyUpdateStatus(status);
      } catch (error) {
        applyUpdateStatus({
          state: "error",
          message: `Ошибка проверки обновлений: ${error.message}`,
          availableVersion: null
        });
      } finally {
        checkButton.disabled = false;
      }
    });
  }

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!window.teachAxo?.installUpdate) return;
      installButton.disabled = true;
      try {
        const result = await window.teachAxo.installUpdate();
        if (!result?.ok) {
          applyUpdateStatus({
            state: "error",
            message: result?.message || "Не удалось запустить обновление.",
            availableVersion: state.runtimeUpdate.availableVersion
          });
        }
      } catch (error) {
        applyUpdateStatus({
          state: "error",
          message: `Ошибка запуска обновления: ${error.message}`,
          availableVersion: state.runtimeUpdate.availableVersion
        });
      } finally {
        installButton.disabled = false;
      }
    });
  }
}

function buildPrintablePage(title, contentHtml) {
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title><style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #333; padding: 8px; text-align: left; }
  th { background: #f0f0f0; }
  </style></head><body><h1>${escapeHtml(title)}</h1>${contentHtml}</body></html>`;
}

function printHtml(title, contentHtml) {
  if (!requirePermission("print_data")) return;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(buildPrintablePage(title, contentHtml));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 300);
}

function setupPrintHandlers() {
  document.getElementById("print-class-list").addEventListener("click", () => {
    const rows = state.students
      .map(
        (s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.className)}</td><td>${escapeHtml(s.subject || "-")}</td><td>${escapeHtml(s.contact || "-")}</td></tr>`
      )
      .join("");
    printHtml(
      "TeachAxo - Список учеников",
      `<table><thead><tr><th>ФИО</th><th>Класс</th><th>Предмет</th><th>Контакты</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  });

  document.getElementById("print-schedule").addEventListener("click", () => {
    const sorted = [...state.schedule].sort((a, b) => {
      const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
      return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
    });
    const rows = sorted
      .map(
        (s) => `<tr><td>${escapeHtml(s.day)}</td><td>${escapeHtml(s.start)} - ${escapeHtml(s.end)}</td><td>${escapeHtml(s.className)}</td><td>${escapeHtml(s.subject)}</td><td>${escapeHtml(s.room || "-")}</td><td>${escapeHtml(s.notes || "-")}</td></tr>`
      )
      .join("");
    printHtml(
      "TeachAxo - Расписание",
      `<table><thead><tr><th>День</th><th>Время</th><th>Класс</th><th>Предмет</th><th>Кабинет</th><th>Комментарий</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  });
}

function setupAuthHandlers() {
  const authScreen = document.getElementById("auth-screen");
  const appShell = document.getElementById("app-shell");
  const loginError = document.getElementById("login-error");
  const currentUserLabel = document.getElementById("current-user-label");

  const showLogin = () => {
    authScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    document.getElementById("login-form").reset();
    const rememberCheckbox = document.getElementById("login-remember");
    if (rememberCheckbox) rememberCheckbox.checked = state.auth.rememberSession;
    loginError.classList.add("hidden");
    loginError.textContent = "";
  };

  const showApp = () => {
    const user = getCurrentUser();
    currentUserLabel.textContent = user ? user.username : "-";
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    renderAll();
    activateSection("home");
  };

  document.getElementById("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.getElementById("login-username").value.trim().toLowerCase();
    const password = document.getElementById("login-password").value;
    const rememberSession = document.getElementById("login-remember").checked;
    const user = state.users.find(
      (candidate) => candidate.username.toLowerCase() === username && candidate.password === password
    );
    if (!user) {
      loginError.textContent = "Неверный логин или пароль.";
      loginError.classList.remove("hidden");
      return;
    }
    state.currentUserId = user.id;
    state.auth.rememberSession = rememberSession;
    state.auth.rememberedUserId = rememberSession ? user.id : null;
    saveState();
    showApp();
  });

  document.getElementById("logout-button").addEventListener("click", () => {
    state.currentUserId = null;
    state.auth.rememberSession = false;
    state.auth.rememberedUserId = null;
    saveState();
    showLogin();
  });

  if (!getCurrentUser() && state.auth.rememberSession && state.auth.rememberedUserId) {
    const rememberedUser = state.users.find((user) => user.id === state.auth.rememberedUserId);
    if (rememberedUser) {
      state.currentUserId = rememberedUser.id;
      saveState();
    } else {
      state.auth.rememberSession = false;
      state.auth.rememberedUserId = null;
      saveState();
    }
  }

  if (getCurrentUser()) showApp();
  else showLogin();
}

async function init() {
  try {
    const meta = await window.teachAxo?.getMeta?.();
    if (meta && typeof meta === "object") {
      state.appMeta.appName = meta.appName || "TeachAxo";
      state.appMeta.appVersion = normalizeVersionValue(meta.appVersion, "0.0.0");
      state.appMeta.buildVersion = normalizeVersionValue(meta.buildVersion, state.appMeta.appVersion);
    }
  } catch (error) {
    console.warn("Не удалось получить метаданные приложения:", error);
  }
  try {
    const updateStatus = await window.teachAxo?.getUpdateStatus?.();
    if (updateStatus) {
      state.runtimeUpdate = {
        state: updateStatus.state || "idle",
        message: updateStatus.message || "Проверка обновлений не выполнялась.",
        availableVersion: updateStatus.availableVersion || null
      };
    }
  } catch (error) {
    console.warn("Не удалось получить статус обновлений:", error);
  }
  const versionLabel = getVersionLabel();
  const appVersionNode = document.getElementById("app-version");
  if (appVersionNode) appVersionNode.textContent = versionLabel;
  await loadState();
  seedAccessData();
  state.students.forEach((student) => ensureClassExists(student.className));
  saveState();
  setupNav();
  setupClassesHandlers();
  setupStudentHandlers();
  setupGradesHandlers();
  setupScheduleHandlers();
  setupAccessHandlers();
  setupDatabaseSettingsHandlers();
  setupStatusBarHandlers();
  setupPrintHandlers();
  setupAuthHandlers();
}

init().catch((error) => {
  console.error("Init error:", error);
});
