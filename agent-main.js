const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage } = require("electron");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { exec, spawn } = require("node:child_process");

const AUTOSTART_TASK_NAME_ONLOGON = "TeachAxoStudentAgentOnLogon";
const AUTOSTART_TASK_NAME_WATCHDOG = "TeachAxoStudentAgentWatchdog";
const AUTORUN_REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTORUN_REG_VALUE = "TeachAxoStudentAgent";
const EMBEDDED_CONFIG = Object.freeze({
  // Defaults for first launch.
  host: "192.168.1.20",
  port: 46811,
  computerNumber: "1"
});
const AGENT_DIR = path.join(app.getPath("appData"), "TeachAxoStudentAgent");
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");

let tray = null;
let socket = null;
let reconnectTimer = null;
let connected = false;
let connectionState = "disconnected";
let shouldReconnect = true;
let registeredComputerNumber = "";
let settingsWindow = null;
let runtimeSettings = null;
let updateTimer = null;
let sharedFolderWindow = null;
let updateInProgress = false;
let updateStatusText = "";
let updateUiState = {
  state: "idle",
  message: "Проверка обновлений не запускалась.",
  progress: 0
};

const GITHUB_OWNER = "axobeasty";
const GITHUB_REPO = "TeachAxo";
const AGENT_SETUP_PREFIX = "TeachAxo Agent Setup ";
const AGENT_TAG_PREFIX = "agent-v";
const SHARED_FOLDER_SHORTCUT_NAME = "Общая папка.lnk";
const SHARED_FOLDER_DATA_PATH = path.join(AGENT_DIR, "shared-folder.json");

function ensureAgentDir() {
  if (!fs.existsSync(AGENT_DIR)) fs.mkdirSync(AGENT_DIR, { recursive: true });
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ""), String(salt || ""), 120000, 32, "sha256").toString("hex");
}

function getDefaultSettings() {
  return {
    host: String(EMBEDDED_CONFIG.host || "").trim(),
    port: Number(EMBEDDED_CONFIG.port || 46811),
    computerNumber: String(EMBEDDED_CONFIG.computerNumber || "").trim(),
    passwordSalt: "",
    passwordHash: ""
  };
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return getDefaultSettings();
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      host: String(parsed?.host || EMBEDDED_CONFIG.host || "").trim(),
      port: Number(parsed?.port || EMBEDDED_CONFIG.port || 46811),
      computerNumber: String(parsed?.computerNumber || EMBEDDED_CONFIG.computerNumber || "").trim(),
      passwordSalt: String(parsed?.passwordSalt || ""),
      passwordHash: String(parsed?.passwordHash || "")
    };
  } catch (_error) {
    return getDefaultSettings();
  }
}

