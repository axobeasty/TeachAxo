const PERMISSIONS = {
  view_dashboard: "Просмотр дашборда",
  manage_classes: "Управление классами",
  manage_students: "Управление учениками",
  manage_grades: "Управление оценками",
  manage_schedule: "Управление расписанием",
  manage_computers: "Управление компьютерами учеников",
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
  subjects: "manage_schedule",
  grades: "manage_grades",
  schedule: "manage_schedule",
  computers: "manage_computers",
  "shared-folders": "manage_computers",
  profile: "access_profile",
  settings: "access_settings"
};

const state = {
  classes: [],
  subjects: [],
  students: [],
  grades: [],
  schedule: [],
  studentComputers: [],
  computerCommandLog: [],
  scheduleSettings: {
    firstLessonStart: "08:00",
    lessonDurationMin: 45,
    breakDurationMin: 10
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
  studentsModalClass: "",
  studentComputersModalId: "",
  searchQuery: "",
  classSearchQuery: "",
  studentComputersNumberFilter: "",
  connectedComputers: [],
  computerServerPort: 46811,
  gradesJournalClass: "",
  gradesJournalDateMode: "week",
  gradesJournalExtraDates: [],
  sharedFoldersShowAll: false
};

const THEME_PREFS = ["light", "dark", "system"];
const COMPUTERS_BACKUP_KEY = "teachaxo.studentComputers.backup.v1";
let sharedFolderSyncTimer = null;
let lastSharedFolderHash = "";
const sharedFolderSyncedByComputer = new Map();

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

function getActiveThemeForUi() {
  return resolveDisplayTheme(state.uiConfig.theme);
}

function updateThemeToggleButton() {
  const button = document.getElementById("theme-toggle-button");
  if (!button) return;
  const activeTheme = getActiveThemeForUi();
  const isDark = activeTheme === "dark";
  button.innerHTML = isDark
    ? '<i class="sun icon"></i> Светлая тема'
    : '<i class="moon icon"></i> Тёмная тема';
}

const dayOrder = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

function getDashboardScheduleEntries() {
  return getCurrentUserScheduleEntries();
}
const VERSION_CHANGELOG = {
  "1.0.72": {
    added: [
      "Раздел «Компьютеры» переработан: таблица заменена на карточки в grid с цветовой индикацией статуса подключения."
    ],
    changed: [
      "Добавлено модальное окно компьютера с полным описанием и полным набором команд удаленного управления."
    ],
    removed: []
  },
  "1.0.70": {
    added: [
      "Для агента добавлены защищенные настройки с первичной установкой пароля и отдельным релиз-каналом автообновления."
    ],
    changed: [
      "Оптимизирована задержка удаленного просмотра/управления: ускорена передача кадров и улучшена индикация статуса в трее агента."
    ],
    removed: []
  },
  "1.0.69": {
    added: [],
    changed: [
      "Исправлена стабильность удаленного просмотра/управления: увеличен буфер передачи кадров и уточнены сообщения диагностики."
    ],
    removed: []
  },
  "1.0.68": {
    added: [],
    changed: [
      "Исправлена передача кадров экрана: улучшена диагностика ошибок в окне просмотра/управления при недоступном кадре."
    ],
    removed: []
  },
  "1.0.67": {
    added: [],
    changed: [
      "Повышена надежность хранения раздела «Компьютеры»: добавлен локальный резервный бэкап и автовосстановление после перезапуска."
    ],
    removed: []
  },
  "1.0.66": {
    added: [
      "Удаленное управление и просмотр экрана переведены в отдельные окна с live-потоком экрана подключенного ПК."
    ],
    changed: [
      "Команда «Удаленное управление» теперь передает клики и клавиши с компьютера хоста на подключенный компьютер."
    ],
    removed: []
  },
  "1.0.65": {
    added: [
      "Во вкладке «Компьютеры» добавлена команда «Отключить от управления» с подтверждением действия."
    ],
    changed: [
      "student-agent: реализовано принудительное отключение управления — удаление автозапуска, очистка конфига и завершение агента."
    ],
    removed: []
  },
  "1.0.64": {
    added: [
      "Во вкладке «Компьютеры» добавлена команда «Проверить подключение» для оперативной диагностики связи с агентом."
    ],
    changed: [
      "Агент компьютера теперь возвращает подробный ответ о хосте и платформе при проверке подключения."
    ],
    removed: []
  },
  "1.0.63": {
    added: [
      "Реализовано сетевое подключение компьютеров по номеру устройства через агент-клиент и TCP-сервер внутри TeachAxo."
    ],
    changed: [
      "Вкладка «Компьютеры» переведена с привязки к ученику на привязку к номеру компьютера и показывает онлайн-статус подключений."
    ],
    removed: []
  },
  "1.0.62": {
    added: [
      "Добавлена новая вкладка «Компьютеры» для управления ПК учеников: учет устройств, фильтр по классу и журнал команд."
    ],
    changed: [
      "Добавлено право доступа «Управление компьютерами учеников» с интеграцией в роли и навигацию разделов."
    ],
    removed: []
  },
  "1.0.61": {
    added: [],
    changed: [
      "Стабилизационный релиз: обновлены артефакты сборки и публикации для актуального состояния проекта."
    ],
    removed: []
  },
  "1.0.60": {
    added: [
      "Создана промо-страница проекта для GitHub Pages в стиле интерфейса TeachAxo."
    ],
    changed: [
      "Оценки: возвращен режим отображения дат «Текущая неделя / Все даты» и сохранение выбранного режима."
    ],
    removed: []
  },
  "1.0.59": {
    added: [],
    changed: [
      "Оценки: исправлено формирование дат текущей недели по общему расписанию класса.",
      "Улучшен UX журнала оценок: выделение ячеек, навигация стрелками и ввод оценок с клавиатуры/numpad."
    ],
    removed: []
  },
  "1.0.58": {
    added: [],
    changed: [
      "Оценки: добавлен режим отображения дат «Текущая неделя / Все даты».",
      "Выпадающие списки во всех разделах переведены на Semantic UI dropdown."
    ],
    removed: []
  },
  "1.0.57": {
    added: [],
    changed: [
      "Вкладка «Оценки» упрощена: оставлена выборка только по классу, убрано ручное добавление дат.",
      "Синхронизированы HTML/CSS: удалены устаревшие стили и обновлены тексты под актуальную логику расписания."
    ],
    removed: []
  },
  "1.0.56": {
    added: [],
    changed: [
      "Вкладка «Оценки»: список классов и даты журнала дополнительно учитывают данные из расписания.",
      "Выбор оценки в журнале доступен по ЛКМ через контекстное окно (1–5, Б, Н, очистка)."
    ],
    removed: []
  },
  "1.0.55": {
    added: [],
    changed: [
      "Улучшен UX конструктора расписания: после добавления урока сохраняется выбранный день недели, а номер урока автоматически увеличивается на 1.",
      "Обновлен стиль выпадающих списков по всему приложению, включая оформление открываемого списка опций."
    ],
    removed: []
  },
  "1.0.54": {
    added: [
      "В настройках конструктора расписания добавлена длительность перемены."
    ],
    changed: [
      "При изменении настроек конструктора выполняется перерасчет времени существующих уроков.",
      "При добавлении нового урока поле «Кабинет» сохраняет последнее введенное значение."
    ],
    removed: []
  },
  "1.0.53": {
    added: [
      "Добавлен раздел «Предметы» с возможностью управлять справочником предметов."
    ],
    changed: [
      "В форме «Новый урок» поле предмета переведено на выпадающий список из справочника предметов."
    ],
    removed: []
  },
  "1.0.52": {
    added: [
      "В форме «Новый урок» поле класса переведено на выпадающий список, связанный со справочником классов."
    ],
    changed: [
      "Список классов для расписания обновляется автоматически при изменениях во вкладке «Классы»."
    ],
    removed: []
  },
  "1.0.51": {
    added: [],
    changed: [
      "Конструктор расписания упрощен: удалено деление по неделям I/II, время урока теперь рассчитывается автоматически по номеру урока и настройкам сетки."
    ],
    removed: []
  },
  "1.0.50": {
    added: [
      "Во вкладке «Оценки» добавлены столбцы дат уроков на основе расписания для выбранного класса."
    ],
    changed: [
      "Журнал оценок автоматически объединяет даты из расписания, существующих оценок и вручную добавленных дат."
    ],
    removed: []
  },
  "1.0.49": {
    added: [
      "Во вкладке «Ученики» добавлена кнопка печати в каждой карточке класса для печати списка только выбранного класса."
    ],
    changed: [
      "Форма входа обновлена: убраны подсказки с тестовыми учетными данными."
    ],
    removed: []
  },
  "1.0.48": {
    added: [],
    changed: [
      "Печать списка учеников переработана: каждый класс печатается на отдельной странице (один класс — один лист)."
    ],
    removed: []
  },
  "1.0.47": {
    added: [
      "Вкладка «Ученики»: список классов отображается панелями, по нажатию открывается модальное окно со списком учеников класса."
    ],
    changed: [
      "Форма создания ученика упрощена: убраны поля предмета и контактов.",
      "Добавлена возможность переноса ученика из одного класса в другой прямо из модального окна класса."
    ],
    removed: []
  },
  "1.0.46": {
    added: [
      "Вкладка «Ученики»: список учеников сгруппирован по классам в формате карточек."
    ],
    changed: [
      "Форма добавления ученика: выбор класса выполнен кнопками-переключателями вместо выпадающего списка."
    ],
    removed: []
  },
  "1.0.41": {
    added: [
      "Вкладка «Ученики»: список теперь сгруппирован по классам в виде карточек с карточками учеников внутри."
    ],
    changed: [
      "Форма добавления ученика: выбор класса переведен с выпадающего списка на кнопки-переключатели."
    ],
    removed: []
  },
  "1.0.40": {
    added: [
      "Расписание по двухнедельному циклу: урок — неделя I, II или обе; настройка отображаемой недели на дашборде (авто по ISO-неделе или вручную)."
    ],
    changed: [],
    removed: []
  },
  "1.0.39": {
    added: [],
    changed: [
      "Оценки: только таблица фамилии × даты уроков, класс и добавление даты; контекстное меню в ячейке (1–5, Н, Б). Убран фильтр по предмету."
    ],
    removed: []
  },
  "1.0.38": {
    added: [
      "Журнал оценок: одна таблица «учащиеся × даты уроков», добавление столбцов дат, контекстное меню в ячейке (1–5, Н, Б, очистить)."
    ],
    changed: [],
    removed: []
  },
  "1.0.37": {
    added: [],
    changed: [
      "Вкладки «Ученики» и «Оценки»: новая сетка без наложения блоков, таблицы в прокручиваемой области, перенос строк и адаптив на узких окнах."
    ],
    removed: []
  },
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
  const breakDuration = Math.max(0, Number(state.scheduleSettings.breakDurationMin) || 0);
  const start = fromMinutes(baseStartMinutes + lessonIndex * (duration + breakDuration));
  const end = fromMinutes(toMinutes(start) + duration);
  return { start, end };
}

function recalculateScheduleTimes() {
  let changedCount = 0;
  state.schedule.forEach((entry) => {
    const lessonNumber = Number(entry.lessonNumber);
    const timeRange = calculateLessonTime(lessonNumber);
    if (!timeRange) return;
    if (entry.start !== timeRange.start || entry.end !== timeRange.end) {
      entry.start = timeRange.start;
      entry.end = timeRange.end;
      changedCount += 1;
    }
  });
  return changedCount;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getJournalClassOptions() {
  const fromClasses = state.classes.map((c) => c.name).filter(Boolean);
  const fromStudents = [...new Set(state.students.map((s) => s.className).filter(Boolean))];
  const fromSchedule = [...new Set(state.schedule.map((s) => s.className).filter(Boolean))];
  return [...new Set([...fromClasses, ...fromStudents, ...fromSchedule])].sort((a, b) => a.localeCompare(b, "ru"));
}

function getScheduleSubjectOptions() {
  const fromDirectory = state.subjects.map((s) => String(s.name || "").trim()).filter(Boolean);
  const fromSchedule = [...new Set(state.schedule.map((s) => String(s.subject || "").trim()).filter(Boolean))];
  return [...new Set([...fromDirectory, ...fromSchedule])].sort((a, b) => a.localeCompare(b, "ru"));
}

function getStudentSurname(student) {
  const raw = String(student?.name || "").trim();
  if (!raw) return "—";
  const parts = raw.split(/\s+/);
  return parts[0] || raw;
}

function getStudentsForJournal(className) {
  return state.students
    .filter((s) => s.className === className)
    .sort((a, b) => {
      const sa = getStudentSurname(a);
      const sb = getStudentSurname(b);
      const cmp = sa.localeCompare(sb, "ru");
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name, "ru");
    });
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayIndexByName(dayName) {
  const map = {
    Понедельник: 1,
    Вторник: 2,
    Среда: 3,
    Четверг: 4,
    Пятница: 5,
    Суббота: 6,
    Воскресенье: 0
  };
  return map[dayName] ?? null;
}

function collectJournalDatesFromSchedule(className) {
  const target = String(className || "").trim();
  if (!target) return [];
  // For grades journal we should consider the full class schedule,
  // not only entries assigned to the currently logged-in user.
  const classEntries = state.schedule.filter((entry) => String(entry.className || "").trim() === target);
  if (!classEntries.length) return [];

  const dates = new Set();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 30);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 120);

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const dayIndex = cursor.getDay();
    for (const entry of classEntries) {
      const entryDayIndex = getDayIndexByName(entry.day);
      if (entryDayIndex === null || entryDayIndex !== dayIndex) continue;
      dates.add(toIsoDate(cursor));
      break;
    }
  }

  return [...dates].sort();
}

