const PERMISSIONS = {
  view_dashboard: "Просмотр дашборда",
  manage_classes: "Управление классами",
  manage_students: "Управление учениками",
  manage_grades: "Управление оценками",
  manage_schedule: "Управление расписанием",
  print_data: "Печать данных",
  manage_roles: "Управление ролями",
  manage_users: "Управление пользователями",
  access_profile: "Раздел «Профиль»",
  edit_profile: "Редактирование своего профиля",
  access_settings: "Раздел «Настройки»",
  view_app_info: "Сведения о версии и журнал изменений",
  manage_database: "Настройка базы данных и миграция",
  manage_appearance: "Внешний вид приложения (тема и иконка)",
  manage_updates: "Проверка и установка обновлений"
};

const SECTION_PERMISSIONS = {
  home: "view_dashboard",
  classes: "manage_classes",
  students: "manage_students",
  grades: "manage_grades",
  schedule: "manage_schedule",
  profile: "access_profile",
  settings: "access_settings"
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
    iconPath: "",
    theme: "system"
  },
  searchQuery: "",
  classSearchQuery: ""
};

const THEME_PREFS = ["light", "dark", "system"];

function normalizeThemePreference(value) {
  const v = String(value || "").toLowerCase();
  return THEME_PREFS.includes(v) ? v : "system";
}