function saveSettings(settings) {
  ensureAgentDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

function loadSharedFolderData() {
  try {
    if (!fs.existsSync(SHARED_FOLDER_DATA_PATH)) return { classes: [], schedule: [], showAll: false, generatedAt: "" };
    const raw = fs.readFileSync(SHARED_FOLDER_DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const classes = Array.isArray(parsed?.classes)
      ? parsed.classes
          .map((item) => ({
            className: String(item?.className || "").trim(),
            students: Array.isArray(item?.students)
              ? item.students.map((name) => String(name || "").trim()).filter(Boolean)
              : []
          }))
          .filter((item) => item.className)
      : [];
    const schedule = Array.isArray(parsed?.schedule)
      ? parsed.schedule
          .map((entry) => ({
            day: String(entry?.day || "").trim(),
            start: String(entry?.start || "").trim(),
            end: String(entry?.end || "").trim(),
            className: String(entry?.className || "").trim()
          }))
          .filter((entry) => entry.day && entry.start && entry.end && entry.className)
      : [];
    return { classes, schedule, showAll: Boolean(parsed?.showAll), generatedAt: String(parsed?.generatedAt || "") };
  } catch (_error) {
    return { classes: [], schedule: [], showAll: false, generatedAt: "" };
  }
}

function saveSharedFolderData(payload) {
  const classes = Array.isArray(payload?.classes)
    ? payload.classes
        .map((item) => ({
          className: String(item?.className || "").trim(),
          students: Array.isArray(item?.students)
            ? [...new Set(item.students.map((name) => String(name || "").trim()).filter(Boolean))]
            : []
        }))
        .filter((item) => item.className)
    : [];
  const next = {
    classes,
    schedule: Array.isArray(payload?.schedule)
      ? payload.schedule
          .map((entry) => ({
            day: String(entry?.day || "").trim(),
            start: String(entry?.start || "").trim(),
            end: String(entry?.end || "").trim(),
            className: String(entry?.className || "").trim()
          }))
          .filter((entry) => entry.day && entry.start && entry.end && entry.className)
      : [],
    showAll: Boolean(payload?.showAll),
    generatedAt: String(payload?.generatedAt || new Date().toISOString())
  };
  ensureAgentDir();
  fs.writeFileSync(SHARED_FOLDER_DATA_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function psEscape(value) {
  return String(value || "").replace(/'/g, "''");
}

function ensureSharedFolderShortcut() {
  return new Promise((resolve) => {
    const desktopPath = app.getPath("desktop");
    const linkPath = path.join(desktopPath, SHARED_FOLDER_SHORTCUT_NAME);
    const target = process.execPath;
    const command = [
      "$ws = New-Object -ComObject WScript.Shell;",
      `$sc = $ws.CreateShortcut('${psEscape(linkPath)}');`,
      `$sc.TargetPath = '${psEscape(target)}';`,
      "$sc.Arguments = '--open-shared-folder';",
      `$sc.WorkingDirectory = '${psEscape(path.dirname(target))}';`,
      `$sc.IconLocation = '${psEscape(target)},0';`,
      "$sc.Save();"
    ].join(" ");
    exec(`powershell -NoProfile -Command "${command}"`, { windowsHide: true }, () => resolve(linkPath));
  });
}

function hasOpenSharedFolderArg(argv) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || "").toLowerCase() === "--open-shared-folder");
}

function sharedFolderHtml(data) {
  const classesJson = JSON.stringify(data?.classes || []);
  const scheduleJson = JSON.stringify(data?.schedule || []);
  const showAll = Boolean(data?.showAll);
  const generatedAt = String(data?.generatedAt || "");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Общая папка</title>
<style>
body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e5e7eb}
.bar{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#111827;border-bottom:1px solid #334155}
.title{font-size:16px;font-weight:600}
.meta{font-size:12px;opacity:.8}
.toolbar{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #334155}
button{border:none;border-radius:8px;padding:6px 10px;background:#2563eb;color:#fff;cursor:pointer}
button:disabled{opacity:.45;cursor:default}
.path{font-size:13px;opacity:.85}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:14px}
.item{background:#111827;border:1px solid #334155;border-radius:10px;padding:10px;cursor:pointer}
.item:hover{border-color:#60a5fa}
.name{font-weight:600}
.sub{font-size:12px;opacity:.8;margin-top:4px}
.empty{padding:16px 14px;opacity:.85}
</style></head><body>
<div class="bar"><div class="title">Общая папка TeachAxo</div><div class="meta">${
    generatedAt ? `Синхронизация: ${generatedAt}` : "Нет данных синхронизации"
  }</div></div>
<div class="toolbar"><button id="back-btn" type="button">Назад</button><div class="path" id="path-node">Общая папка</div></div>
<div id="content"></div>
<script>
const classes = ${classesJson};
const schedule = ${scheduleJson};
const showAll = ${showAll ? "true" : "false"};
let currentClass = "";
const content = document.getElementById("content");
const pathNode = document.getElementById("path-node");
const backBtn = document.getElementById("back-btn");
function toMin(v){ const p=String(v||"").split(":"); const h=Number(p[0]); const m=Number(p[1]); if(!Number.isFinite(h)||!Number.isFinite(m)) return -1; return h*60+m; }
function getDayName(now){ return ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"][now.getDay()] || ""; }
function getAvailableClassNamesNow(){
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  const dayName = getDayName(now);
  const set = new Set();
  schedule.forEach((entry)=>{
    if(String(entry.day||"") !== dayName) return;
    const start = toMin(entry.start);
    const end = toMin(entry.end);
    if(start < 0 || end < 0) return;
    if(nowMin >= start && nowMin < end) set.add(String(entry.className||""));
  });
  return set;
}
function esc(v){return String(v||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
function renderClasses(){
  currentClass = "";
  backBtn.disabled = true;
  pathNode.textContent = "Общая папка";
  if(!classes.length){ content.innerHTML = '<div class="empty">Папки классов пока не созданы. Выполните настройку из TeachAxo.</div>'; return; }
  const allowed = getAvailableClassNamesNow();
  const visible = showAll ? classes : classes.filter((item)=>allowed.has(String(item.className||"")));
  if(!visible.length){ content.innerHTML = '<div class="empty">Сейчас по расписанию в кабинете нет активного класса.</div>'; return; }
  content.innerHTML = '<div class="grid">' + visible.map((item, idx)=>'<div class="item" data-open-class="'+idx+'"><div class="name">📁 '+esc(item.className)+'</div><div class="sub">Учеников: '+((item.students||[]).length)+'</div></div>').join("") + '</div>';
  window.__visibleClasses = visible;
}
function renderStudents(classItem){
  currentClass = String(classItem.className||"");
  backBtn.disabled = false;
  pathNode.textContent = "Общая папка / " + currentClass;
  const students = Array.isArray(classItem.students)?classItem.students:[];
  if(!students.length){ content.innerHTML = '<div class="empty">В этом классе нет папок учеников.</div>'; return; }
  content.innerHTML = '<div class="grid">' + students.map((name)=>'<div class="item"><div class="name">📁 '+esc(name)+'</div><div class="sub">Личная папка ученика</div></div>').join("") + '</div>';
}
content.addEventListener("click",(event)=>{ const tile = event.target.closest("[data-open-class]"); if(!tile) return; const idx = Number(tile.getAttribute("data-open-class")); const visible = Array.isArray(window.__visibleClasses)?window.__visibleClasses:[]; if(!Number.isInteger(idx) || idx < 0 || idx >= visible.length) return; renderStudents(visible[idx]); });
backBtn.addEventListener("click", renderClasses);
renderClasses();
</script></body></html>`;
}

function openSharedFolderWindow() {
  const data = loadSharedFolderData();
  if (sharedFolderWindow && !sharedFolderWindow.isDestroyed()) {
    sharedFolderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(sharedFolderHtml(data))}`);
    sharedFolderWindow.show();
    sharedFolderWindow.focus();
    return;
  }
  sharedFolderWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: "Общая папка TeachAxo",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  sharedFolderWindow.on("closed", () => {
    sharedFolderWindow = null;
  });
  sharedFolderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(sharedFolderHtml(data))}`);
}

function installAutostartTasks() {
  const exePath = process.execPath;
  const quotedExe = `"${exePath}"`;
  const trValue = `\\"${exePath}\\"`;
  const onLogonCommand = `schtasks /Create /TN "${AUTOSTART_TASK_NAME_ONLOGON}" /TR "${trValue}" /SC ONLOGON /RL LIMITED /F`;
  const watchdogCommand = `schtasks /Create /TN "${AUTOSTART_TASK_NAME_WATCHDOG}" /TR "${trValue}" /SC MINUTE /MO 1 /F`;
  const regCommand = `reg add "${AUTORUN_REG_KEY}" /v "${AUTORUN_REG_VALUE}" /t REG_SZ /d "${quotedExe}" /f`;
  exec(onLogonCommand, { windowsHide: true }, () => {});
  exec(watchdogCommand, { windowsHide: true }, () => {});
  exec(regCommand, { windowsHide: true }, () => {});
}

function removeAutostartTasks() {
  const deleteOnLogon = `schtasks /Delete /TN "${AUTOSTART_TASK_NAME_ONLOGON}" /F`;
  const deleteWatchdog = `schtasks /Delete /TN "${AUTOSTART_TASK_NAME_WATCHDOG}" /F`;
  const deleteReg = `reg delete "${AUTORUN_REG_KEY}" /v "${AUTORUN_REG_VALUE}" /f`;
  exec(deleteOnLogon, { windowsHide: true }, () => {});
  exec(deleteWatchdog, { windowsHide: true }, () => {});
  exec(deleteReg, { windowsHide: true }, () => {});
}

function makeTrayIcon() {
  const colorMap = {
    connected: "#22c55e",
    connecting: "#facc15",
    disconnected: "#ef4444"
  };
  const color = colorMap[connectionState] || colorMap.disconnected;
  // Pure vector icon (SVG): no PNG dependency.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="24" fill="${color}" stroke="#0f172a" stroke-width="5"/>
    <circle cx="24" cy="24" r="6" fill="rgba(255,255,255,0.35)"/>
  </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
  return image.resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;
  const statusLabel = connected ? "Подключено" : connectionState === "connecting" ? "Подключение..." : "Не подключено";
  const suffix = updateStatusText ? ` • ${updateStatusText}` : "";
  tray.setImage(makeTrayIcon());
  tray.setToolTip(`TeachAxo Agent — ${statusLabel}${suffix}`);
  const menu = Menu.buildFromTemplate([
    { label: `TeachAxo Agent: ${statusLabel}`, enabled: false },
    {
      label: "Настройки (пароль)",
      click: () => {
        openSettingsWindow(false);
      }
    },
    { label: "Управление защищено администратором", enabled: false }
  ]);
  tray.setContextMenu(menu);
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[^\d.]/)[0];
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a)
    .split(".")
    .map((n) => Number(n) || 0);
  const pb = normalizeVersion(b)
    .split(".")
    .map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function isSelfSignedTlsError(error) {
  const code = String(error?.code || "").toUpperCase();
  const text = String(error?.message || "").toLowerCase();
  return (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_GET_ISSUER_CERT" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code === "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED" ||
    code === "ERR_OSSL_X509_KEY_VALUES_MISMATCH" ||
    text.includes("self signed certificate") ||
    text.includes("certificate")
  );
}

function httpsGetJson(url, options = {}) {
  const allowInsecureTls = Boolean(options.allowInsecureTls);
  const redirectCount = Number(options.redirectCount || 0);
  const maxRedirects = 5;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        rejectUnauthorized: !allowInsecureTls,
        headers: {
          "User-Agent": "TeachAxo-Agent-Updater",
          Accept: "application/vnd.github+json"
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error("Слишком много редиректов при проверке обновления."));
            res.resume();
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          httpsGetJson(nextUrl, { allowInsecureTls, redirectCount: redirectCount + 1 })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", (error) => {
      if (!allowInsecureTls && isSelfSignedTlsError(error)) {
        httpsGetJson(url, { allowInsecureTls: true }).then(resolve).catch(reject);
        return;
      }
      reject(error);
    });
  });
}

function setUpdateUiState(next) {
  updateUiState = {
    ...updateUiState,
    ...next
  };
}

function isRetryableNetworkError(error) {
  const code = String(error?.code || "").toUpperCase();
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE"
  );
}

async function withRetry(task, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 1));
  const baseDelayMs = Math.max(200, Number(options.baseDelayMs || 800));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (!(isRetryableNetworkError(error) || isSelfSignedTlsError(error))) break;
      const delay = baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error("Не удалось выполнить сетевую операцию.");
}

function getUrlMeta(url, options = {}) {
  const allowInsecureTls = Boolean(options.allowInsecureTls);
  const redirectCount = Number(options.redirectCount || 0);
  const maxRedirects = 8;
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "HEAD",
        rejectUnauthorized: !allowInsecureTls,
        headers: { "User-Agent": "TeachAxo-Agent-Updater" }
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error("Слишком много редиректов при загрузке обновления."));
            response.resume();
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          getUrlMeta(nextUrl, { allowInsecureTls, redirectCount: redirectCount + 1 }).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Статус HEAD-запроса: ${response.statusCode}`));
          response.resume();
          return;
        }
        resolve({
          url,
          total: Number(response.headers["content-length"] || 0),
          acceptsRanges: String(response.headers["accept-ranges"] || "")
            .toLowerCase()
            .includes("bytes")
        });
        response.resume();
      }
    );
    request.on("error", (error) => {
      if (!allowInsecureTls && isSelfSignedTlsError(error)) {
        getUrlMeta(url, { allowInsecureTls: true, redirectCount }).then(resolve).catch(reject);
        return;
      }
      reject(error);
    });
    request.end();
  });
}