function collectJournalDates(studentIds, className = "") {
  const idSet = new Set(studentIds);
  const fromGrades = state.grades.filter((g) => idSet.has(g.studentId)).map((g) => g.date);
  const extra = Array.isArray(state.gradesJournalExtraDates) ? state.gradesJournalExtraDates : [];
  const fromSchedule = collectJournalDatesFromSchedule(className);
  return [...new Set([...fromSchedule, ...fromGrades, ...extra].filter(Boolean))].sort();
}

function formatGradeDateHeader(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateInCurrentWeek(isoDate) {
  const target = parseIsoDate(isoDate);
  if (!target) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const currentDay = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - currentDay);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return target >= start && target <= end;
}

function findGradeForCell(studentId, date) {
  const matches = state.grades.filter((g) => g.studentId === studentId && g.date === date);
  if (!matches.length) return null;
  return matches[matches.length - 1];
}

function setGradeCell(studentId, date, value) {
  state.grades = state.grades.filter((g) => !(g.studentId === studentId && g.date === date));
  const trimmed = value === null || value === undefined ? "" : String(value).trim();
  if (trimmed) {
    state.grades.push({ id: uid(), studentId, value: trimmed, date, comment: "" });
  }
  saveState();
  renderGradesJournal();
}

let gradesContextTarget = null;
let gradesActiveTarget = null;

function hideGradesContextMenu() {
  const menu = document.getElementById("grades-context-menu");
  if (menu) {
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
  }
  gradesContextTarget = null;
}

function findGradesCellByTarget(target) {
  if (!target?.studentId || !target?.lessonDate) return null;
  return document.querySelector(
    `.grades-matrix-cell[data-student-id="${target.studentId}"][data-lesson-date="${target.lessonDate}"]`
  );
}

function setActiveGradesCell(cell, focus = false) {
  document.querySelectorAll(".grades-matrix-cell.grades-matrix-active").forEach((el) => {
    el.classList.remove("grades-matrix-active");
  });
  if (!cell) {
    gradesActiveTarget = null;
    return;
  }
  cell.classList.add("grades-matrix-active");
  gradesActiveTarget = {
    studentId: cell.dataset.studentId,
    lessonDate: cell.dataset.lessonDate
  };
  if (focus) cell.focus();
}

