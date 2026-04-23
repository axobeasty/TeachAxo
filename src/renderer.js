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
    localName: "teachaxo.sqlite",
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
  dbRuntimeStatus: {
    mode: "local",
    connected: true,
    interacting: false,
    operation: "",
    message: "SQLite: подключена",
    sqlitePath: "",
    sqliteFileName: "teachaxo.sqlite"
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
    availableVersion: null,
    progress: null
  },
  updatePromptedVersion: null,
  uiConfig: {
    iconPath: ""
  },
  searchQuery: "",
  classSearchQuery: ""
};

const dayOrder = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const VERSION_CHANGELOG = {
  "1.0.22": {
    added: [
      "Гибкий changelog в настройках: категории Добавлено/Изменено/Убрано и история по версиям."
    ],
    changed: [
      "Убрано legacy-хранение через localStorage, сохранение состояния только в выбранной БД.",
      "Переключение источника данных теперь переносит текущее состояние в целевую БД до перезапуска."
    ],
    removed: []
  },
  "1.0.21": {
    added: [
      "Безопасный fallback: при недоступной удаленной БД приложение автоматически переключается на SQLite при запуске."
    ],
    changed: [
      "Стабилизирован старт приложения после смены источника данных.",
      "Проблемный runtime-конфиг БД теперь сохраняется в backup-файл для диагностики."
    ],
    removed: []
  },
  "1.0.20": {
    added: [
      "Новая страница профиля пользователя с редактированием логина и пароля."
    ],
    changed: [
      "Навигация обновлена: добавлен отдельный пункт 'Профиль'."
    ],
    removed: []
  },
  "1.0.19": {
    added: [
      "Расширенные адаптивные сценарии для разных типов экранов (включая ultra-wide и low-height)."
    ],
    changed: [
      "Улучшены сетки, поведение сайдбара, таблиц и форм на узких экранах."
    ],
    removed: []
  },
  "1.0.18": {
    added: [
      "Переключение runtime-хранилища между SQLite и удаленной БД с перезапуском приложения."
    ],
    changed: [
      "Фоновая проверка обновлений оптимизирована (редкий polling, загрузка в фоне, предложение установки)."
    ],
    removed: []
  }
};

function compareSemverDesc(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveCurrentChangelogEntry(version) {
  if (VERSION_CHANGELOG[version]) return VERSION_CHANGELOG[version];
  const sortedVersions = Object.keys(VERSION_CHANGELOG).sort(compareSemverDesc);
  return VERSION_CHANGELOG[sortedVersions[0]] || { added: [], changed: [], removed: [] };
}

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

function notifyUser(message, type = "info") {
  const titleByType = {
    info: "TeachAxo",
    success: "TeachAxo - Успешно",
    warning: "TeachAxo - Внимание",
    error: "TeachAxo - Ошибка"
  };
  const title = titleByType[type] || "TeachAxo";
  window.teachAxo?.notify?.({ title, message: String(message || "") }).catch(() => {});
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
  if (section === "home" || section === "settings" || section === "profile") return true;
  if (section === "access") return hasPermission("manage_roles") || hasPermission("manage_users");
  return hasPermission(SECTION_PERMISSIONS[section] ?? "");
}

function getSectionAccessMessage(section) {
  if (section === "access") {
    return "У вас нет прав на раздел 'Доступ'. Нужны права управления ролями или пользователями.";
  }
  const permission = SECTION_PERMISSIONS[section];
  if (!permission) return "У вас нет прав на открытие этого раздела.";
  return `У вас нет права '${PERMISSIONS[permission] || permission}' для открытия этого раздела.`;
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
    localName: parsed.databaseConfig?.localName || "teachaxo.sqlite",
    remote: {
      host: parsed.databaseConfig?.remote?.host || "",
      port: parsed.databaseConfig?.remote?.port || "3306",
      user: parsed.databaseConfig?.remote?.user || "",
      password: parsed.databaseConfig?.remote?.password || "",
      database: parsed.databaseConfig?.remote?.database || ""
    }
  };
  state.roles = Array.isArray(parsed.roles) ? parsed.roles : [];
  state.users = Array.isArray(parsed.users)
    ? parsed.users.map((user) => ({
        ...user,
        fullName: user?.fullName || "",
        email: user?.email || "",
        phone: user?.phone || ""
      }))
    : [];
  state.currentUserId = parsed.currentUserId ?? null;
  const hasAuthSettings = parsed.auth && typeof parsed.auth === "object";
  state.auth = {
    rememberSession: hasAuthSettings ? Boolean(parsed.auth?.rememberSession) : Boolean(parsed.currentUserId),
    rememberedUserId: hasAuthSettings ? parsed.auth?.rememberedUserId ?? null : parsed.currentUserId ?? null
  };
}