function downloadFileSingle(url, destinationPath, onProgress, options = {}) {
  const allowInsecureTls = Boolean(options.allowInsecureTls);
  const redirectCount = Number(options.redirectCount || 0);
  const maxRedirects = 8;
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        rejectUnauthorized: !allowInsecureTls,
        headers: { "User-Agent": "TeachAxo-Agent-Updater" }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error("Слишком много редиректов при скачивании обновления."));
            res.resume();
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          downloadFileSingle(nextUrl, destinationPath, onProgress, { allowInsecureTls, redirectCount: redirectCount + 1 })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Статус скачивания: ${res.statusCode}`));
          res.resume();
          return;
        }
        const total = Number(res.headers["content-length"] || 0);
        let loaded = 0;
        const file = fs.createWriteStream(destinationPath);
        res.on("data", (chunk) => {
          loaded += chunk.length;
          if (total > 0 && onProgress) {
            const percent = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
            onProgress(percent);
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destinationPath)));
        file.on("error", reject);
      }
    );
    request.on("error", (error) => {
      if (!allowInsecureTls && isSelfSignedTlsError(error)) {
        downloadFileSingle(url, destinationPath, onProgress, { allowInsecureTls: true, redirectCount })
          .then(resolve)
          .catch(reject);
        return;
      }
      reject(error);
    });
  });
}

function downloadChunk(url, start, end, destinationPath, reportProgress, options = {}) {
  const allowInsecureTls = Boolean(options.allowInsecureTls);
  const redirectCount = Number(options.redirectCount || 0);
  const maxRedirects = 8;
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        rejectUnauthorized: !allowInsecureTls,
        headers: {
          "User-Agent": "TeachAxo-Agent-Updater",
          Range: `bytes=${start}-${end}`
        }
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error("Слишком много редиректов для chunk-загрузки."));
            response.resume();
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          downloadChunk(nextUrl, start, end, destinationPath, reportProgress, {
            allowInsecureTls,
            redirectCount: redirectCount + 1
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (response.statusCode !== 206) {
          reject(new Error(`Chunk download status: ${response.statusCode}`));
          response.resume();
          return;
        }
        const file = fs.createWriteStream(destinationPath, { flags: "r+", start });
        response.on("data", (chunk) => reportProgress(chunk.length));
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      }
    );
    request.on("error", (error) => {
      if (!allowInsecureTls && isSelfSignedTlsError(error)) {
        downloadChunk(url, start, end, destinationPath, reportProgress, { allowInsecureTls: true, redirectCount })
          .then(resolve)
          .catch(reject);
        return;
      }
      reject(error);
    });
  });
}

async function downloadFileWithProgress(url, destinationPath, onProgress) {
  const downloadTask = async () => {
    const meta = await withRetry(() => getUrlMeta(url), { attempts: 4, baseDelayMs: 900 });
    const total = Number(meta.total || 0);
    const canParallel = meta.acceptsRanges && total > 2 * 1024 * 1024;
    if (!canParallel) {
      await withRetry(() => downloadFileSingle(meta.url, destinationPath, onProgress), {
        attempts: 4,
        baseDelayMs: 1000
      });
      return destinationPath;
    }
    const cpuCount = os.cpus()?.length || 4;
    const streamCount = Math.max(4, Math.min(10, cpuCount * 2));
    const chunkSize = Math.ceil(total / streamCount);
    let loaded = 0;
    let lastReported = 0;
    fs.writeFileSync(destinationPath, Buffer.alloc(total));
    const reportProgress = (bytes) => {
      loaded += bytes;
      if (!onProgress || total <= 0) return;
      const percent = (loaded / total) * 100;
      if (percent - lastReported >= 0.5 || percent >= 100) {
        lastReported = percent;
        onProgress(Math.max(0, Math.min(100, Math.round(percent))));
      }
    };
    const tasks = [];
    for (let i = 0; i < streamCount; i += 1) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      if (start > end) continue;
      tasks.push(
        withRetry(() => downloadChunk(meta.url, start, end, destinationPath, reportProgress), {
          attempts: 4,
          baseDelayMs: 1000
        })
      );
    }
    await Promise.all(tasks);
    return destinationPath;
  };
  try {
    return await downloadTask();
  } catch (error) {
    fs.rm(destinationPath, { force: true }, () => {});
    throw error;
  }
}

async function checkAndInstallAgentUpdate() {
  if (!app.isPackaged || updateInProgress) return;
  updateInProgress = true;
  try {
    setUpdateUiState({ state: "checking", message: "Проверка обновлений...", progress: 0 });
    updateStatusText = "Проверка обновлений...";
    updateTray();
    const releases = await withRetry(
      () => httpsGetJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`),
      { attempts: 4, baseDelayMs: 900 }
    );
    const releaseList = Array.isArray(releases) ? releases : [];
    const agentRelease =
      releaseList.find(
        (item) =>
          !item?.draft &&
          !item?.prerelease &&
          String(item?.tag_name || "")
            .toLowerCase()
            .startsWith(AGENT_TAG_PREFIX)
      ) || null;
    if (!agentRelease) {
      setUpdateUiState({ state: "idle", message: "Релизы агента не найдены.", progress: 0 });
      updateStatusText = "";
      updateTray();
      return;
    }
    const latestTag = String(agentRelease.tag_name || "");
    const latestVersion = normalizeVersion(latestTag.replace(/^agent-v/i, ""));
    const currentVersion = normalizeVersion(app.getVersion());
    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
      setUpdateUiState({ state: "up-to-date", message: "Установлена актуальная версия агента.", progress: 0 });
      updateStatusText = "";
      updateTray();
      return;
    }
    const assets = Array.isArray(agentRelease?.assets) ? agentRelease.assets : [];
    const setupAsset = assets.find(
      (asset) =>
        String(asset?.name || "").startsWith(AGENT_SETUP_PREFIX) &&
        String(asset?.name || "").toLowerCase().endsWith(".exe")
    );
    if (!setupAsset?.browser_download_url) {
      setUpdateUiState({ state: "error", message: "В релизе не найден установщик агента.", progress: 0 });
      updateStatusText = "";
      updateTray();
      return;
    }

    setUpdateUiState({ state: "downloading", message: `Загрузка обновления ${latestVersion}...`, progress: 0 });
    updateStatusText = `Обновление ${latestVersion}...`;
    updateTray();
    const tempPath = path.join(app.getPath("temp"), `TeachAxo-Agent-Setup-${latestVersion}.exe`);
    await downloadFileWithProgress(setupAsset.browser_download_url, tempPath, (progress) => {
      setUpdateUiState({
        state: "downloading",
        message: `Загрузка обновления ${latestVersion}: ${progress}%`,
        progress
      });
    });
    setUpdateUiState({ state: "installing", message: "Запуск установки обновления...", progress: 100 });
    const child = spawn(tempPath, [], { detached: true, stdio: "ignore" });
    child.unref();
    app.quit();
  } catch (error) {
    setUpdateUiState({
      state: "error",
      message: `Ошибка обновления: ${error.message}`,
      progress: 0
    });
    updateStatusText = "";
    updateTray();
  } finally {
    updateInProgress = false;
  }
}