function moveActiveGradesCell(deltaRow, deltaCol) {
  const cells = [...document.querySelectorAll(".grades-matrix-cell")];
  if (!cells.length) return;
  let current = findGradesCellByTarget(gradesActiveTarget);
  if (!current) current = cells[0];
  const currentRow = current.parentElement;
  const bodyRows = [...document.querySelectorAll("#grades-matrix-body tr")];
  const rowIndex = bodyRows.indexOf(currentRow);
  const rowCells = [...currentRow.querySelectorAll(".grades-matrix-cell")];
  const colIndex = rowCells.indexOf(current);
  if (rowIndex < 0 || colIndex < 0) return;
  const nextRowIndex = Math.max(0, Math.min(bodyRows.length - 1, rowIndex + deltaRow));
  const nextRow = bodyRows[nextRowIndex];
  const nextRowCells = [...nextRow.querySelectorAll(".grades-matrix-cell")];
  const nextColIndex = Math.max(0, Math.min(nextRowCells.length - 1, colIndex + deltaCol));
  const nextCell = nextRowCells[nextColIndex];
  if (!nextCell) return;
  setActiveGradesCell(nextCell, true);
  nextCell.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function pickGradeByKeyboard(event) {
  const key = event.key;
  if (/^[1-5]$/.test(key)) return key;
  if (/^Numpad[1-5]$/.test(event.code || "")) return (event.code || "").replace("Numpad", "");
  if (key === "б" || key === "Б" || key.toLowerCase() === "b") return "Б";
  if (key === "н" || key === "Н" || key.toLowerCase() === "n") return "Н";
  if (key === "Backspace" || key === "Delete") return "";
  return null;
}

function showGradesContextMenu(clientX, clientY) {
  const menu = document.getElementById("grades-context-menu");
  if (!menu) return;
  menu.classList.remove("hidden");
  menu.setAttribute("aria-hidden", "false");
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  const pad = 8;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    let x = clientX;
    let y = clientY;
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  });
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
  const order = ["home", "classes", "students", "subjects", "grades", "schedule", "computers", "shared-folders", "access", "profile", "settings"];
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
  state.subjects = Array.isArray(parsed.subjects) ? parsed.subjects : [];
  state.students = Array.isArray(parsed.students) ? parsed.students : [];
  state.grades = Array.isArray(parsed.grades) ? parsed.grades : [];
  state.schedule = Array.isArray(parsed.schedule) ? parsed.schedule : [];
  state.studentComputers = Array.isArray(parsed.studentComputers)
    ? parsed.studentComputers.map((item) => ({
        id: item?.id || uid(),
        computerNumber: String(item?.computerNumber || item?.number || "").trim(),
        computerName: String(item?.computerName || "").trim(),
        ipAddress: String(item?.ipAddress || "").trim(),
        note: String(item?.note || "").trim(),
        status: item?.status === "offline" ? "offline" : "online"
      }))
      .filter((item) => /^\d+$/.test(item.computerNumber))
    : [];
  state.computerCommandLog = Array.isArray(parsed.computerCommandLog)
    ? parsed.computerCommandLog
        .map((entry) => ({
          id: entry?.id || uid(),
          computerId: entry?.computerId || "",
          computerName: String(entry?.computerName || "").trim(),
          command: String(entry?.command || "").trim(),
          note: String(entry?.note || "").trim(),
          timestamp: String(entry?.timestamp || "").trim()
        }))
        .filter((entry) => entry.computerId && entry.computerName && entry.command && entry.timestamp)
    : [];
  state.scheduleSettings = {
    firstLessonStart: parsed.scheduleSettings?.firstLessonStart || "08:00",
    lessonDurationMin: Number(parsed.scheduleSettings?.lessonDurationMin) || 45,
    breakDurationMin: Math.max(0, Number(parsed.scheduleSettings?.breakDurationMin) || 10)
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
  state.gradesJournalClass = typeof parsed.gradesJournalClass === "string" ? parsed.gradesJournalClass : "";
  state.studentComputersNumberFilter =
    typeof parsed.studentComputersNumberFilter === "string"
      ? parsed.studentComputersNumberFilter
      : typeof parsed.studentComputersClassFilter === "string"
        ? parsed.studentComputersClassFilter
        : "";
  state.gradesJournalDateMode = parsed.gradesJournalDateMode === "all" ? "all" : "week";
  state.gradesJournalExtraDates = Array.isArray(parsed.gradesJournalExtraDates)
    ? parsed.gradesJournalExtraDates.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  state.sharedFoldersShowAll = Boolean(parsed.sharedFoldersShowAll);
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
      try {
        const backupRaw = localStorage.getItem(COMPUTERS_BACKUP_KEY);
        if (backupRaw) {
          const backup = JSON.parse(backupRaw);
          if (backup && typeof backup === "object") {
            state.studentComputers = Array.isArray(backup.studentComputers) ? backup.studentComputers : [];
            state.computerCommandLog = Array.isArray(backup.computerCommandLog) ? backup.computerCommandLog : [];
          }
        }
      } catch (_backupError) {
        // Ignore corrupted local backup; DB remains primary source.
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
    subjects: state.subjects,
    students: state.students,
    grades: state.grades,
    schedule: state.schedule,
    studentComputers: state.studentComputers,
    computerCommandLog: state.computerCommandLog,
    scheduleSettings: state.scheduleSettings,
    databaseConfig: state.databaseConfig,
    roles: state.roles,
    users: state.users,
    currentUserId: state.currentUserId,
    auth: state.auth,
    studentComputersNumberFilter: state.studentComputersNumberFilter,
    gradesJournalClass: state.gradesJournalClass,
    gradesJournalDateMode: state.gradesJournalDateMode,
    gradesJournalExtraDates: state.gradesJournalExtraDates,
    sharedFoldersShowAll: state.sharedFoldersShowAll
  };
  if (!window.teachAxoDb?.saveState) {
    console.error("SQLite API недоступен. Сохранение отменено.");
    return;
  }
  try {
    localStorage.setItem(
      COMPUTERS_BACKUP_KEY,
      JSON.stringify({
        studentComputers: state.studentComputers,
        computerCommandLog: state.computerCommandLog
      })
    );
  } catch (_backupError) {
    // Ignore localStorage limits/errors.
  }
  window.teachAxoDb.saveState(snapshot).catch((error) => {
    console.error("Не удалось сохранить данные в SQLite:", error);
  });
  scheduleSharedFolderSync();
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

function renderSubjects() {
  const tbody = document.getElementById("subjects-table-body");
  if (!tbody) return;
  const sorted = [...state.subjects].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  tbody.innerHTML = sorted
    .map((subject) => {
      const count = state.schedule.filter((entry) => String(entry.subject || "") === String(subject.name || "")).length;
      return `<tr>
        <td>${escapeHtml(subject.name)}</td>
        <td>${count}</td>
        <td><button class="ui mini red button" data-delete-subject="${subject.id}">Удалить</button></td>
      </tr>`;
    })
    .join("");
}

function renderScheduleClassSelect() {
  const classSelect = document.getElementById("schedule-class");
  if (!classSelect) return;

  const classNames = state.classes
    .map((item) => item.name?.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  const currentValue = classSelect.value;

  classSelect.innerHTML = classNames.length
    ? [`<option value="">Выберите класс</option>`, ...classNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)].join("")
    : `<option value="">Сначала добавьте класс</option>`;

  if (classNames.includes(currentValue)) {
    classSelect.value = currentValue;
  } else {
    classSelect.value = "";
  }

  const submitButton = document.querySelector("#schedule-form button[type='submit']");
  const hasSubjectOptions = getScheduleSubjectOptions().length > 0;
  if (submitButton) submitButton.disabled = classNames.length === 0 || !hasSubjectOptions;
}

function renderScheduleSubjectSelect() {
  const subjectSelect = document.getElementById("schedule-subject");
  if (!subjectSelect) return;
  const options = getScheduleSubjectOptions();
  const currentValue = subjectSelect.value;
  subjectSelect.innerHTML = options.length
    ? [`<option value="">Выберите предмет</option>`, ...options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)].join("")
    : `<option value="">Сначала добавьте предмет</option>`;
  subjectSelect.value = options.includes(currentValue) ? currentValue : "";
  const submitButton = document.querySelector("#schedule-form button[type='submit']");
  if (submitButton) submitButton.disabled = options.length === 0 || state.classes.length === 0;
}