async function loadState() {
  try {
    if (!window.teachAxoDb?.getState || !window.teachAxoDb?.saveState) {
      throw new Error("SQLite API недоступен. Приложение должно работать только через SQLite.");
    }

    const dbState = await window.teachAxoDb.getState();
    if (dbState) {
      applyLoadedState(dbState);
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
      fullName: "Администратор системы",
      email: "",
      phone: "",
      roleId: adminRole.id,
      isSystem: true
    });
  }
}

function activateSection(section, options = {}) {
  const silent = Boolean(options?.silent);
  const allowedTarget = canAccessSection(section);
  if (!allowedTarget && !silent) {
    notifyUser(getSectionAccessMessage(section), "warning");
  }
  const target = canAccessSection(section) ? section : "home";
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    const allowed = canAccessSection(item.dataset.section);
    item.classList.toggle("disabled", !allowed);
    item.setAttribute("aria-disabled", allowed ? "false" : "true");
  });
  document.querySelectorAll(".section").forEach((panel) => panel.classList.remove("active"));
  const activeNav = document.querySelector(`.nav-item[data-section="${target}"]`);
  const activePanel = document.querySelector(`[data-section-panel="${target}"]`);
  if (activeNav) activeNav.classList.add("active");
  if (activePanel) activePanel.classList.add("active");
}

function applyAccessControl() {
  document.querySelectorAll(".quick-nav-button").forEach((button) => {
    const allowed = canAccessSection(button.dataset.goSection);
    button.classList.toggle("disabled", !allowed);
    button.disabled = !allowed;
    button.title = allowed ? "" : getSectionAccessMessage(button.dataset.goSection);
  });
  document.getElementById("print-class-list").classList.toggle("hidden", !hasPermission("print_data"));
  document.getElementById("print-schedule").classList.toggle("hidden", !hasPermission("print_data"));
}

function setupNav() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const section = item.dataset.section;
      if (!canAccessSection(section)) {
        notifyUser(getSectionAccessMessage(section), "warning");
        return;
      }
      activateSection(section, { silent: true });
    });
  });
  document.querySelectorAll(".quick-nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.goSection;
      if (!canAccessSection(section)) {
        notifyUser(getSectionAccessMessage(section), "warning");
        return;
      }
      activateSection(section, { silent: true });
    });
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

  const currentVersionKey = normalizeVersionValue(state.appMeta.appVersion, "0.0.0");
  const currentChangeEntry = resolveCurrentChangelogEntry(currentVersionKey);
  const renderCategory = (items) =>
    items.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>—</li>";

  document.getElementById("current-version-added").innerHTML = renderCategory(currentChangeEntry.added);
  document.getElementById("current-version-changed").innerHTML = renderCategory(currentChangeEntry.changed);
  document.getElementById("current-version-removed").innerHTML = renderCategory(currentChangeEntry.removed);

  const sortedVersions = Object.keys(VERSION_CHANGELOG).sort(compareSemverDesc);
  document.getElementById("version-history-log").innerHTML = sortedVersions
    .map((version) => {
      const entry = VERSION_CHANGELOG[version];
      const added = entry.added.length ? `<li><strong>Добавлено:</strong> ${escapeHtml(entry.added.join("; "))}</li>` : "";
      const changed = entry.changed.length ? `<li><strong>Изменено:</strong> ${escapeHtml(entry.changed.join("; "))}</li>` : "";
      const removed = entry.removed.length ? `<li><strong>Убрано:</strong> ${escapeHtml(entry.removed.join("; "))}</li>` : "";
      return `<div class="item">
        <div class="content">
          <div class="header">Версия ${escapeHtml(version)}</div>
          <ul class="ui list">${added}${changed}${removed}</ul>
        </div>
      </div>`;
    })
    .join("");

  document.getElementById("database-mode").value = state.databaseConfig.mode;
  document.getElementById("database-local-name").value = state.databaseConfig.localName;
  document.getElementById("database-remote-host").value = state.databaseConfig.remote.host;
  document.getElementById("database-remote-port").value = state.databaseConfig.remote.port;
  document.getElementById("database-remote-user").value = state.databaseConfig.remote.user;
  document.getElementById("database-remote-password").value = state.databaseConfig.remote.password;
  document.getElementById("database-remote-name").value = state.databaseConfig.remote.database;
  const iconPathInput = document.getElementById("app-icon-path");
  if (iconPathInput) iconPathInput.value = state.uiConfig.iconPath || "";

  const isRemote = state.databaseConfig.mode === "remote";
  document.getElementById("database-local-fields").classList.toggle("hidden", isRemote);
  document.getElementById("database-remote-fields").classList.toggle("hidden", !isRemote);
}