function startAutoUpdateLoop() {
  checkAndInstallAgentUpdate().catch(() => {});
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(() => {
    checkAndInstallAgentUpdate().catch(() => {});
  }, 30 * 60 * 1000);
}

function scheduleReconnect() {
  if (!shouldReconnect) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToHost();
  }, 3000);
}

function disconnectSocket(schedule = true) {
  connected = false;
  connectionState = "disconnected";
  if (socket && !socket.destroyed) {
    socket.destroy();
  }
  socket = null;
  updateTray();
  if (schedule) scheduleReconnect();
}

async function runCommand(action, data) {
  if (action === "setup_shared_folder") {
    const saved = saveSharedFolderData(data || {});
    await ensureSharedFolderShortcut();
    return {
      ok: true,
      output: `Общая папка настроена. Классов: ${saved.classes.length}. Ярлык создан на рабочем столе.`
    };
  }
  if (action === "open_shared_folder") {
    openSharedFolderWindow();
    return { ok: true, output: "Окно общей папки открыто." };
  }
  if (action === "check_connection") {
    return { ok: true, output: `Связь установлена. Номер: ${registeredComputerNumber}` };
  }
  if (action === "disable_management") {
    return { ok: false, output: "Отключение агента разрешено только локально через настройки и пароль." };
  }
  if (action === "screen_frame") {
    const formatRaw = String(data?.format || "jpeg").toLowerCase();
    const useJpeg = formatRaw === "jpeg" || formatRaw === "jpg";
    const quality = Math.max(20, Math.min(90, Number(data?.quality) || 45));
    const scale = Math.max(0.25, Math.min(1, Number(data?.scale) || 0.5));
    const imageFormat = useJpeg ? "Jpeg" : "Png";
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      `$w = [int]($bounds.Width * ${scale.toFixed(3)});`,
      `$h = [int]($bounds.Height * ${scale.toFixed(3)});`,
      "if ($w -lt 1) { $w = 1 }",
      "if ($h -lt 1) { $h = 1 }",
      "$bmp = New-Object System.Drawing.Bitmap $w, $h;",
      "$graphics = [System.Drawing.Graphics]::FromImage($bmp);",
      "$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighSpeed;",
      "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, [System.Drawing.Size]::new($w, $h));",
      "$ms = New-Object System.IO.MemoryStream;",
      `$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatDescription -eq "${imageFormat}" };`,
      "$ep = New-Object System.Drawing.Imaging.EncoderParameters 1;",
      "$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]" + quality + ");",
      "$bmp.Save($ms, $enc, $ep);",
      "$graphics.Dispose();",
      "$bmp.Dispose();",
      "$bytes = $ms.ToArray();",
      "$ms.Dispose();",
      "[Convert]::ToBase64String($bytes)"
    ].join(" ");
    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -Command "${ps}"`,
        { windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, output: String(stderr || error.message || "").trim() });
            return;
          }
          resolve({ ok: true, output: String(stdout || "").trim() });
        }
      );
    });
  }
  if (action === "remote_input") {
    const type = String(data?.type || "");
    if (type === "key") {
      const key = String(data?.key || "").trim();
      if (!key) return { ok: false, output: "Не передана клавиша." };
      return new Promise((resolve) => {
        exec(
          `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${key.replace(/'/g, "''")}'); Write-Output 'ok'"`,
          { windowsHide: true, timeout: 120000 },
          (error, stdout, stderr) => {
            if (error) {
              resolve({ ok: false, output: String(stderr || error.message || "").trim() });
              return;
            }
            resolve({ ok: true, output: String(stdout || "").trim() });
          }
        );
      });
    }
    if (type === "click") {
      const x = Number(data?.x);
      const y = Number(data?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, output: "Некорректные координаты." };
      const xx = Math.max(0, Math.min(1, x));
      const yy = Math.max(0, Math.min(1, y));
      const ps = [
        "Add-Type @\"",
        "using System; using System.Runtime.InteropServices;",
        "public class NativeInput {",
        "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
        "  [DllImport(\"user32.dll\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);",
        "}",
        "\"@;",
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
        `$x = [int](${xx.toFixed(6)} * $b.Width);`,
        `$y = [int](${yy.toFixed(6)} * $b.Height);`,
        "[NativeInput]::SetCursorPos($x, $y) | Out-Null;",
        "[NativeInput]::mouse_event(2,0,0,0,0);",
        "[NativeInput]::mouse_event(4,0,0,0,0);",
        "Write-Output 'ok'"
      ].join(" ");
      return new Promise((resolve) => {
        exec(
          `powershell -NoProfile -Command "${ps}"`,
          { windowsHide: true, timeout: 120000 },
          (error, stdout, stderr) => {
            if (error) {
              resolve({ ok: false, output: String(stderr || error.message || "").trim() });
              return;
            }
            resolve({ ok: true, output: String(stdout || "").trim() });
          }
        );
      });
    }
    return { ok: false, output: "Неизвестный тип remote_input." };
  }
  return { ok: false, output: `Команда ${action} не поддерживается tray-агентом.` };
}