function renderStudentClassToggle() {
  const toggleWrap = document.getElementById("student-class-toggle");
  const hiddenInput = document.getElementById("student-class");
  const hint = document.getElementById("student-class-toggle-hint");
  const submitButton = document.querySelector("#student-form button[type='submit']");
  if (!toggleWrap || !hiddenInput) return;

  const classNames = state.classes
    .map((item) => item.name?.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  const currentValue = hiddenInput.value.trim();
  const hasCurrent = currentValue && classNames.includes(currentValue);

  if (!classNames.length) {
    hiddenInput.value = "";
    toggleWrap.innerHTML = "";
    toggleWrap.classList.add("is-empty");
    if (hint) hint.classList.remove("hidden");
    if (submitButton) submitButton.disabled = true;
    return;
  }

  if (submitButton) submitButton.disabled = false;
  toggleWrap.classList.remove("is-empty");
  if (hint) hint.classList.add("hidden");
  hiddenInput.value = hasCurrent ? currentValue : classNames[0];

  toggleWrap.innerHTML = classNames
    .map((className) => {
      const isActive = className === hiddenInput.value;
      return `<button type="button" class="student-class-chip${isActive ? " active" : ""}" data-student-class="${escapeHtml(
        className
      )}" role="radio" aria-checked="${isActive ? "true" : "false"}">${escapeHtml(className)}</button>`;
    })
    .join("");
}

function getSortedClassNames() {
  return [...new Set(state.classes.map((item) => item.name?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function openStudentsClassModal(className) {
  const modal = document.getElementById("students-class-modal");
  if (!modal) return;
  state.studentsModalClass = String(className || "");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderStudentsClassModal();
}

function closeStudentsClassModal() {
  const modal = document.getElementById("students-class-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  state.studentsModalClass = "";
}

function printSingleClassList(className) {
  const target = String(className || "").trim();
  if (!target) return;
  const students = state.students
    .filter((student) => String(student.className || "").trim() === target)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const rows = students
    .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.notes || "-")}</td></tr>`)
    .join("");
  const content = students.length
    ? `<h2>Класс: ${escapeHtml(target)}</h2><table><thead><tr><th>ФИО</th><th>Комментарий</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<h2>Класс: ${escapeHtml(target)}</h2><p>В этом классе нет учеников.</p>`;
  printHtml(`TeachAxo - Список учеников (${target})`, content);
}

function renderStudentsClassModal() {
  const title = document.getElementById("students-class-modal-title");
  const body = document.getElementById("students-class-modal-body");
  if (!title || !body) return;

  const className = state.studentsModalClass;
  if (!className) {
    title.textContent = "Класс";
    body.innerHTML = `<div class="students-empty-hint">Класс не выбран.</div>`;
    return;
  }

  title.textContent = `Класс ${className}`;
  const students = state.students
    .filter((student) => student.className === className)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const classNames = getSortedClassNames();

  if (!students.length) {
    body.innerHTML = `<div class="students-empty-hint">В этом классе нет учеников.</div>`;
    return;
  }

  body.innerHTML = students
    .map((student) => {
      const moveOptions = classNames
        .filter((name) => name !== className)
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join("");
      return `<article class="student-modal-row">
        <div class="student-modal-name">${escapeHtml(student.name)}</div>
        ${
          moveOptions
            ? `<div class="student-modal-actions">
            <select data-move-student-select="${escapeHtml(student.id)}">
              ${moveOptions}
            </select>
            <button class="ui mini button" type="button" data-move-student="${escapeHtml(student.id)}">Перенести</button>
            <button class="ui mini red button" type="button" data-delete-student="${escapeHtml(student.id)}">Удалить</button>
          </div>`
            : `<div class="student-modal-actions">
            <span class="student-modal-hint">Нет других классов для переноса</span>
            <button class="ui mini red button" type="button" data-delete-student="${escapeHtml(student.id)}">Удалить</button>
          </div>`
        }
      </article>`;
    })
    .join("");
}

function renderStudents() {
  const groups = document.getElementById("students-class-groups");
  const query = state.searchQuery.toLowerCase().trim();
  const filtered = state.students.filter((student) =>
    `${student.name} ${student.className}`.toLowerCase().includes(query)
  );
  const grouped = new Map();
  filtered.forEach((student) => {
    const className = student.className || "Без класса";
    if (!grouped.has(className)) grouped.set(className, []);
    grouped.get(className).push(student);
  });

  const sortedClassNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  if (!sortedClassNames.length) {
    groups.innerHTML = `<div class="students-empty-hint">По вашему запросу ученики не найдены.</div>`;
    return;
  }

  groups.innerHTML = sortedClassNames
    .map((className) => {
      const students = grouped.get(className) || [];
      return `<section class="students-class-card">
        <div class="students-class-card-head">
          <button type="button" class="students-class-open-btn" data-open-class="${escapeHtml(className)}">
            <h4>${escapeHtml(className)}</h4>
            <span>${students.length} учен.</span>
          </button>
          <button type="button" class="ui mini button" data-print-class="${escapeHtml(className)}">Печать</button>
        </div>
      </section>`;
    })
    .join("");

  const modal = document.getElementById("students-class-modal");
  if (modal && !modal.classList.contains("hidden")) {
    renderStudentsClassModal();
  }
}

function renderGradesJournalToolbar() {
  const classSelect = document.getElementById("grades-journal-class");
  const dateModeSelect = document.getElementById("grades-journal-date-mode");
  if (!classSelect) return;

  const classes = getJournalClassOptions();
  let currentClass = state.gradesJournalClass;
  if (!currentClass || !classes.includes(currentClass)) {
    currentClass = classes[0] || "";
  }
  state.gradesJournalClass = currentClass;

  classSelect.innerHTML = classes.length
    ? classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")
    : `<option value="">— Нет классов —</option>`;
  classSelect.value = currentClass;
  if (dateModeSelect) {
    dateModeSelect.value = state.gradesJournalDateMode === "all" ? "all" : "week";
  }
}

function renderGradesJournal() {
  const thead = document.getElementById("grades-matrix-head");
  const tbody = document.getElementById("grades-matrix-body");
  if (!thead || !tbody) return;

  hideGradesContextMenu();
  renderGradesJournalToolbar();

  const className = state.gradesJournalClass;
  const students = className ? getStudentsForJournal(className) : [];
  const studentIds = students.map((s) => s.id);
  const allDates = className ? collectJournalDates(studentIds, className) : [];
  const dates = state.gradesJournalDateMode === "all" ? allDates : allDates.filter((d) => isDateInCurrentWeek(d));

  if (!className || !students.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="1" class="grades-journal-empty">${
      !className ? "Выберите класс." : "В этом классе нет учеников."
    }</td></tr>`;
    return;
  }

  if (!dates.length) {
    thead.innerHTML = `<tr><th class="grades-matrix-corner">Фамилия</th></tr>`;
    tbody.innerHTML = students
      .map(
        (student) =>
          `<tr><td class="grades-matrix-name" title="${escapeHtml(student.name)}">${escapeHtml(
            getStudentSurname(student)
          )}</td></tr>`
      )
      .join("");
    return;
  }

  const headCells = [
    `<th class="grades-matrix-corner">Фамилия</th>`,
    ...dates.map(
      (d) =>
        `<th scope="col" title="${escapeHtml(d)}"><span class="grades-matrix-date-label">${escapeHtml(
          formatGradeDateHeader(d)
        )}</span></th>`
    )
  ];
  thead.innerHTML = `<tr>${headCells.join("")}</tr>`;

  tbody.innerHTML = students
    .map((student) => {
      const cells = dates
        .map((date) => {
          const g = findGradeForCell(student.id, date);
          const val = g ? g.value : "";
          const display = val === "" ? "·" : escapeHtml(val);
          const emptyClass = val === "" ? " grades-matrix-empty" : "";
          return `<td class="grades-matrix-cell${emptyClass}" tabindex="-1" data-student-id="${escapeHtml(
            student.id
          )}" data-lesson-date="${escapeHtml(date)}">${display}</td>`;
        })
        .join("");
      return `<tr>
        <td class="grades-matrix-name" title="${escapeHtml(student.name)}">${escapeHtml(getStudentSurname(student))}</td>
        ${cells}
      </tr>`;
    })
    .join("");

  const activeCell = findGradesCellByTarget(gradesActiveTarget);
  if (activeCell) {
    setActiveGradesCell(activeCell, false);
  } else {
    const firstCell = tbody.querySelector(".grades-matrix-cell");
    if (firstCell) setActiveGradesCell(firstCell, false);
  }
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
  const weekLine = document.getElementById("home-schedule-week-line");
  if (weekLine) {
    weekLine.textContent = "Показывается актуальное расписание без деления на недели цикла.";
  }

  const sorted = [...getDashboardScheduleEntries()].sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
  });

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="center aligned">У вас пока нет записей в расписании. Добавьте слоты в разделе «Расписание».</td></tr>`;
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

  const sorted = [...getDashboardScheduleEntries()].sort((a, b) => {
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

function getComputerActionButtons(computerId, mode = "full") {
  const compact = [
    { key: "shutdown", label: "Выключить" },
    { key: "restart", label: "Перезагрузить" },
    { key: "lock", label: "Заблокировать" }
  ];
  const full = [
    { key: "check_connection", label: "Проверить подключение" },
    { key: "disable_management", label: "Отключить от управления" },
    { key: "shutdown", label: "Выключить" },
    { key: "restart", label: "Перезагрузка" },
    { key: "remote_control", label: "Удаленное управление" },
    { key: "lock", label: "Блокировка" },
    { key: "unlock", label: "Разблокировка" },
    { key: "start_app", label: "Запуск приложения" },
    { key: "close_app", label: "Закрытие приложения" },
    { key: "screen_view", label: "Просмотр экрана" },
    { key: "deny_app_launch", label: "Запрет запуска приложений" },
    { key: "group_policy", label: "Редактор групповых политик" }
  ];
  const actions = mode === "compact" ? compact : full;
  return actions
    .map(
      (action) =>
        `<button type="button" class="ui mini button" data-computer-action="${action.key}" data-computer-id="${computerId}">${action.label}</button>`
    )
    .join("");
}

function buildSharedFolderTree() {
  const classMap = new Map();
  state.classes
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .forEach((name) => {
      if (!classMap.has(name)) classMap.set(name, new Set());
    });
  state.students.forEach((student) => {
    const className = String(student?.className || "").trim();
    const studentName = String(student?.name || "").trim();
    if (!className || !studentName) return;
    if (!classMap.has(className)) classMap.set(className, new Set());
    classMap.get(className).add(studentName);
  });
  return [...classMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ru"))
    .map(([className, studentsSet]) => ({
      className,
      students: [...studentsSet].sort((a, b) => a.localeCompare(b, "ru"))
    }));
}

function buildComputerActionPayload(actionKey) {
  if (actionKey === "start_app") {
    const appPath = window.prompt("Укажите полный путь к приложению для запуска:", "C:\\Windows\\System32\\notepad.exe");
    if (appPath === null) return null;
    const trimmed = appPath.trim();
    if (!trimmed) return null;
    return { path: trimmed };
  }
  if (actionKey === "close_app") {
    const processName = window.prompt("Укажите имя процесса для закрытия:", "notepad.exe");
    if (processName === null) return null;
    const trimmed = processName.trim();
    if (!trimmed) return null;
    return { processName: trimmed };
  }
  if (actionKey === "deny_app_launch") {
    const processName = window.prompt("Укажите имя процесса для блокировки запуска:", "notepad.exe");
    if (processName === null) return null;
    const trimmed = processName.trim();
    if (!trimmed) return null;
    return { processName: trimmed };
  }
  return {};
}

async function syncSharedFolderToConnectedComputers() {
  const connectedList = Array.isArray(state.connectedComputers) ? state.connectedComputers : [];
  if (!connectedList.length) return;
  const schedule = Array.isArray(state.schedule)
    ? state.schedule
        .map((entry) => ({
          day: String(entry?.day || "").trim(),
          start: String(entry?.start || "").trim(),
          end: String(entry?.end || "").trim(),
          className: String(entry?.className || "").trim()
        }))
        .filter((entry) => entry.day && entry.start && entry.end && entry.className)
    : [];
  const payload = {
    classes: buildSharedFolderTree(),
    schedule,
    showAll: Boolean(state.sharedFoldersShowAll),
    generatedAt: new Date().toISOString()
  };
  const treeHash = JSON.stringify({
    classes: payload.classes,
    schedule: payload.schedule,
    showAll: payload.showAll
  });
  if (treeHash !== lastSharedFolderHash) {
    sharedFolderSyncedByComputer.clear();
    lastSharedFolderHash = treeHash;
  }
  const connectedSet = new Set();
  for (const item of connectedList) {
    const computerNumber = String(item?.computerNumber || "").trim();
    if (!computerNumber) continue;
    connectedSet.add(computerNumber);
    if (sharedFolderSyncedByComputer.get(computerNumber) === treeHash) continue;
    try {
      const response = await window.teachAxo?.sendComputerCommand?.({
        computerNumber,
        action: "setup_shared_folder",
        data: payload
      });
      if (response?.ok) sharedFolderSyncedByComputer.set(computerNumber, treeHash);
    } catch (_error) {}
  }
  for (const cachedComputerNumber of [...sharedFolderSyncedByComputer.keys()]) {
    if (!connectedSet.has(cachedComputerNumber)) {
      sharedFolderSyncedByComputer.delete(cachedComputerNumber);
    }
  }
}

function scheduleSharedFolderSync() {
  if (sharedFolderSyncTimer) clearTimeout(sharedFolderSyncTimer);
  sharedFolderSyncTimer = setTimeout(() => {
    sharedFolderSyncTimer = null;
    syncSharedFolderToConnectedComputers().catch(() => {});
  }, 900);
}

function renderSharedFoldersPage() {
  const toggle = document.getElementById("shared-folders-show-all");
  const status = document.getElementById("shared-folders-status");
  if (!toggle || !status) return;
  toggle.checked = Boolean(state.sharedFoldersShowAll);
  status.textContent = state.sharedFoldersShowAll
    ? "Включен режим отображения всех папок классов."
    : "Папки фильтруются по текущему уроку из расписания.";
}

async function requestComputerFrame(computerNumber) {
  const desired = {
    format: "jpeg",
    quality: 45,
    scale: 0.5
  };
  const response = await window.teachAxo?.sendComputerCommand?.({
    computerNumber,
    action: "screen_frame",
    data: desired
  });
  if (!response?.ok) {
    const message = String(response?.error || "Неизвестная ошибка кадра.");
    throw new Error(message);
  }
  const frame = String(response.output || "");
  if (!frame) {
    throw new Error("Пустой ответ кадра от агента.");
  }
  return frame;
}

async function sendComputerRemoteInput(computerNumber, payload) {
  return window.teachAxo?.sendComputerCommand?.({
    computerNumber,
    action: "remote_input",
    data: payload || {}
  });
}

function openComputerStreamWindow(computer, mode) {
  const titlePrefix = mode === "control" ? "Удаленное управление" : "Просмотр экрана";
  const win = window.open("", `_blank`, "width=1200,height=780");
  if (!win) {
    notifyUser("Браузер заблокировал всплывающее окно.", "warning");
    return;
  }
  const canControl = mode === "control";
  const computerLabel = `${computer.computerName || "Компьютер"} №${computer.computerNumber || "-"}`;
  win.document.write(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${titlePrefix} - ${computerLabel}</title>
<style>
  body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#111827;color:#e5e7eb}
  .bar{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#0f172a;position:sticky;top:0}
  .bar .title{font-weight:600}
  .bar .status{font-size:12px;opacity:.85}
  .canvas-wrap{display:flex;justify-content:center;align-items:flex-start;padding:12px}
  img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 0 0 1px #334155;${canControl ? "cursor:crosshair;" : ""}}
  button{background:#2563eb;border:none;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer}
</style></head>
<body>
  <div class="bar">
    <div class="title">${titlePrefix}: ${computerLabel}</div>
    <button id="refresh-btn" type="button">Обновить кадр</button>
    <div class="status" id="stream-status">Подключение...</div>
  </div>
  <div class="canvas-wrap"><img id="screen-frame" alt="Экран компьютера" /></div>
<script>
  const statusNode = document.getElementById("stream-status");
  const imageNode = document.getElementById("screen-frame");
  const refreshBtn = document.getElementById("refresh-btn");
  const computerNumber = ${JSON.stringify(String(computer.computerNumber || ""))};
  let busy = false;
  let timer = null;
  const fetchFrame = async () => {
    if (busy) return;
    busy = true;
    try {
      const frame = await window.opener.__teachaxoRemote.fetchFrame(computerNumber);
      if (frame) {
        imageNode.src = "data:image/png;base64," + frame;
        statusNode.textContent = "Кадр обновлен: " + new Date().toLocaleTimeString("ru-RU");
      } else {
        statusNode.textContent = "Нет данных кадра (компьютер офлайн или ошибка).";
      }
    } catch (error) {
      statusNode.textContent = "Ошибка получения кадра: " + (error?.message || error);
    } finally {
      busy = false;
    }
  };
  refreshBtn.addEventListener("click", fetchFrame);
  timer = setInterval(fetchFrame, 300);
  window.addEventListener("beforeunload", () => { if (timer) clearInterval(timer); });
  fetchFrame();
  ${canControl ? `
  imageNode.addEventListener("click", async (event) => {
    const rect = imageNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    await window.opener.__teachaxoRemote.sendInput(computerNumber, { type: "click", x, y });
  });
  window.addEventListener("keydown", async (event) => {
    if (event.key === "F5") return;
    await window.opener.__teachaxoRemote.sendInput(computerNumber, { type: "key", key: event.key });
  });
  ` : ""}
</script></body></html>`);
  win.document.close();
}