function resolveDisplayTheme(preference) {
  if (normalizeThemePreference(preference) === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return normalizeThemePreference(preference) === "dark" ? "dark" : "light";
}

function applyDisplayTheme(display) {
  document.documentElement.setAttribute("data-theme", display);
}

function syncThemeFromPreference(preference) {
  applyDisplayTheme(resolveDisplayTheme(preference));
}

let themeColorSchemeListener = null;

function bindSystemThemeListener() {
  if (themeColorSchemeListener) {
    themeColorSchemeListener.mq.removeEventListener("change", themeColorSchemeListener.fn);
    themeColorSchemeListener = null;
  }
  if (normalizeThemePreference(state.uiConfig.theme) !== "system") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => syncThemeFromPreference(state.uiConfig.theme);
  mq.addEventListener("change", fn);
  themeColorSchemeListener = { mq, fn };
}

function setUserThemePreference(pref) {
  state.uiConfig.theme = normalizeThemePreference(pref);
  syncThemeFromPreference(state.uiConfig.theme);
  bindSystemThemeListener();
}

const dayOrder = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const VERSION_CHANGELOG = {
  "1.0.36": {
    added: [],
    changed: [
      "Окно проверки обновлений использует ту же тему, что и приложение (светлая, тёмная или системная), в том числе после смены настроек."
    ],
    removed: []
  },
  "1.0.35": {
    added: [],
    changed: [
      "Тёмная тема: единая палитра, убраны светлые фоны у таблиц, форм, сегментов и сообщений Semantic UI; аккуратные скроллбары и экран входа.",
      "Дашборд в тёмной теме: приглушённые цвета иконок метрик."
    ],
    removed: []
  },
  "1.0.34": {
    added: [
      "История изменений по версиям в настройках: каждая версия в сворачиваемом блоке (спойлер)."
    ],
    changed: [
      "Вёрстка раздела настроек: перенос длинных строк, путей к БД и поля выбора иконки без выхода за границы."
    ],
    removed: []
  },
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
  if (section === "access") return hasPermission("manage_roles") || hasPermission("manage_users");
  const permission = SECTION_PERMISSIONS[section];
  if (!permission) return false;
  return hasPermission(permission);
}

function getDefaultSection() {
  const order = ["home", "classes", "students", "grades", "schedule", "access", "profile", "settings"];
  for (const id of order) {
    if (canAccessSection(id)) return id;
  }
  return null;
}

function getSectionAccessMessage(section) {
  if (section === "access") {
    return "У вас нет прав на раздел «Доступ». Нужны права «Управление ролями» или «Управление пользователями».";
  }
  const permission = SECTION_PERMISSIONS[section];
  if (!permission) return "У вас нет прав на открытие этого раздела.";
  return `У вас нет права «${PERMISSIONS[permission] || permission}» для открытия этого раздела.`;
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
      permissions: [...Object.keys(PERMISSIONS)],
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

function syncAdministratorPermissions() {
  const admin = state.roles.find((r) => r.isSystem && r.name === "Администратор");
  if (!admin || !Array.isArray(admin.permissions)) return;
  const all = Object.keys(PERMISSIONS);
  if (all.every((p) => admin.permissions.includes(p))) return;
  admin.permissions = [...all];
  saveState();
}

function activateSection(section, options = {}) {
  const silent = Boolean(options?.silent);
  const allowedTarget = canAccessSection(section);
  if (!allowedTarget && !silent) {
    notifyUser(getSectionAccessMessage(section), "warning");
  }
  const fallback = getDefaultSection();
  const target = allowedTarget ? section : fallback !== null ? fallback : "home";
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
  const printClassBtn = document.getElementById("print-class-list");
  const printScheduleBtn = document.getElementById("print-schedule");
  if (printClassBtn) printClassBtn.classList.toggle("hidden", !hasPermission("print_data"));
  if (printScheduleBtn) printScheduleBtn.classList.toggle("hidden", !hasPermission("print_data"));

  const rolesCol = document.getElementById("access-roles-column");
  const usersCol = document.getElementById("access-users-column");
  if (rolesCol) rolesCol.classList.toggle("hidden", !hasPermission("manage_roles"));
  if (usersCol) usersCol.classList.toggle("hidden", !hasPermission("manage_users"));

  const overview = document.getElementById("settings-overview-section");
  const dbSeg = document.getElementById("settings-database-segment");
  const appSeg = document.getElementById("settings-appearance-segment");
  const changelogWrap = document.getElementById("settings-changelog-blocks");
  if (overview) overview.classList.toggle("hidden", !hasPermission("view_app_info"));
  if (dbSeg) dbSeg.classList.toggle("hidden", !hasPermission("manage_database"));
  if (appSeg) appSeg.classList.toggle("hidden", !hasPermission("manage_appearance"));
  if (changelogWrap) changelogWrap.classList.toggle("hidden", !hasPermission("view_app_info"));

  const settingsHint = document.getElementById("settings-empty-hint");
  if (settingsHint) {
    const anySettingsBlock =
      hasPermission("view_app_info") ||
      hasPermission("manage_database") ||
      hasPermission("manage_appearance");
    const showHint = hasPermission("access_settings") && !anySettingsBlock;
    settingsHint.classList.toggle("hidden", !showHint);
  }

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    const canEdit = hasPermission("edit_profile");
    profileForm.querySelectorAll("input,button").forEach((el) => {
      if (el.type === "submit") {
        el.disabled = !canEdit;
      } else {
        el.disabled = !canEdit;
      }
    });
    profileForm.title = canEdit ? "" : "Нет права «Редактирование своего профиля».";
  }
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
        <td class="schedule-td-actions">
          <div class="schedule-row-actions">
            <button type="button" class="ui mini red button" data-delete-schedule="${entry.id}">Удалить</button>
          </div>
        </td>
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

  const versionLine = document.querySelector(".home-version-line");
  if (versionLine) versionLine.classList.toggle("hidden", !hasPermission("view_app_info"));

  const sorted = [...getCurrentUserScheduleEntries()].sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
  });
  const nextLessons = sorted.slice(0, 5);
  const nextLessonsContainer = document.getElementById("home-next-lessons");

  if (nextLessons.length === 0) {
    nextLessonsContainer.innerHTML = `<div class="dashboard-empty">Пока нет уроков в расписании. Добавьте слоты в разделе «Расписание».</div>`;
    return;
  }

  nextLessonsContainer.innerHTML = nextLessons
    .map(
      (entry, index) => `<article class="home-next-lesson dashboard-next-item">
      <span class="dashboard-next-index" aria-hidden="true">${index + 1}</span>
      <div class="dashboard-next-body">
        <div class="title">${escapeHtml(entry.day)} · ${escapeHtml(entry.start)}–${escapeHtml(entry.end)}</div>
        <div class="dashboard-next-subject">${escapeHtml(entry.subject)} <span class="dashboard-next-class">(${escapeHtml(entry.className)})</span></div>
        <div class="meta">Кабинет: ${escapeHtml(entry.room || "-")}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""}</div>
      </div>
    </article>`
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
  const expandedHistoryVersionKey = VERSION_CHANGELOG[currentVersionKey]
    ? currentVersionKey
    : sortedVersions[0];
  const renderHistorySection = (title, items) => {
    if (!items.length) return "";
    const lis = items.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    return `<div class="changelog-history-block">
      <div class="changelog-history-title">${escapeHtml(title)}</div>
      <ul class="changelog-history-list">${lis}</ul>
    </div>`;
  };
  document.getElementById("version-history-log").innerHTML = sortedVersions
    .map((version) => {
      const entry = VERSION_CHANGELOG[version];
      const blocks = [
        renderHistorySection("Добавлено", entry.added),
        renderHistorySection("Изменено", entry.changed),
        renderHistorySection("Убрано", entry.removed),
      ]
        .filter(Boolean)
        .join("");
      const body = blocks || '<p class="changelog-history-empty">Нет записей.</p>';
      const openAttr = version === expandedHistoryVersionKey ? " open" : "";
      return `<details class="settings-changelog-version"${openAttr}>
        <summary class="settings-changelog-summary">Версия ${escapeHtml(version)}</summary>
        <div class="settings-changelog-body">${body}</div>
      </details>`;
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
  const themeSelect = document.getElementById("theme-mode-select");
  if (themeSelect) themeSelect.value = normalizeThemePreference(state.uiConfig.theme);

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

function clearRoleForm() {
  const form = document.getElementById("role-form");
  const hidden = document.getElementById("role-editing-id");
  const cancelBtn = document.getElementById("role-form-cancel");
  const submitBtn = document.getElementById("role-form-submit");
  const nameInput = document.getElementById("role-name");
  if (hidden) hidden.value = "";
  if (form) form.reset();
  document.querySelectorAll(".role-permission").forEach((el) => {
    el.checked = false;
  });
  if (nameInput) {
    nameInput.removeAttribute("readonly");
    nameInput.disabled = false;
  }
  if (submitBtn) submitBtn.textContent = "Создать роль";
  if (cancelBtn) cancelBtn.classList.add("hidden");
}

function fillRoleForm(role) {
  if (!role) return;
  const hidden = document.getElementById("role-editing-id");
  const nameInput = document.getElementById("role-name");
  const cancelBtn = document.getElementById("role-form-cancel");
  const submitBtn = document.getElementById("role-form-submit");
  if (hidden) hidden.value = role.id;
  if (nameInput) nameInput.value = role.name;
  document.querySelectorAll(".role-permission").forEach((el) => {
    el.checked = Array.isArray(role.permissions) && role.permissions.includes(el.value);
  });
  if (nameInput) {
    if (role.isSystem) {
      nameInput.setAttribute("readonly", "readonly");
    } else {
      nameInput.removeAttribute("readonly");
    }
  }
  if (submitBtn) submitBtn.textContent = "Сохранить изменения";
  if (cancelBtn) cancelBtn.classList.remove("hidden");
}

function renderRoles() {
  const tbody = document.getElementById("roles-table-body");
  tbody.innerHTML = state.roles
    .map((role) => `<tr>
      <td class="access-role-name-cell">${escapeHtml(role.name)}${role.isSystem ? " <span class=\"ui mini label\">системная</span>" : ""}</td>
      <td class="access-role-perms-cell">${role.permissions.map((p) => escapeHtml(PERMISSIONS[p] || p)).join(", ") || "-"}</td>
      <td class="access-td-actions">
        <div class="access-row-actions">
          <button type="button" class="ui mini button" data-edit-role="${role.id}">Изменить</button>
          <button type="button" class="ui mini red button" data-delete-role="${role.id}">Удалить</button>
        </div>
      </td>
    </tr>`)
    .join("");

  const editingId = document.getElementById("role-editing-id")?.value;
  if (editingId && !state.roles.some((r) => r.id === editingId)) {
    clearRoleForm();
  }
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
        <td class="access-td-actions">
          <div class="access-row-actions">
            <button type="button" class="ui mini red button" data-delete-user="${user.id}">Удалить</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderStatusBar() {
  const dbProvider = String(state.storageInfo.provider || "sqlite").toLowerCase();
  const dbPath = state.storageInfo.sqlitePath || "-";
  const dbNameNode = document.getElementById("statusbar-db-name");
  const dbStateNode = document.getElementById("statusbar-db-state");
  const canDbFolder = hasPermission("manage_database");
  const isLocalDb = dbProvider === "sqlite" || state.dbRuntimeStatus.mode === "local";
  if (dbNameNode) {
    const fileName = state.dbRuntimeStatus.sqliteFileName || (dbPath !== "-" ? dbPath.split(/[\\/]/).pop() : "teachaxo.sqlite");
    dbNameNode.textContent = fileName;
    dbNameNode.disabled = !isLocalDb || !canDbFolder;
    dbNameNode.title = !isLocalDb
      ? "Для удаленной БД открытие файла недоступно"
      : canDbFolder
        ? "Открыть папку с базой данных"
        : "Нет права «Настройка базы данных и миграция».";
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
    const canUpdates = hasPermission("manage_updates");
    installButton.classList.toggle("hidden", !hasUpdate || !canUpdates);
    if (hasUpdate) {
      installButton.textContent =
        state.runtimeUpdate.state === "downloaded"
          ? `Установить ${state.runtimeUpdate.availableVersion}`
          : `Обновить до ${state.runtimeUpdate.availableVersion}`;
    } else {
      installButton.textContent = "Обновить";
    }
    installButton.disabled = !canUpdates;
  }

  const checkButton = document.getElementById("statusbar-check-updates");
  const canUpdates = hasPermission("manage_updates");
  if (checkButton) {
    checkButton.disabled = !canUpdates;
    checkButton.classList.toggle("disabled", !canUpdates);
    checkButton.title = canUpdates ? "" : "Нет права «Проверка и установка обновлений».";
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
    if (!requirePermission("edit_profile")) return;
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
  notifyUser(`Недостаточно прав. Нужно право «${PERMISSIONS[permission] || permission}».`, "warning");
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
  document.getElementById("role-form-cancel").addEventListener("click", () => {
    if (!hasPermission("manage_roles")) return;
    clearRoleForm();
  });

  document.getElementById("role-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_roles")) return;
    const editingId = document.getElementById("role-editing-id").value.trim();
    const roleNameRaw = document.getElementById("role-name").value.trim();
    const permissions = [...document.querySelectorAll(".role-permission:checked")].map((el) => el.value);

    if (editingId) {
      const role = getRole(editingId);
      if (!role) {
        clearRoleForm();
        return;
      }
      const newName = role.isSystem ? role.name : roleNameRaw;
      if (!newName) {
        notifyUser("Укажите название роли.", "warning");
        return;
      }
      if (!role.isSystem) {
        if (state.roles.some((r) => r.id !== editingId && r.name.toLowerCase() === roleNameRaw.toLowerCase())) {
          notifyUser("Роль с таким названием уже существует.", "warning");
          return;
        }
        role.name = roleNameRaw;
      }
      role.permissions = permissions;
      saveState();
      clearRoleForm();
      renderAll();
      notifyUser("Роль сохранена.", "success");
      return;
    }

    if (!roleNameRaw) return;
    if (state.roles.some((role) => role.name.toLowerCase() === roleNameRaw.toLowerCase())) {
      notifyUser("Роль с таким названием уже существует.", "warning");
      return;
    }
    state.roles.push({ id: uid(), name: roleNameRaw, permissions, isSystem: false });
    clearRoleForm();
    saveState();
    renderAll();
  });

  document.getElementById("roles-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_roles")) return;
    const editId = event.target.dataset.editRole;
    if (editId) {
      const role = getRole(editId);
      if (role) fillRoleForm(role);
      return;
    }
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
    if (!requirePermission("manage_database")) return;
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
    if (!requirePermission("manage_database")) return;
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
    if (!requirePermission("manage_database")) return;
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
  const themeSelect = document.getElementById("theme-mode-select");
  if (themeSelect) {
    themeSelect.addEventListener("change", async () => {
      if (!hasPermission("manage_appearance")) {
        themeSelect.value = normalizeThemePreference(state.uiConfig.theme);
        notifyUser(`Недостаточно прав. Нужно право «${PERMISSIONS.manage_appearance}».`, "warning");
        return;
      }
      const theme = normalizeThemePreference(themeSelect.value);
      setUserThemePreference(theme);
      try {
        await window.teachAxo?.applyUiConfig?.({ iconPath: state.uiConfig.iconPath, theme });
        notifyUser("Тема оформления сохранена.", "success");
      } catch (error) {
        notifyUser(`Не удалось сохранить тему: ${error.message}`, "error");
      }
    });
  }

  const form = document.getElementById("app-appearance-form");
  const browseBtn = document.getElementById("app-icon-browse");
  const pathInput = document.getElementById("app-icon-path");
  const status = document.getElementById("app-appearance-status");
  if (!form || !browseBtn || !pathInput || !status) return;

  browseBtn.addEventListener("click", async () => {
    if (!requirePermission("manage_appearance")) return;
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
    if (!requirePermission("manage_appearance")) return;
    const iconPath = String(pathInput.value || "").trim();
    try {
      await window.teachAxo?.applyUiConfig?.({ iconPath, theme: state.uiConfig.theme });
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
      hasPermission("manage_updates") &&
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
      if (!requirePermission("manage_database")) return;
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
      if (!requirePermission("manage_updates")) return;
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
      if (!requirePermission("manage_updates")) return;
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
    const initial = getDefaultSection() ?? "home";
    activateSection(initial, { silent: true });
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
      state.uiConfig.theme = normalizeThemePreference(uiConfig.theme);
    }
    syncThemeFromPreference(state.uiConfig.theme);
    bindSystemThemeListener();
  } catch (error) {
    console.warn("Не удалось получить UI-конфиг:", error);
    syncThemeFromPreference(state.uiConfig.theme);
    bindSystemThemeListener();
  }
  const versionLabel = getVersionLabel();
  const appVersionNode = document.getElementById("app-version");
  if (appVersionNode) appVersionNode.textContent = versionLabel;
  await loadState();
  seedAccessData();
  syncAdministratorPermissions();
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