function connectToHost() {
  if (!runtimeSettings?.host || !runtimeSettings?.port || !runtimeSettings?.computerNumber) {
    connected = false;
    connectionState = "disconnected";
    updateTray();
    return;
  }
  connectionState = "connecting";
  connected = false;
  updateTray();
  let buffer = "";
  socket = net.createConnection({ host: runtimeSettings.host, port: runtimeSettings.port }, () => {
    registeredComputerNumber = runtimeSettings.computerNumber;
    socket.write(
      `${JSON.stringify({
        type: "register",
        computerNumber: runtimeSettings.computerNumber,
        hostname: os.hostname(),
        platform: process.platform
      })}\n`
    );
    connected = true;
    connectionState = "connected";
    updateTray();
  });
  socket.setEncoding("utf8");
  socket.on("data", async (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const raw of parts) {
      const line = String(raw || "").trim();
      if (!line) continue;
      let message = null;
      try {
        message = JSON.parse(line);
      } catch (_error) {
        continue;
      }
      if (message?.type !== "command") continue;
      const commandId = String(message?.commandId || "");
      const action = String(message?.action || "");
      const result = await runCommand(action, message?.data || {});
      socket.write(
        `${JSON.stringify({
          type: "command_result",
          commandId,
          ok: Boolean(result.ok),
          output: String(result.output || "")
        })}\n`
      );
    }
  });
  socket.on("error", () => disconnectSocket(true));
  socket.on("close", () => disconnectSocket(true));
}