function renderComputerModal() {
  const modal = document.getElementById("student-computer-modal");
  const title = document.getElementById("student-computer-modal-title");
  const body = document.getElementById("student-computer-modal-body");
  if (!modal || !title || !body) return;
  const computer = state.studentComputers.find((item) => item.id === state.studentComputersModalId);
  if (!computer) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    return;
  }
  const connection = (state.connectedComputers || []).find(
    (item) => String(item?.computerNumber || "") === String(computer.computerNumber || "")
  );
  const status = connection ? "Подключен" : "Не подключен";
  title.textContent = `${computer.computerName || "Компьютер"} №${computer.computerNumber || "-"}`;
  body.innerHTML = `
    <div class="student-computer-modal-meta">
      <div class="label">Название</div><div>${escapeHtml(computer.computerName || "-")}</div>
      <div class="label">Номер</div><div>${escapeHtml(computer.computerNumber || "-")}</div>
      <div class="label">IP адрес</div><div>${escapeHtml(connection?.remoteAddress || computer.ipAddress || "-")}</div>
      <div class="label">Хост</div><div>${escapeHtml(connection?.hostname || "-")}</div>
      <div class="label">Статус</div><div>${escapeHtml(status)}</div>
      <div class="label">Примечание</div><div>${escapeHtml(computer.note || "-")}</div>
    </div>
    <div class="student-computer-modal-controls">
      ${getComputerActionButtons(computer.id, "full")}
      <button type="button" class="ui mini red button" data-delete-computer="${computer.id}">Удалить</button>
    </div>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function renderComputers() {
  const numberFilterInput = document.getElementById("student-computer-number-filter");
  const cardsWrap = document.getElementById("student-computers-cards");
  const logBody = document.getElementById("student-computers-log-body");
  if (!numberFilterInput || !cardsWrap || !logBody) return;
  const selectedNumber = String(state.studentComputersNumberFilter || "").trim();
  numberFilterInput.value = selectedNumber;

  const connectedByNumber = new Map(
    (state.connectedComputers || []).map((item) => [String(item.computerNumber || "").trim(), item])
  );
  const visibleComputers = state.studentComputers.filter((computer) => {
    if (!selectedNumber) return true;
    return String(computer.computerNumber || "") === selectedNumber;
  });

  cardsWrap.innerHTML = visibleComputers
    .map((computer) => {
      const connection = connectedByNumber.get(String(computer.computerNumber || ""));
      const connected = Boolean(connection);
      return `<article class="student-computer-card ${connected ? "connected" : "disconnected"}" data-open-computer-modal="${computer.id}">
        <div class="student-computer-card-title">${escapeHtml(computer.computerName || `PC-${computer.computerNumber || "-"}`)}</div>
        <div class="student-computer-card-address">${escapeHtml(connection?.remoteAddress || computer.ipAddress || "-")}</div>
        <div class="student-computer-card-status">${connected ? "Подключен" : "Не подключен"}</div>
        <div class="student-computer-card-controls">
          ${getComputerActionButtons(computer.id, "compact")}
        </div>
      </article>`;
    })
    .join("");
  if (!cardsWrap.innerHTML.trim()) {
    cardsWrap.innerHTML = '<div class="students-empty-hint">Компьютеры не добавлены.</div>';
  }

  logBody.innerHTML = [...state.computerCommandLog]
    .reverse()
    .slice(0, 80)
    .map((entry) => {
      const dt = new Date(entry.timestamp);
      const timeText = Number.isNaN(dt.getTime()) ? entry.timestamp : dt.toLocaleString("ru-RU");
      return `<tr>
        <td>${escapeHtml(timeText)}</td>
        <td>${escapeHtml(entry.computerName || "-")}</td>
        <td>${escapeHtml(entry.command || "-")}</td>
        <td>${escapeHtml(entry.note || "-")}</td>
      </tr>`;
    })
    .join("");
  if (!logBody.innerHTML.trim()) {
    logBody.innerHTML = '<tr><td colspan="4" class="muted-cell">Журнал пока пуст.</td></tr>';
  }

  const hint = document.getElementById("student-computers-connection-hint");
  if (hint) {
    hint.textContent = `Порт подключения агентов: ${state.computerServerPort}`;
  }
  renderComputerModal();
}

function syncDiscoveredComputersIntoState() {
  if (!Array.isArray(state.connectedComputers) || state.connectedComputers.length === 0) return false;
  let changed = false;
  for (const item of state.connectedComputers) {
    const number = String(item?.computerNumber || "").trim();
    if (!/^\d+$/.test(number)) continue;
    const existing = state.studentComputers.find((computer) => String(computer.computerNumber || "") === number);
    if (!existing) {
      state.studentComputers.push({
        id: uid(),
        computerNumber: number,
        computerName: String(item?.hostname || `PC-${number}`),
        ipAddress: String(item?.remoteAddress || ""),
        note: "Добавлено автоматически при подключении агента.",
        status: "online"
      });
      changed = true;
      continue;
    }
    let itemChanged = false;
    const remoteAddress = String(item?.remoteAddress || "").trim();
    const hostName = String(item?.hostname || "").trim();
    if (remoteAddress && existing.ipAddress !== remoteAddress) {
      existing.ipAddress = remoteAddress;
      itemChanged = true;
    }
    if (hostName && (!existing.computerName || /^PC-\d+$/.test(String(existing.computerName || "")))) {
      if (existing.computerName !== hostName) {
        existing.computerName = hostName;
        itemChanged = true;
      }
    }
    if (itemChanged) changed = true;
  }
  return changed;
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
  renderSubjects();
  renderScheduleClassSelect();
  renderScheduleSubjectSelect();
  renderStudentClassToggle();
  renderStudents();
  renderGradesJournal();
  renderSchedule();
  renderComputers();
  renderSharedFoldersPage();
  renderHomeSchedule();
  renderHomeDashboard();
  renderProfilePage();
  renderSettingsPage();
  renderRoles();
  renderUsers();
  renderStatusBar();
  updateThemeToggleButton();
  applyAccessControl();
}

function setupSharedFoldersHandlers() {
  const toggle = document.getElementById("shared-folders-show-all");
  const openHostBtn = document.getElementById("shared-folders-open-host");
  if (toggle) {
    toggle.addEventListener("change", () => {
      if (!requirePermission("manage_computers")) {
        toggle.checked = Boolean(state.sharedFoldersShowAll);
        return;
      }
      state.sharedFoldersShowAll = Boolean(toggle.checked);
      saveState();
      renderSharedFoldersPage();
      notifyUser("Настройки общих папок обновлены.", "success");
    });
  }
  if (openHostBtn) {
    openHostBtn.addEventListener("click", async () => {
      if (!requirePermission("manage_computers")) return;
      const response = await window.teachAxo?.openHostSharedFolder?.();
      if (response?.ok) {
        notifyUser("Окно общей папки открыто.", "success");
      } else {
        notifyUser(`Не удалось открыть общую папку: ${response?.message || "неизвестная ошибка"}.`, "warning");
      }
    });
  }
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

function setupSubjectsHandlers() {
  const form = document.getElementById("subject-form");
  const tbody = document.getElementById("subjects-table-body");
  if (!form || !tbody) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_schedule")) return;
    const name = document.getElementById("subject-name").value.trim();
    if (!name) return;
    const exists = state.subjects.some((item) => String(item.name || "").toLowerCase() === name.toLowerCase());
    if (exists) {
      notifyUser("Такой предмет уже существует.", "warning");
      return;
    }
    state.subjects.push({ id: uid(), name });
    form.reset();
    saveState();
    renderAll();
  });

  tbody.addEventListener("click", (event) => {
    if (!requirePermission("manage_schedule")) return;
    const subjectId = event.target.dataset.deleteSubject;
    if (!subjectId) return;
    const subject = state.subjects.find((item) => item.id === subjectId);
    if (!subject) return;
    const inUse = state.schedule.some((entry) => String(entry.subject || "") === String(subject.name || ""));
    if (inUse) {
      notifyUser("Нельзя удалить предмет, пока он используется в расписании.", "warning");
      return;
    }
    state.subjects = state.subjects.filter((item) => item.id !== subjectId);
    saveState();
    renderAll();
  });
}

function setupStudentHandlers() {
  const form = document.getElementById("student-form");
  const classToggleWrap = document.getElementById("student-class-toggle");
  const classHiddenInput = document.getElementById("student-class");
  const classGroups = document.getElementById("students-class-groups");
  const classModal = document.getElementById("students-class-modal");

  document.getElementById("student-search").addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderStudents();
  });

  if (classToggleWrap && classHiddenInput) {
    classToggleWrap.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-student-class]");
      if (!pick) return;
      classHiddenInput.value = pick.dataset.studentClass || "";
      renderStudentClassToggle();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_students")) return;
    const name = document.getElementById("student-name").value.trim();
    const className = classHiddenInput.value.trim();
    const notes = document.getElementById("student-notes").value.trim();
    if (!name || !className) return;
    ensureClassExists(className);
    state.students.push({ id: uid(), name, className, notes });
    const selectedClass = className;
    form.reset();
    classHiddenInput.value = selectedClass;
    saveState();
    renderAll();
  });

  classGroups.addEventListener("click", (event) => {
    const openClass = event.target.closest("[data-open-class]");
    if (openClass) {
      openStudentsClassModal(openClass.dataset.openClass);
      return;
    }
    const printClass = event.target.closest("[data-print-class]");
    if (printClass) {
      printSingleClassList(printClass.dataset.printClass);
    }
  });

  if (classModal) {
    classModal.addEventListener("click", (event) => {
      const closeBtn = event.target.closest("[data-close-students-modal]");
      if (closeBtn) {
        closeStudentsClassModal();
        return;
      }
      if (!requirePermission("manage_students")) return;
      const studentId = event.target.dataset.deleteStudent;
      if (studentId) {
        state.students = state.students.filter((student) => student.id !== studentId);
        state.grades = state.grades.filter((grade) => grade.studentId !== studentId);
        saveState();
        renderAll();
        return;
      }
      const moveStudentId = event.target.dataset.moveStudent;
      if (!moveStudentId) return;
      const student = state.students.find((item) => item.id === moveStudentId);
      if (!student) return;
      const row = event.target.closest(".student-modal-row");
      const select = row?.querySelector(`[data-move-student-select]`);
      const targetClass = select?.value?.trim();
      if (!targetClass || targetClass === student.className) return;
      ensureClassExists(targetClass);
      student.className = targetClass;
      saveState();
      renderAll();
      if (state.studentsModalClass && !state.students.some((s) => s.className === state.studentsModalClass)) {
        closeStudentsClassModal();
      } else if (!classModal.classList.contains("hidden")) {
        renderStudentsClassModal();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStudentsClassModal();
    }
  });
}

function setupGradesHandlers() {
  const classSelect = document.getElementById("grades-journal-class");
  const dateModeSelect = document.getElementById("grades-journal-date-mode");
  const matrixWrap = document.getElementById("grades-journal-matrix-wrap");
  const menu = document.getElementById("grades-context-menu");

  if (classSelect) {
    classSelect.addEventListener("change", () => {
      state.gradesJournalClass = classSelect.value;
      saveState();
      renderGradesJournal();
    });
  }
  if (dateModeSelect) {
    dateModeSelect.addEventListener("change", () => {
      state.gradesJournalDateMode = dateModeSelect.value === "all" ? "all" : "week";
      saveState();
      renderGradesJournal();
    });
  }

  if (matrixWrap) {
    matrixWrap.addEventListener("click", (e) => {
      const cell = e.target.closest("td.grades-matrix-cell");
      if (!cell) return;
      setActiveGradesCell(cell, true);
      if (!hasPermission("manage_grades")) return;
      const studentId = cell.dataset.studentId;
      const lessonDate = cell.dataset.lessonDate;
      if (!studentId || !lessonDate) return;
      gradesContextTarget = { studentId, lessonDate };
      const rect = cell.getBoundingClientRect();
      showGradesContextMenu(rect.left + 8, rect.bottom + 6);
    });
    matrixWrap.addEventListener("contextmenu", (e) => {
      const cell = e.target.closest("td.grades-matrix-cell");
      if (!cell) return;
      setActiveGradesCell(cell, true);
      if (!hasPermission("manage_grades")) return;
      e.preventDefault();
      const studentId = cell.dataset.studentId;
      const lessonDate = cell.dataset.lessonDate;
      if (!studentId || !lessonDate) return;
      gradesContextTarget = { studentId, lessonDate };
      showGradesContextMenu(e.clientX, e.clientY);
    });
    matrixWrap.addEventListener("scroll", () => hideGradesContextMenu());
  }

  if (menu) {
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-grade-pick]");
      if (!btn || !gradesContextTarget) return;
      e.preventDefault();
      const raw = btn.getAttribute("data-grade-pick");
      const value = raw === "" || raw === null ? "" : raw;
      const { studentId, lessonDate } = gradesContextTarget;
      setGradeCell(studentId, lessonDate, value);
    });
  }

  document.addEventListener("click", (e) => {
    if (!menu || menu.classList.contains("hidden")) return;
    if (menu.contains(e.target)) return;
    hideGradesContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideGradesContextMenu();
      return;
    }
    if (!hasPermission("manage_grades")) return;
    const activeElement = document.activeElement;
    const isTypingContext = ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement?.tagName);
    if (isTypingContext && !activeElement?.classList?.contains("grades-matrix-cell")) return;
    const hasMatrix = document.getElementById("grades-matrix-body")?.querySelector(".grades-matrix-cell");
    if (!hasMatrix) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveActiveGradesCell(0, -1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveActiveGradesCell(0, 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActiveGradesCell(-1, 0);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActiveGradesCell(1, 0);
      return;
    }

    const nextGrade = pickGradeByKeyboard(e);
    if (nextGrade === null) return;
    const cell = findGradesCellByTarget(gradesActiveTarget);
    if (!cell) return;
    e.preventDefault();
    const studentId = cell.dataset.studentId;
    const lessonDate = cell.dataset.lessonDate;
    if (!studentId || !lessonDate) return;
    setGradeCell(studentId, lessonDate, nextGrade);
    const refreshedCell = findGradesCellByTarget({ studentId, lessonDate });
    if (refreshedCell) setActiveGradesCell(refreshedCell, true);
  });
}

function setupScheduleHandlers() {
  const form = document.getElementById("schedule-form");
  const settingsForm = document.getElementById("schedule-settings-form");
  const firstLessonStartInput = document.getElementById("schedule-first-lesson-start");
  const lessonDurationSelect = document.getElementById("schedule-lesson-duration");
  const breakDurationInput = document.getElementById("schedule-break-duration");
  const lessonNumberInput = document.getElementById("schedule-lesson-number");

  const syncSettingsForm = () => {
    firstLessonStartInput.value = state.scheduleSettings.firstLessonStart;
    lessonDurationSelect.value = String(state.scheduleSettings.lessonDurationMin);
    breakDurationInput.value = String(Math.max(0, Number(state.scheduleSettings.breakDurationMin) || 10));
  };

  syncSettingsForm();

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_schedule")) return;
    const firstLessonStart = firstLessonStartInput.value;
    const lessonDurationMin = Number(lessonDurationSelect.value);
    const breakDurationMin = Number(breakDurationInput.value);
    if (!firstLessonStart || ![40, 45, 90].includes(lessonDurationMin) || !Number.isInteger(breakDurationMin) || breakDurationMin < 0 || breakDurationMin > 60) {
      notifyUser("Проверьте настройки расписания.", "warning");
      return;
    }
    state.scheduleSettings = {
      ...state.scheduleSettings,
      firstLessonStart,
      lessonDurationMin,
      breakDurationMin
    };
    const changedCount = recalculateScheduleTimes();
    saveState();
    renderSchedule();
    renderHomeSchedule();
    renderHomeDashboard();
    if (changedCount > 0) {
      notifyUser(`Настройки сохранены. Пересчитано уроков: ${changedCount}.`, "success");
      return;
    }
    notifyUser("Настройки конструктора расписания сохранены.", "success");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_schedule")) return;
    const day = document.getElementById("schedule-day").value;
    const lessonNumber = Number(lessonNumberInput.value);
    const timeRange = calculateLessonTime(lessonNumber);
    const start = timeRange?.start || "";
    const end = timeRange?.end || "";
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
    const savedDay = day;
    const nextLessonNumber = String(lessonNumber + 1);
    const savedClassName = className;
    const savedRoom = room;
    form.reset();
    document.getElementById("schedule-day").value = savedDay;
    document.getElementById("schedule-lesson-number").value = nextLessonNumber;
    document.getElementById("schedule-class").value = savedClassName;
    document.getElementById("schedule-room").value = savedRoom;
    saveState();
    renderSchedule();
    renderHomeSchedule();
    renderHomeDashboard();
  });
  document.getElementById("schedule-table-body").addEventListener("click", (event) => {
    if (!requirePermission("manage_schedule")) return;
    const entryId = event.target.dataset.deleteSchedule;
    if (!entryId) return;
    state.schedule = state.schedule.filter((entry) => entry.id !== entryId);
    saveState();
    renderSchedule();
    renderHomeSchedule();
    renderHomeDashboard();
  });
}

function setupComputersHandlers() {
  const form = document.getElementById("student-computer-form");
  const numberFilterInput = document.getElementById("student-computer-number-filter");
  const cardsWrap = document.getElementById("student-computers-cards");
  const modal = document.getElementById("student-computer-modal");
  if (!form || !numberFilterInput || !cardsWrap || !modal) return;
  window.__teachaxoRemote = {
    fetchFrame: (computerNumber) => requestComputerFrame(computerNumber),
    sendInput: (computerNumber, payload) => sendComputerRemoteInput(computerNumber, payload)
  };

  const syncConnections = async () => {
    try {
      const response = await window.teachAxo?.getComputerConnections?.();
      state.connectedComputers = Array.isArray(response?.items) ? response.items : [];
      const changed = syncDiscoveredComputersIntoState();
      if (changed) saveState();
      renderComputers();
    } catch (_error) {}
  };
  const syncServerConfig = async () => {
    try {
      const response = await window.teachAxo?.getComputerServerConfig?.();
      const port = Number(response?.port);
      if (Number.isInteger(port) && port > 0) state.computerServerPort = port;
      renderComputers();
    } catch (_error) {}
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("manage_computers")) return;
    const computerNumberRaw = document.getElementById("student-computer-number").value.trim();
    const computerName = document.getElementById("student-computer-name").value.trim();
    const ipAddress = document.getElementById("student-computer-ip").value.trim();
    const note = document.getElementById("student-computer-note").value.trim();
    if (!/^\d+$/.test(computerNumberRaw) || Number(computerNumberRaw) < 1 || !computerName) {
      notifyUser("Укажите корректный номер компьютера и имя.", "warning");
      return;
    }
    const duplicateNumber = state.studentComputers.some(
      (item) => String(item.computerNumber || "") === computerNumberRaw
    );
    if (duplicateNumber) {
      notifyUser("Компьютер с таким номером уже существует.", "warning");
      return;
    }
    state.studentComputers.push({
      id: uid(),
      computerNumber: computerNumberRaw,
      computerName,
      ipAddress,
      note,
      status: "online"
    });
    form.reset();
    saveState();
    renderComputers();
    notifyUser("Компьютер добавлен.", "success");
  });

  numberFilterInput.addEventListener("input", () => {
    state.studentComputersNumberFilter = numberFilterInput.value.trim();
    saveState();
    renderComputers();
  });

  const runComputerAction = async (event) => {
    if (!requirePermission("manage_computers")) return;
    const trigger = event.target.closest("[data-computer-action],[data-delete-computer]");
    if (!trigger) return;
    const computerId = trigger.dataset.computerId || trigger.dataset.deleteComputer;
    if (!computerId) return;
    const computer = state.studentComputers.find((item) => item.id === computerId);
    if (!computer) return;

    const deleteId = trigger.dataset.deleteComputer;
    if (deleteId) {
      state.studentComputers = state.studentComputers.filter((item) => item.id !== deleteId);
      state.computerCommandLog = state.computerCommandLog.filter((entry) => entry.computerId !== deleteId);
      saveState();
      renderComputers();
      notifyUser("Компьютер удален.", "success");
      return;
    }

    const actionKey = trigger.dataset.computerAction;
    if (!actionKey) return;
    if (actionKey === "screen_view") {
      openComputerStreamWindow(computer, "view");
      return;
    }
    if (actionKey === "remote_control") {
      openComputerStreamWindow(computer, "control");
      return;
    }
    if (actionKey === "disable_management") {
      const confirmDisable = window.confirm(
        "Отключить этот компьютер от управления? Агент завершится и будет удален из автозапуска."
      );
      if (!confirmDisable) {
        notifyUser("Операция отменена.", "warning");
        return;
      }
    }
    const actionLabels = {
      check_connection: "Проверка подключения",
      disable_management: "Отключение от управления",
      shutdown: "Выключение",
      restart: "Перезагрузка",
      remote_control: "Удаленное управление",
      lock: "Блокировка",
      unlock: "Разблокировка",
      start_app: "Запуск приложения",
      close_app: "Закрытие приложения",
      screen_view: "Просмотр экрана",
      deny_app_launch: "Запрет запуска приложений",
      group_policy: "Редактор групповых политик"
    };
    const payloadData = buildComputerActionPayload(actionKey);
    if (payloadData === null) {
      notifyUser("Команда отменена.", "warning");
      return;
    }
    const response = await window.teachAxo?.sendComputerCommand?.({
      computerNumber: computer.computerNumber,
      action: actionKey,
      data: payloadData
    });
    const ok = Boolean(response?.ok);
    state.computerCommandLog.push({
      id: uid(),
      computerId,
      computerName: computer.computerName,
      command: actionLabels[actionKey] || actionKey,
      note: ok ? String(response?.output || "Команда выполнена.") : String(response?.error || "Команда не выполнена."),
      timestamp: new Date().toISOString()
    });
    saveState();
    renderComputers();
    notifyUser(
      ok
        ? `Команда «${actionLabels[actionKey] || actionKey}» выполнена.`
        : `Команда «${actionLabels[actionKey] || actionKey}» не выполнена: ${response?.error || "нет ответа"}.`,
      ok ? "success" : "warning"
    );
  };

  cardsWrap.addEventListener("click", async (event) => {
    const actionBtn = event.target.closest("[data-computer-action]");
    if (actionBtn) {
      event.preventDefault();
      event.stopPropagation();
      await runComputerAction(event);
      return;
    }
    const card = event.target.closest("[data-open-computer-modal]");
    if (!card) return;
    state.studentComputersModalId = card.dataset.openComputerModal || "";
    renderComputerModal();
  });

  modal.addEventListener("click", async (event) => {
    const closeBtn = event.target.closest("[data-close-computer-modal]");
    if (closeBtn) {
      state.studentComputersModalId = "";
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      return;
    }
    const actionBtn = event.target.closest("[data-computer-action],[data-delete-computer]");
    if (!actionBtn) return;
    await runComputerAction(event);
    renderComputerModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (modal.classList.contains("hidden")) return;
    state.studentComputersModalId = "";
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  });
  window.teachAxo?.onComputerConnectionsChanged?.((payload) => {
    state.connectedComputers = Array.isArray(payload?.items) ? payload.items : [];
    const changed = syncDiscoveredComputersIntoState();
    if (changed) saveState();
    renderComputers();
    scheduleSharedFolderSync();
  });
  syncServerConfig();
  syncConnections();
  scheduleSharedFolderSync();
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
  const headerThemeToggle = document.getElementById("theme-toggle-button");
  if (headerThemeToggle) {
    headerThemeToggle.addEventListener("click", async () => {
      const nextTheme = getActiveThemeForUi() === "dark" ? "light" : "dark";
      setUserThemePreference(nextTheme);
      updateThemeToggleButton();
      try {
        await window.teachAxo?.applyUiConfig?.({ iconPath: state.uiConfig.iconPath, theme: nextTheme });
      } catch (error) {
        notifyUser(`Не удалось сохранить тему: ${error.message}`, "error");
      }
    });
  }

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
      updateThemeToggleButton();
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
    const grouped = new Map();
    state.students.forEach((student) => {
      const className = String(student.className || "Без класса").trim() || "Без класса";
      if (!grouped.has(className)) grouped.set(className, []);
      grouped.get(className).push(student);
    });
    const classNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "ru"));
    const blocks = classNames
      .map((className, index) => {
        const rows = (grouped.get(className) || [])
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map(
            (s) =>
              `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.notes || "-")}</td></tr>`
          )
          .join("");
        const pageBreak = index < classNames.length - 1 ? ' style="page-break-after: always;"' : "";
        return `<section${pageBreak}>
          <h2>Класс: ${escapeHtml(className)}</h2>
          <table>
            <thead><tr><th>ФИО</th><th>Комментарий</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
      })
      .join("");
    const fallback = '<p>Список учеников пуст.</p>';
    printHtml(
      "TeachAxo - Список учеников",
      blocks || fallback
    );
  });

  document.getElementById("print-schedule").addEventListener("click", () => {
    const sorted = [...state.schedule].sort((a, b) => {
      const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
      return dayDiff !== 0 ? dayDiff : a.start.localeCompare(b.start);
    });
    const rows = sorted
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.day)}</td><td>${escapeHtml(
            s.start
          )} - ${escapeHtml(s.end)}</td><td>${escapeHtml(s.className)}</td><td>${escapeHtml(s.subject)}</td><td>${escapeHtml(
            s.room || "-"
          )}</td><td>${escapeHtml(s.notes || "-")}</td></tr>`
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
  if (!Array.isArray(state.subjects)) state.subjects = [];
  state.schedule.forEach((entry) => {
    const subjectName = String(entry?.subject || "").trim();
    if (!subjectName) return;
    const exists = state.subjects.some((item) => String(item.name || "").toLowerCase() === subjectName.toLowerCase());
    if (!exists) state.subjects.push({ id: uid(), name: subjectName });
  });
  seedAccessData();
  syncAdministratorPermissions();
  state.students.forEach((student) => ensureClassExists(student.className));
  saveState();
  setupNav();
  setupWindowControls();
  setupClassesHandlers();
  setupSubjectsHandlers();
  setupStudentHandlers();
  setupGradesHandlers();
  setupScheduleHandlers();
  setupComputersHandlers();
  setupSharedFoldersHandlers();
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
