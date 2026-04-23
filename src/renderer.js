const STORAGE_KEY = "teachaxo_data_v2";

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
  roles: [],
  users: [],
  currentUserId: null,
  searchQuery: "",
  classSearchQuery: ""
};

const dayOrder = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

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

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.classes = Array.isArray(parsed.classes) ? parsed.classes : [];
    state.students = Array.isArray(parsed.students) ? parsed.students : [];
    state.grades = Array.isArray(parsed.grades) ? parsed.grades : [];
    state.schedule = Array.isArray(parsed.schedule) ? parsed.schedule : [];
    state.scheduleSettings = {
      firstLessonStart: parsed.scheduleSettings?.firstLessonStart || "08:00",
      lessonDurationMin: Number(parsed.scheduleSettings?.lessonDurationMin) || 45
    };
    state.roles = Array.isArray(parsed.roles) ? parsed.roles : [];
    state.users = Array.isArray(parsed.users) ? parsed.users : [];
    state.currentUserId = parsed.currentUserId ?? null;
  } catch (error) {
    console.error("Не удалось прочитать данные TeachAxo:", error);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      classes: state.classes,
      students: state.students,
      grades: state.grades,
      schedule: state.schedule,
      scheduleSettings: state.scheduleSettings,
      roles: state.roles,
      users: state.users,
      currentUserId: state.currentUserId
    })
  );
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
  const appVersion = window.teachAxo?.appVersion || "-";
  const buildVersion = window.teachAxo?.buildVersion || appVersion;

  document.getElementById("settings-app-version").textContent = appVersion;
  document.getElementById("settings-build-version").textContent = buildVersion;
  document.getElementById("settings-current-user").textContent = currentUser?.username || "-";
  document.getElementById("settings-current-role").textContent = currentRole?.name || "Без роли";
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
    const user = state.users.find(
      (candidate) => candidate.username.toLowerCase() === username && candidate.password === password
    );
    if (!user) {
      loginError.textContent = "Неверный логин или пароль.";
      loginError.classList.remove("hidden");
      return;
    }
    state.currentUserId = user.id;
    saveState();
    showApp();
  });

  document.getElementById("logout-button").addEventListener("click", () => {
    state.currentUserId = null;
    saveState();
    showLogin();
  });

  if (getCurrentUser()) showApp();
  else showLogin();
}

function init() {
  if (window.teachAxo) {
    const appVersion = window.teachAxo.appVersion || "0.0.0";
    const buildVersion = window.teachAxo.buildVersion || appVersion;
    const versionLabel = buildVersion === appVersion ? appVersion : `${appVersion} (build ${buildVersion})`;
    document.getElementById("app-version").textContent = versionLabel;
  }
  loadState();
  seedAccessData();
  state.students.forEach((student) => ensureClassExists(student.className));
  saveState();
  setupNav();
  setupClassesHandlers();
  setupStudentHandlers();
  setupGradesHandlers();
  setupScheduleHandlers();
  setupAccessHandlers();
  setupPrintHandlers();
  setupAuthHandlers();
}

init();