function verifyPassword(password) {
  if (!runtimeSettings?.passwordHash || !runtimeSettings?.passwordSalt) return false;
  const hash = hashPassword(password, runtimeSettings.passwordSalt);
  return hash === runtimeSettings.passwordHash;
}

function settingsHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>TeachAxo Agent Settings</title>
<style>body{font-family:Segoe UI,Arial;padding:16px;background:#0f172a;color:#e5e7eb}input{width:100%;padding:8px;margin:6px 0 10px;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:6px}button{padding:8px 12px;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;margin-right:8px}.muted{font-size:12px;opacity:.8}.hidden{display:none}</style>
</head><body>
<h3>Настройки агента</h3>
<div id="setup-block" class="hidden">
  <p>Первичный запуск. Установите пароль администратора.</p>
  <input id="setup-password" type="password" placeholder="Новый пароль" />
  <input id="setup-password2" type="password" placeholder="Повторите пароль" />
  <button id="setup-save">Сохранить пароль</button>
</div>
<div id="auth-block" class="hidden">
  <p>Введите пароль для доступа к настройкам.</p>
  <input id="auth-password" type="password" placeholder="Пароль" />
  <button id="auth-open">Открыть настройки</button>
</div>
<div id="settings-block" class="hidden">
  <label>Текущая версия агента</label><input id="agent-version" type="text" readonly />
  <label>Host</label><input id="host" type="text" />
  <label>Port</label><input id="port" type="number" />
  <label>Номер компьютера</label><input id="number" type="text" />
  <button id="save-settings">Сохранить</button>
  <button id="exit-agent">Выключить агент</button>
  <div style="margin-top:10px;padding-top:10px;border-top:1px solid #334155">
    <button id="check-updates">Проверить обновления</button>
    <div style="margin-top:8px;background:#1f2937;border-radius:6px;overflow:hidden;height:10px">
      <div id="update-progress-fill" style="width:0%;height:10px;background:#22c55e;transition:width .2s ease"></div>
    </div>
    <div id="update-status" class="muted" style="margin-top:6px">Проверка обновлений не запускалась.</div>
  </div>
  <p class="muted">Выключение доступно только с паролем.</p>
</div>
<p id="msg" class="muted"></p>
<script>
const { ipcRenderer } = require("electron");
const msg = document.getElementById("msg");
const setupBlock = document.getElementById("setup-block");
const authBlock = document.getElementById("auth-block");
const settingsBlock = document.getElementById("settings-block");
const updateStatusNode = document.getElementById("update-status");
const updateProgressFill = document.getElementById("update-progress-fill");
let authed = false;
ipcRenderer.invoke("agent:settings:get").then((s)=>{ if(!s.hasPassword){ setupBlock.classList.remove("hidden"); } else { authBlock.classList.remove("hidden"); }});
document.getElementById("setup-save").onclick = async ()=>{ const p1=document.getElementById("setup-password").value; const p2=document.getElementById("setup-password2").value; const r=await ipcRenderer.invoke("agent:settings:set-password",{password:p1,confirm:p2}); msg.textContent=r.message; if(r.ok){ setupBlock.classList.add("hidden"); authBlock.classList.remove("hidden"); }};
document.getElementById("auth-open").onclick = async ()=>{ const pass=document.getElementById("auth-password").value; const r=await ipcRenderer.invoke("agent:settings:auth",{password:pass}); msg.textContent=r.message; if(r.ok){ authed=true; authBlock.classList.add("hidden"); settingsBlock.classList.remove("hidden"); document.getElementById("agent-version").value=r.settings.agentVersion; document.getElementById("host").value=r.settings.host; document.getElementById("port").value=r.settings.port; document.getElementById("number").value=r.settings.computerNumber; }};
document.getElementById("save-settings").onclick = async ()=>{ if(!authed) return; const host=document.getElementById("host").value; const port=document.getElementById("port").value; const computerNumber=document.getElementById("number").value; const r=await ipcRenderer.invoke("agent:settings:save",{host,port,computerNumber}); msg.textContent=r.message; };
document.getElementById("exit-agent").onclick = async ()=>{ if(!authed) return; const pass=prompt("Введите пароль для выключения агента:",""); if(pass===null) return; const r=await ipcRenderer.invoke("agent:exit",{password:pass}); msg.textContent=r.message; };
document.getElementById("check-updates").onclick = async ()=>{ if(!authed) return; const r=await ipcRenderer.invoke("agent:update:check-now"); if(!r.ok){ msg.textContent=r.message; } };
setInterval(async ()=>{ if(!authed) return; const state=await ipcRenderer.invoke("agent:update:status"); updateStatusNode.textContent=state.message || ""; updateProgressFill.style.width = String(state.progress || 0) + "%"; }, 500);
</script></body></html>`;
}

function openSettingsWindow(forceInitialSetup) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 520,
    resizable: false,
    title: "TeachAxo Agent Settings",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(settingsHtml())}`);
  if (forceInitialSetup) settingsWindow.setAlwaysOnTop(true, "screen-saver");
}