function renderProfilePage() {
  const currentUser = getCurrentUser();
  const currentRole = currentUser ? getRole(currentUser.roleId) : null;
  document.getElementById("profile-current-username").textContent = currentUser?.username || "-";
  document.getElementById("profile-current-role").textContent = currentRole?.name || "Без роли";
  const fullNameNode = document.getElementById("profile-current-fullname");
  const emailNode = document.getElementById("profile-current-email");
  const phoneNode = document.getElementById("profile-current-phone");
  if (fullNameNode) fullNameNode.textContent = currentUser?.fullName || "-";
  if (emailNode) emailNode.textContent = currentUser?.email || "-";
  if (phoneNode) phoneNode.textContent = currentUser?.phone || "-";

  const usernameInput = document.getElementById("profile-new-username");
  if (usernameInput && currentUser) {
    usernameInput.placeholder = `Текущий: ${currentUser.username}`;
  }
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
        <td>${escapeHtml(user.fullName || "-")}</td>
        <td>${escapeHtml(user.email || "-")}</td>
        <td>${escapeHtml(user.phone || "-")}</td>
        <td>${escapeHtml(role?.name || "Без роли")}</td>
        <td><button class="ui mini red button" data-delete-user="${user.id}">Удалить</button></td>
      </tr>`;
    })
    .join("");
}

function renderStatusBar() {
  const dbProvider = String(state.storageInfo.provider || "sqlite").toLowerCase();
  const dbPath = state.storageInfo.sqlitePath || "-";
  const dbNameNode = document.getElementById("statusbar-db-name");
  const dbStateNode = document.getElementById("statusbar-db-state");
  if (dbNameNode) {
    const fileName = state.dbRuntimeStatus.sqliteFileName || (dbPath !== "-" ? dbPath.split(/[\\/]/).pop() : "teachaxo.sqlite");
    dbNameNode.textContent = fileName;
    const isLocal = dbProvider === "sqlite" || state.dbRuntimeStatus.mode === "local";
    dbNameNode.disabled = !isLocal;
    dbNameNode.title = isLocal ? "Открыть папку с базой данных" : "Для удаленной БД открытие файла недоступно";
  }
  if (dbStateNode) {
    const prefix = dbProvider === "mysql" || state.dbRuntimeStatus.mode === "remote" ? "Remote DB" : "SQLite";
    const connection = state.dbRuntimeStatus.connected ? "подключена" : "нет подключения";
    const activity = state.dbRuntimeStatus.interacting
      ? ` • выполняется: ${state.dbRuntimeStatus.operation || "операция"}`
      : "";
    dbStateNode.textContent = `${prefix}: ${connection}${activity}`;
  }

  const updateStateNode = document.getElementById("statusbar-update-state");
  if (updateStateNode) {
    updateStateNode.textContent = state.runtimeUpdate.message || "Проверка обновлений не выполнялась.";
  }

  const progressWrap = document.getElementById("statusbar-download-progress");
  const progressFill = document.getElementById("statusbar-download-progress-fill");
  if (progressWrap && progressFill) {
    const isDownloading = state.runtimeUpdate.state === "downloading";
    const progressValue = Math.max(0, Math.min(100, Math.round(Number(state.runtimeUpdate.progress || 0))));
    progressWrap.classList.toggle("hidden", !isDownloading);
    progressFill.style.width = `${progressValue}%`;
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
  renderProfilePage();
  renderSettingsPage();
  renderRoles();
  renderUsers();
  renderStatusBar();
  applyAccessControl();
}

function setupProfileHandlers() {
  const form = document.getElementById("profile-form");
  const status = document.getElementById("profile-form-status");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (!currentUser) {
      status.textContent = "Сессия пользователя не найдена.";
      status.className = "ui tiny red message";
      return;
    }

    const newUsername = document.getElementById("profile-new-username").value.trim();
    const newPassword = document.getElementById("profile-new-password").value;
    const confirmPassword = document.getElementById("profile-confirm-password").value;

    if (!newUsername && !newPassword) {
      status.textContent = "Укажите новый логин или пароль.";
      status.className = "ui tiny red message";
      return;
    }

    if (newUsername) {
      const duplicate = state.users.some(
        (user) => user.id !== currentUser.id && user.username.toLowerCase() === newUsername.toLowerCase()
      );
      if (duplicate) {
        status.textContent = "Пользователь с таким логином уже существует.";
        status.className = "ui tiny red message";
        return;
      }
      currentUser.username = newUsername;
    }

    if (newPassword) {
      if (newPassword.length < 4) {
        status.textContent = "Новый пароль должен быть не короче 4 символов.";
        status.className = "ui tiny red message";
        return;
      }
      if (newPassword !== confirmPassword) {
        status.textContent = "Подтверждение пароля не совпадает.";
        status.className = "ui tiny red message";
        return;
      }
      currentUser.password = newPassword;
    }

    saveState();
    form.reset();
    status.textContent = "Профиль успешно обновлен.";
    status.className = "ui tiny positive message";
    notifyUser("Профиль успешно обновлен.", "success");
    renderAll();
  });
}

function requirePermission(permission) {
  if (hasPermission(permission)) return true;
  notifyUser("Недостаточно прав для этого действия.", "warning");
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
      notifyUser("Такой класс уже есть.", "warning");
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
      notifyUser("Нельзя удалить класс, пока в нем есть ученики.", "warning");
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
      notifyUser("Проверьте настройки расписания.", "warning");
      return;
    }
    state.scheduleSettings = { firstLessonStart, lessonDurationMin };
    saveState();
    applyCalculatedTime();
    notifyUser("Настройки конструктора расписания сохранены.", "success");
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
      notifyUser("Заполните день, номер урока, класс и предмет.", "warning");
      return;
    }
    if (start >= end) {
      notifyUser("Время начала должно быть раньше времени окончания.", "warning");
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
      notifyUser("Роль с таким названием уже существует.", "warning");
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
      notifyUser("Системную роль удалить нельзя.", "warning");
      return;
    }
    if (state.users.some((user) => user.roleId === roleId)) {
      notifyUser("Нельзя удалить роль, пока она назначена пользователям.", "warning");
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
    const fullName = document.getElementById("user-fullname").value.trim();
    const email = document.getElementById("user-email").value.trim();
    const phone = document.getElementById("user-phone").value.trim();
    const roleId = document.getElementById("user-role").value;
    if (!username || !password || !roleId || !fullName) {
      notifyUser("Заполните логин, пароль, ФИО и роль.", "warning");
      return;
    }
    if (password.length < 4) {
      notifyUser("Пароль должен быть не короче 4 символов.", "warning");
      return;
    }
    if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      notifyUser("Пользователь с таким логином уже существует.", "warning");
      return;
    }
    state.users.push({ id: uid(), username, password, fullName, email, phone, roleId, isSystem: false });
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
      notifyUser("Нельзя удалить текущего пользователя.", "warning");
      return;
    }
    if (user.isSystem) {
      notifyUser("Системного пользователя удалить нельзя.", "warning");
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
    const localName = document.getElementById("database-local-name").value.trim() || "teachaxo.sqlite";
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
      notifyUser(status.textContent, "warning");
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
      await window.teachAxoDb.applyRuntimeConfig({ mode, localName, remote });
    } catch (error) {
      status.textContent = `Ошибка применения настроек БД: ${error.message}`;
      status.className = "ui tiny red message";
      notifyUser(status.textContent, "error");
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
      notifyUser(status.textContent, "success");
    } catch (error) {
      status.textContent = `Ошибка подключения: ${error.message}`;
      status.className = "ui tiny red message";
      notifyUser(status.textContent, "error");
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
      notifyUser(status.textContent, "success");
    } catch (error) {
      status.textContent = `Ошибка миграции: ${error.message}`;
      status.className = "ui tiny red message";
      notifyUser(status.textContent, "error");
    }
  });
}

function setupAppAppearanceHandlers() {
  const form = document.getElementById("app-appearance-form");
  const browseBtn = document.getElementById("app-icon-browse");
  const pathInput = document.getElementById("app-icon-path");
  const status = document.getElementById("app-appearance-status");
  if (!form || !browseBtn || !pathInput || !status) return;

  browseBtn.addEventListener("click", async () => {
    try {
      const result = await window.teachAxo?.pickIcon?.();
      if (!result?.ok || result?.canceled) return;
      pathInput.value = result.path || "";
      state.uiConfig.iconPath = result.path || "";
    } catch (error) {
      status.textContent = `Не удалось выбрать файл иконки: ${error.message}`;
      status.className = "ui tiny red message";
      notifyUser(status.textContent, "error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const iconPath = String(pathInput.value || "").trim();
    try {
      await window.teachAxo?.applyUiConfig?.({ iconPath });
      state.uiConfig.iconPath = iconPath;
      status.textContent = "Иконка приложения обновлена.";
      status.className = "ui tiny positive message";
      notifyUser("Иконка приложения обновлена.", "success");
    } catch (error) {
      status.textContent = `Ошибка применения иконки: ${error.message}`;
      status.className = "ui tiny red message";
      notifyUser(status.textContent, "error");
    }
  });
}

function setupStatusBarHandlers() {
  const checkButton = document.getElementById("statusbar-check-updates");
  const installButton = document.getElementById("statusbar-install-update");
  const dbNameButton = document.getElementById("statusbar-db-name");

  const applyUpdateStatus = (payload) => {
    state.runtimeUpdate = {
      state: payload?.state || "idle",
      message: payload?.message || "Проверка обновлений не выполнялась.",
      availableVersion: payload?.availableVersion || null,
      progress: typeof payload?.progress === "number" ? payload.progress : null
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

  const applyDbStatus = (payload) => {
    if (!payload || typeof payload !== "object") return;
    state.dbRuntimeStatus = {
      mode: payload.mode || "local",
      connected: payload.connected !== false,
      interacting: Boolean(payload.interacting),
      operation: payload.operation || "",
      message: payload.message || "",
      sqlitePath: payload.sqlitePath || state.storageInfo.sqlitePath || "",
      sqliteFileName: payload.sqliteFileName || "teachaxo.sqlite"
    };
    renderStatusBar();
  };

  if (window.teachAxoDb?.onStatus) {
    window.teachAxoDb.onStatus((payload) => applyDbStatus(payload));
  }

  window.teachAxoDb?.getStatus?.().then((payload) => applyDbStatus(payload)).catch(() => {});

  if (dbNameButton) {
    dbNameButton.addEventListener("click", async () => {
      const isLocal = String(state.storageInfo.provider || "sqlite").toLowerCase() === "sqlite" || state.dbRuntimeStatus.mode === "local";
      if (!isLocal || !window.teachAxoDb?.openSqliteLocation) return;
      try {
        await window.teachAxoDb.openSqliteLocation();
      } catch (error) {
        notifyUser(`Не удалось открыть папку базы данных: ${error.message}`, "error");
      }
    });
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

function setupWindowControls() {
  const minimizeBtn = document.getElementById("window-minimize");
  const maximizeBtn = document.getElementById("window-maximize");
  const closeBtn = document.getElementById("window-close");

  const updateMaximizeIcon = (isMaximized) => {
    if (!maximizeBtn) return;
    maximizeBtn.textContent = isMaximized ? "❐" : "□";
    maximizeBtn.title = isMaximized ? "Восстановить" : "Развернуть";
  };

  window.teachAxo?.isWindowMaximized?.()
    .then((payload) => updateMaximizeIcon(Boolean(payload?.isMaximized)))
    .catch(() => {});

  if (window.teachAxo?.onWindowState) {
    window.teachAxo.onWindowState((payload) => {
      updateMaximizeIcon(Boolean(payload?.isMaximized));
    });
  }

  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", () => {
      window.teachAxo?.minimizeWindow?.().catch(() => {});
    });
  }

  if (maximizeBtn) {
    maximizeBtn.addEventListener("click", async () => {
      try {
        const response = await window.teachAxo?.toggleMaximizeWindow?.();
        updateMaximizeIcon(Boolean(response?.isMaximized));
      } catch (_error) {}
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.teachAxo?.closeWindow?.().catch(() => {});
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
    activateSection("home", { silent: true });
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
        availableVersion: updateStatus.availableVersion || null,
        progress: typeof updateStatus.progress === "number" ? updateStatus.progress : null
      };
    }
  } catch (error) {
    console.warn("Не удалось получить статус обновлений:", error);
  }
  try {
    const uiConfig = await window.teachAxo?.getUiConfig?.();
    if (uiConfig && typeof uiConfig === "object") {
      state.uiConfig.iconPath = String(uiConfig.iconPath || "");
    }
  } catch (error) {
    console.warn("Не удалось получить UI-конфиг:", error);
  }
  const versionLabel = getVersionLabel();
  const appVersionNode = document.getElementById("app-version");
  if (appVersionNode) appVersionNode.textContent = versionLabel;
  await loadState();
  seedAccessData();
  state.students.forEach((student) => ensureClassExists(student.className));
  saveState();
  setupNav();
  setupWindowControls();
  setupClassesHandlers();
  setupStudentHandlers();
  setupGradesHandlers();
  setupScheduleHandlers();
  setupAccessHandlers();
  setupProfileHandlers();
  setupDatabaseSettingsHandlers();
  setupAppAppearanceHandlers();
  setupStatusBarHandlers();
  setupPrintHandlers();
  setupAuthHandlers();
}

init().catch((error) => {
  console.error("Init error:", error);
});