function registerSettingsIpc() {
  ipcMain.handle("agent:settings:get", async () => ({
    hasPassword: Boolean(runtimeSettings.passwordHash && runtimeSettings.passwordSalt)
  }));
  ipcMain.handle("agent:settings:set-password", async (_event, payload) => {
    const password = String(payload?.password || "");
    const confirm = String(payload?.confirm || "");
    if (password.length < 4) return { ok: false, message: "Пароль должен быть не короче 4 символов." };
    if (password !== confirm) return { ok: false, message: "Пароли не совпадают." };
    const salt = crypto.randomBytes(16).toString("hex");
    runtimeSettings.passwordSalt = salt;
    runtimeSettings.passwordHash = hashPassword(password, salt);
    saveSettings(runtimeSettings);
    return { ok: true, message: "Пароль сохранен." };
  });
  ipcMain.handle("agent:settings:auth", async (_event, payload) => {
    if (!verifyPassword(payload?.password)) return { ok: false, message: "Неверный пароль." };
    return {
      ok: true,
      message: "Доступ разрешен.",
      settings: {
        agentVersion: app.getVersion(),
        host: runtimeSettings.host,
        port: runtimeSettings.port,
        computerNumber: runtimeSettings.computerNumber
      }
    };
  });
  ipcMain.handle("agent:settings:save", async (_event, payload) => {
    const host = String(payload?.host || "").trim();
    const port = Number(payload?.port);
    const computerNumber = String(payload?.computerNumber || "").trim();
    if (!host || !Number.isInteger(port) || port <= 0 || !/^\d+$/.test(computerNumber)) {
      return { ok: false, message: "Проверьте host/port/номер компьютера." };
    }
    runtimeSettings.host = host;
    runtimeSettings.port = port;
    runtimeSettings.computerNumber = computerNumber;
    saveSettings(runtimeSettings);
    installAutostartTasks();
    disconnectSocket(false);
    connectToHost();
    return { ok: true, message: "Настройки сохранены и применены." };
  });
  ipcMain.handle("agent:exit", async (_event, payload) => {
    if (!verifyPassword(payload?.password)) return { ok: false, message: "Неверный пароль." };
    removeAutostartTasks();
    shouldReconnect = false;
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    disconnectSocket(false);
    setTimeout(() => {
      app.exit(0);
    }, 250);
    return { ok: true, message: "Агент остановлен и удален из автозапуска." };
  });
  ipcMain.handle("agent:update:status", async () => updateUiState);
  ipcMain.handle("agent:update:check-now", async () => {
    if (updateInProgress) return { ok: false, message: "Обновление уже выполняется." };
    checkAndInstallAgentUpdate().catch(() => {});
    return { ok: true, message: "Проверка обновлений запущена." };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (hasOpenSharedFolderArg(argv)) {
      openSharedFolderWindow();
      return;
    }
    openSettingsWindow(false);
  });
  app.whenReady().then(() => {
    runtimeSettings = loadSettings();
    installAutostartTasks();
    registerSettingsIpc();
    tray = new Tray(makeTrayIcon());
    updateTray();
    connectToHost();
    startAutoUpdateLoop();
    if (hasOpenSharedFolderArg(process.argv)) {
      openSharedFolderWindow();
    }
    const missingPassword = !(runtimeSettings.passwordHash && runtimeSettings.passwordSalt);
    if (missingPassword) openSettingsWindow(true);
  });
}

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
