const { app, BrowserWindow, ipcMain, shell, Notification, dialog, nativeImage, nativeTheme } = require("electron");
const path = require("path");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const AdmZip = require("adm-zip");
const { DatabaseService } = require("./src/database");

let mainWindow = null;
let updaterWindow = null;
let updateInProgress = false;
let dbService = null;
let latestAvailableVersion = null;
let runtimeUpdateTimer = null;
let runtimeCheckInFlight = false;
let preparedUpdate = null;
let cachedUpdateStatus = {
  state: "idle",
  message: "Проверка обновлений не выполнялась.",
  availableVersion: null
};
let runtimeCheckForUpdates = async () => cachedUpdateStatus;
let runtimeInstallUpdate = async () => ({ ok: false, message: "Обновление недоступно." });
const DB_RUNTIME_CONFIG_FILE = "db-runtime-config.json";
const APP_UI_CONFIG_FILE = "app-ui-config.json";
let dbHealthTimer = null;
let cachedDbStatus = {
  mode: "local",
  connected: true,
  interacting: false,
  operation: "",
  message: "SQLite: готово",
  sqlitePath: "",
  sqliteFileName: "teachaxo.sqlite"
};
let appUiConfig = {
  iconPath: "",
  theme: "system"
};
const COMPUTER_CONTROL_PORT = 46811;
let computerControlServer = null;
const connectedComputerSockets = new Map();
const pendingComputerCommands = new Map();

function normalizeUiTheme(value) {
  const v = String(value || "").toLowerCase();
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function getDbRuntimeConfigPath(userDataPath) {
  return path.join(userDataPath, DB_RUNTIME_CONFIG_FILE);
}

function loadDbRuntimeConfig(userDataPath) {
  const configPath = getDbRuntimeConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) {
    return { mode: "local", localName: "teachaxo.sqlite" };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      mode: parsed?.mode === "remote" ? "remote" : "local",
      localName: String(parsed?.localName || "teachaxo.sqlite"),
      remote: parsed?.remote || {}
    };
  } catch (_error) {
    return { mode: "local", localName: "teachaxo.sqlite" };
  }
}

function saveDbRuntimeConfig(userDataPath, config) {
  const configPath = getDbRuntimeConfigPath(userDataPath);
  const safeConfig = {
    mode: config?.mode === "remote" ? "remote" : "local",
    localName: String(config?.localName || "teachaxo.sqlite"),
    remote: config?.remote || {}
  };
  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), "utf-8");
}

function getUiConfigPath(userDataPath) {
  return path.join(userDataPath, APP_UI_CONFIG_FILE);
}

function loadUiConfig(userDataPath) {
  const configPath = getUiConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) return { iconPath: "", theme: "system" };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      iconPath: String(parsed?.iconPath || ""),
      theme: normalizeUiTheme(parsed?.theme)
    };
  } catch (_error) {
    return { iconPath: "", theme: "system" };
  }
}

function saveUiConfig(userDataPath, config) {
  const configPath = getUiConfigPath(userDataPath);
  const safeConfig = {
    iconPath: String(config?.iconPath || ""),
    theme: normalizeUiTheme(config?.theme)
  };
  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), "utf-8");
}

function resolveDisplayTheme() {
  const pref = normalizeUiTheme(appUiConfig.theme);
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function broadcastUpdaterAppearance() {
  if (!updaterWindow || updaterWindow.isDestroyed()) return;
  updaterWindow.webContents.send("updater:appearance", { display: resolveDisplayTheme() });
}

function resolveWindowIcon(iconPath) {
  if (!iconPath) return undefined;
  if (!fs.existsSync(iconPath)) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return undefined;
  return image;
}

function notifyWindows(title, body) {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: String(title || "TeachAxo"),
      body: String(body || "")
    });
    notification.show();
  } catch (_error) {
    // Ignore notification errors.
  }
}

function getConnectedComputersSnapshot() {
  return [...connectedComputerSockets.values()].map((item) => ({
    computerNumber: item.computerNumber,
    remoteAddress: item.remoteAddress,
    hostname: item.hostname || "",
    platform: item.platform || "",
    connectedAt: item.connectedAt,
    lastSeenAt: item.lastSeenAt
  }));
}

function broadcastComputerConnections() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("computers:connections-changed", {
    items: getConnectedComputersSnapshot()
  });
}

function clearPendingCommandsForComputer(computerNumber, reason) {
  if (!computerNumber) return;
  for (const [commandId, pending] of pendingComputerCommands.entries()) {
    if (pending.computerNumber !== computerNumber) continue;
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(reason || "Соединение с компьютером потеряно."));
    pendingComputerCommands.delete(commandId);
  }
}

function startComputerControlServer() {
  if (computerControlServer) return;
  computerControlServer = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let registeredComputerNumber = "";

    const detachComputer = () => {
      if (!registeredComputerNumber) return;
      const current = connectedComputerSockets.get(registeredComputerNumber);
      if (current && current.socket === socket) {
        connectedComputerSockets.delete(registeredComputerNumber);
      }
      clearPendingCommandsForComputer(registeredComputerNumber, "Компьютер отключился от сервера.");
      registeredComputerNumber = "";
      broadcastComputerConnections();
    };

    socket.on("data", (chunk) => {
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
        const type = String(message?.type || "");
        if (type === "register") {
          const computerNumber = String(message?.computerNumber || "").trim();
          if (!computerNumber) continue;
          if (registeredComputerNumber && registeredComputerNumber !== computerNumber) {
            connectedComputerSockets.delete(registeredComputerNumber);
          }
          registeredComputerNumber = computerNumber;
          connectedComputerSockets.set(computerNumber, {
            socket,
            computerNumber,
            remoteAddress: socket.remoteAddress || "",
            hostname: String(message?.hostname || ""),
            platform: String(message?.platform || ""),
            connectedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
          });
          socket.write(`${JSON.stringify({ type: "registered", ok: true, computerNumber })}\n`);
          broadcastComputerConnections();
          continue;
        }
        if (!registeredComputerNumber) continue;
        const current = connectedComputerSockets.get(registeredComputerNumber);
        if (current) {
          current.lastSeenAt = new Date().toISOString();
        }
        if (type === "pong") {
          continue;
        }
        if (type === "command_result") {
          const commandId = String(message?.commandId || "");
          if (!commandId || !pendingComputerCommands.has(commandId)) continue;
          const pending = pendingComputerCommands.get(commandId);
          clearTimeout(pending.timeoutId);
          pendingComputerCommands.delete(commandId);
          pending.resolve({
            ok: Boolean(message?.ok),
            output: String(message?.output || ""),
            error: String(message?.error || "")
          });
        }
      }
    });
    socket.on("error", () => detachComputer());
    socket.on("close", () => detachComputer());
  });
  computerControlServer.listen(COMPUTER_CONTROL_PORT, "0.0.0.0", () => {
    console.log(`Computer control server started on port ${COMPUTER_CONTROL_PORT}`);
  });
}

function backupBrokenDbRuntimeConfig(userDataPath) {
  const configPath = getDbRuntimeConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) return;
  try {
    const backupPath = `${configPath}.broken-${Date.now()}.json`;
    fs.copyFileSync(configPath, backupPath);
  } catch (_error) {
    // Ignore backup failures; startup fallback should still proceed.
  }
}

function createMainWindow() {
  if (mainWindow) return;
  const customIcon = resolveWindowIcon(appUiConfig.iconPath);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: "TeachAxo",
    frame: false,
    ...(customIcon ? { icon: customIcon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state", {
      isMaximized: mainWindow.isMaximized()
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.webContents.on("did-finish-load", emitWindowState);

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.maximize();
}

function createUpdaterWindow() {
  const customIcon = resolveWindowIcon(appUiConfig.iconPath);
  updaterWindow = new BrowserWindow({
    width: 520,
    height: 360,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: "TeachAxo - Проверка обновлений",
    ...(customIcon ? { icon: customIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "updater-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  updaterWindow.on("closed", () => {
    updaterWindow = null;
  });

  updaterWindow.loadFile(path.join(__dirname, "src", "updater.html"));
  updaterWindow.webContents.once("did-finish-load", () => {
    broadcastUpdaterAppearance();
  });
}

function sendUpdaterStatus(type, message, extra = {}) {
  if (!updaterWindow || updaterWindow.isDestroyed()) return;
  updaterWindow.webContents.send("updater:status", { type, message, ...extra });
}

function sendMainUpdateStatus(payload) {
  cachedUpdateStatus = { ...cachedUpdateStatus, ...payload };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:update-status", cachedUpdateStatus);
}

function sendMainDbStatus(payload) {
  cachedDbStatus = { ...cachedDbStatus, ...payload };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:db-status", cachedDbStatus);
}

function deriveSqliteFileName(sqlitePath) {
  if (!sqlitePath) return "teachaxo.sqlite";
  return path.basename(sqlitePath);
}

async function refreshDbConnectionStatus() {
  if (!dbService) return;
  const info = dbService.getInfo();
  const isRemote = info.provider === "mysql";
  if (!isRemote) {
    sendMainDbStatus({
      mode: "local",
      connected: true,
      message: "SQLite: подключена",
      sqlitePath: info.sqlitePath || "",
      sqliteFileName: deriveSqliteFileName(info.sqlitePath || "")
    });
    return;
  }
  try {
    await dbService.ping();
    sendMainDbStatus({
      mode: "remote",
      connected: true,
      message: `Remote DB: подключена (${info.remoteHost || "host"})`,
      sqlitePath: info.sqlitePath || "",
      sqliteFileName: deriveSqliteFileName(info.sqlitePath || "")
    });
  } catch (error) {
    sendMainDbStatus({
      mode: "remote",
      connected: false,
      message: `Remote DB: нет подключения (${error.message})`,
      sqlitePath: info.sqlitePath || "",
      sqliteFileName: deriveSqliteFileName(info.sqlitePath || "")
    });
  }
}

async function withDbActivity(operationName, fn) {
  sendMainDbStatus({
    interacting: true,
    operation: operationName,
    message: `${cachedDbStatus.mode === "remote" ? "Remote DB" : "SQLite"}: выполняется ${operationName}`
  });
  try {
    const result = await fn();
    return result;
  } finally {
    sendMainDbStatus({
      interacting: false,
      operation: ""
    });
    await refreshDbConnectionStatus();
  }
}

function startDbHealthMonitor() {
  if (dbHealthTimer) clearInterval(dbHealthTimer);
  dbHealthTimer = setInterval(() => {
    refreshDbConnectionStatus().catch(() => {});
  }, 15000);
}

function openMainAndCloseUpdater() {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.close();
  }
  createMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      sendMainUpdateStatus(cachedUpdateStatus);
      sendMainDbStatus(cachedDbStatus);
    });
  }
}

function isSkippableUpdaterError(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("no published versions on github") ||
    normalized.includes("no published versions") ||
    normalized.includes("cannot find latest.yml") ||
    (normalized.includes("latest.yml") && normalized.includes("404"))
  );
}

function fallbackToMainWithInfo(message) {
  sendUpdaterStatus("up-to-date", message);
  setTimeout(openMainAndCloseUpdater, 1200);
}

function setupAutoUpdateFlow() {
  if (!app.isPackaged) {
    sendMainUpdateStatus({
      state: "disabled",
      message: "Режим разработки: проверка обновлений отключена.",
      availableVersion: null
    });
    createMainWindow();
    return;
  }

  createUpdaterWindow();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;

  const repoOwner = "axobeasty";
  const repoName = "TeachAxo";

  const getUpdateArchiveName = (version) => `TeachAxo-Update-${version}.zip`;

  const getUrlMeta = (url) =>
    new Promise((resolve, reject) => {
      const request = https.request(url, { method: "HEAD" }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.destroy();
          resolve(getUrlMeta(response.headers.location));
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Статус HEAD-запроса: ${response.statusCode}`));
          return;
        }
        resolve({
          url,
          total: Number(response.headers["content-length"] || 0),
          acceptsRanges: String(response.headers["accept-ranges"] || "").toLowerCase().includes("bytes")
        });
      });
      request.on("error", reject);
      request.end();
    });

  const downloadFileSingle = (url, destinationPath, onProgress) =>
    new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.destroy();
          resolve(downloadFileSingle(response.headers.location, destinationPath, onProgress));
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Статус скачивания: ${response.statusCode}`));
          return;
        }

        const total = Number(response.headers["content-length"] || 0);
        let loaded = 0;
        const file = fs.createWriteStream(destinationPath);

        response.on("data", (chunk) => {
          loaded += chunk.length;
          if (onProgress && total > 0) onProgress((loaded / total) * 100);
        });
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve(destinationPath)));
        file.on("error", reject);
      });

      request.on("error", reject);
    });

  const downloadChunk = (url, start, end, destinationPath, reportProgress) =>
    new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: {
            Range: `bytes=${start}-${end}`
          }
        },
        (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.destroy();
            resolve(downloadChunk(response.headers.location, start, end, destinationPath, reportProgress));
            return;
          }
          if (response.statusCode !== 206) {
            reject(new Error(`Chunk download status: ${response.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destinationPath, { flags: "r+", start });
          response.on("data", (chunk) => reportProgress(chunk.length));
          response.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
          file.on("error", reject);
        }
      );
      request.on("error", reject);
    });

  const downloadFileMaxSpeed = async (url, destinationPath, onProgress) => {
    const meta = await getUrlMeta(url);
    const total = meta.total;
    const canParallel = meta.acceptsRanges && total > 2 * 1024 * 1024;

    if (!canParallel) {
      return downloadFileSingle(meta.url, destinationPath, onProgress);
    }

    const cpuCount = os.cpus()?.length || 4;
    const streamCount = Math.max(4, Math.min(12, cpuCount * 2));
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
        onProgress(percent);
      }
    };

    const tasks = [];
    for (let i = 0; i < streamCount; i += 1) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      if (start > end) continue;
      tasks.push(downloadChunk(meta.url, start, end, destinationPath, reportProgress));
    }
    await Promise.all(tasks);
    return destinationPath;
  };

  const findInstallerExe = (directoryPath) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        const nested = findInstallerExe(fullPath);
        if (nested) return nested;
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
        return fullPath;
      }
    }
    return null;
  };

  const downloadAndPrepareArchive = async (version) => {
    const archiveName = getUpdateArchiveName(version);
    const archiveUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}/${archiveName}`;
    const tempDir = path.join(app.getPath("temp"), `teachaxo-update-${version}`);
    const archivePath = path.join(tempDir, archiveName);
    const unpackDir = path.join(tempDir, "unpacked");

    fs.mkdirSync(tempDir, { recursive: true });
    sendUpdaterStatus("downloading", "Скачиваем архив обновления...", { progress: 1 });
    sendMainUpdateStatus({
      state: "downloading",
      message: `Скачиваем обновление ${version}...`,
      availableVersion: version
    });

    await downloadFileMaxSpeed(archiveUrl, archivePath, (percent) => {
      sendUpdaterStatus("downloading", `Загрузка архива: ${Math.round(percent)}%`, { progress: percent });
      sendMainUpdateStatus({
        state: "downloading",
        message: `Загрузка обновления ${Math.round(percent)}%`,
        availableVersion: version,
        progress: percent
      });
    });

    sendUpdaterStatus("installing", "Архив загружен. Распаковываем...");
    sendMainUpdateStatus({
      state: "installing",
      message: "Распаковываем и устанавливаем обновление...",
      availableVersion: version
    });
    fs.mkdirSync(unpackDir, { recursive: true });
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(unpackDir, true);

    const installerPath = findInstallerExe(unpackDir);
    if (!installerPath) {
      throw new Error("В архиве не найден установщик .exe");
    }
    return { version, archivePath, unpackDir, installerPath };
  };

  const installPreparedUpdate = async (prepared) => {
    if (!prepared?.installerPath) {
      throw new Error("Обновление не подготовлено для установки.");
    }
    sendUpdaterStatus("installing", "Запускаем установку обновления...");
    // Run installer without silent flag so NSIS can execute standard post-install launch flow.
    const child = spawn(prepared.installerPath, [], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    app.quit();
  };

  const downloadAndInstallArchive = async (version) => {
    const prepared = await downloadAndPrepareArchive(version);
    await installPreparedUpdate(prepared);
  };

  const checkForAvailableVersion = async () => {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version) return null;
    if (String(version) === String(app.getVersion())) return null;
    return String(version);
  };

  runtimeCheckForUpdates = async () => {
    if (!app.isPackaged) {
      sendMainUpdateStatus({
        state: "disabled",
        message: "Режим разработки: проверка обновлений отключена.",
        availableVersion: null
      });
      return cachedUpdateStatus;
    }
    if (updateInProgress || runtimeCheckInFlight) return cachedUpdateStatus;
    runtimeCheckInFlight = true;

    sendMainUpdateStatus({
      state: "checking",
      message: "Проверяем наличие обновлений...",
      availableVersion: latestAvailableVersion
    });

    try {
      const availableVersion = await checkForAvailableVersion();
      if (availableVersion) {
        latestAvailableVersion = availableVersion;
        sendMainUpdateStatus({
          state: "available",
          message: `Найдено обновление ${availableVersion}. Загружаем в фоне...`,
          availableVersion
        });
        try {
          const prepared = await downloadAndPrepareArchive(availableVersion);
          preparedUpdate = prepared;
          sendMainUpdateStatus({
            state: "downloaded",
            message: `Обновление ${availableVersion} загружено. Можно установить.`,
            availableVersion
          });
        } catch (downloadError) {
          sendMainUpdateStatus({
            state: "error",
            message: `Ошибка загрузки обновления: ${downloadError.message}`,
            availableVersion
          });
        }
      } else {
        latestAvailableVersion = null;
        preparedUpdate = null;
        sendMainUpdateStatus({
          state: "up-to-date",
          message: "Установлена последняя версия.",
          availableVersion: null
        });
      }
    } catch (error) {
      sendMainUpdateStatus({
        state: "error",
        message: `Ошибка проверки обновлений: ${error.message}`,
        availableVersion: latestAvailableVersion
      });
    } finally {
      runtimeCheckInFlight = false;
    }
    return cachedUpdateStatus;
  };

  runtimeInstallUpdate = async () => {
    if (updateInProgress) return { ok: false, message: "Обновление уже выполняется." };
    if (preparedUpdate?.installerPath) {
      updateInProgress = true;
      await installPreparedUpdate(preparedUpdate);
      return { ok: true };
    }
    if (!latestAvailableVersion) {
      await runtimeCheckForUpdates();
    }
    if (!latestAvailableVersion) {
      return { ok: false, message: "Новых обновлений не найдено." };
    }

    updateInProgress = true;
    try {
      const prepared = await downloadAndPrepareArchive(latestAvailableVersion);
      preparedUpdate = prepared;
      await installPreparedUpdate(prepared);
      return { ok: true };
    } catch (error) {
      updateInProgress = false;
      sendMainUpdateStatus({
        state: "error",
        message: `Не удалось установить обновление: ${error.message}`,
        availableVersion: latestAvailableVersion
      });
      return { ok: false, message: error.message };
    }
  };

  const startRuntimeUpdateChecks = () => {
    if (runtimeUpdateTimer) {
      clearInterval(runtimeUpdateTimer);
    }
    // Lightweight background polling: once per 30 minutes with guarded single-flight checks.
    runtimeUpdateTimer = setInterval(() => {
      runtimeCheckForUpdates().catch(() => {});
    }, 30 * 60 * 1000);
  };

  sendUpdaterStatus("checking", "Проверяем наличие обновлений...");
  checkForAvailableVersion()
    .then(async (version) => {
      if (!version) {
        sendUpdaterStatus("up-to-date", "Обновлений нет. Запускаем приложение...");
        sendMainUpdateStatus({
          state: "up-to-date",
          message: "Установлена последняя версия.",
          availableVersion: null
        });
        setTimeout(() => {
          openMainAndCloseUpdater();
          startRuntimeUpdateChecks();
          runtimeCheckForUpdates().catch(() => {});
        }, 1200);
        return;
      }
      latestAvailableVersion = version;
      updateInProgress = true;
      sendUpdaterStatus("available", `Найдено обновление ${version}. Загружаем архив...`);
      await downloadAndInstallArchive(version);
    })
    .catch((error) => {
      const message = error?.message || "Неизвестная ошибка при проверке обновлений.";
      if (isSkippableUpdaterError(message)) {
        fallbackToMainWithInfo(
          "Релизные файлы обновления еще не готовы (latest.yml отсутствует). Запускаем приложение..."
        );
        sendMainUpdateStatus({
          state: "up-to-date",
          message: "Установлена последняя версия.",
          availableVersion: null
        });
        startRuntimeUpdateChecks();
        return;
      }
      sendUpdaterStatus("error", `Ошибка обновления: ${message}`);
      sendMainUpdateStatus({
        state: "error",
        message: `Ошибка проверки обновлений: ${message}`,
        availableVersion: null
      });
      setTimeout(() => {
        openMainAndCloseUpdater();
        startRuntimeUpdateChecks();
      }, 3000);
    });
}

function registerDatabaseIpcHandlers() {
  ipcMain.handle("updater:get-appearance", async () => ({ display: resolveDisplayTheme() }));

  ipcMain.handle("updater:close-window", (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (!sourceWindow || sourceWindow.isDestroyed()) return { ok: false };
    sourceWindow.close();
    return { ok: true };
  });

  ipcMain.handle("window:minimize", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    mainWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, isMaximized: false };
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { ok: true, isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle("window:close", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    mainWindow.close();
    return { ok: true };
  });

  ipcMain.handle("window:is-maximized", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle("db:get-state", async () => {
    const raw = await withDbActivity("чтение данных", async () => dbService.getStateAsync());
    return raw ? JSON.parse(raw) : null;
  });

  ipcMain.handle("db:save-state", async (_event, state) => {
    await withDbActivity("сохранение данных", async () => dbService.setStateAsync(state || {}));
    return { ok: true };
  });

  ipcMain.handle("db:get-info", async () => dbService.getInfo());

  ipcMain.handle("db:migrate-mysql", async (_event, config) => {
    await withDbActivity("миграция в MySQL", async () => dbService.migrateToMysql(config || {}));
    return { ok: true };
  });

  ipcMain.handle("db:test-mysql", async (_event, config) => {
    await withDbActivity("проверка подключения", async () => dbService.testMysqlConnection(config || {}));
    return { ok: true };
  });

  ipcMain.handle("db:apply-runtime-config", async (_event, config) => {
    const safeConfig = {
      mode: config?.mode === "remote" ? "remote" : "local",
      localName: String(config?.localName || "teachaxo.sqlite"),
      remote: config?.remote || {}
    };

    // Migrate current app state into target storage before relaunch,
    // so data always lives in the selected backend (SQLite or MySQL).
    const currentStateRaw = await withDbActivity("чтение состояния", async () => dbService.getStateAsync());
    const currentState = currentStateRaw ? JSON.parse(currentStateRaw) : {};

    if (safeConfig.mode === "remote") {
      await dbService.testMysqlConnection(safeConfig);
      const remoteService = new DatabaseService(app.getPath("userData"), safeConfig);
      await withDbActivity("инициализация удаленной БД", async () => remoteService.init());
      await withDbActivity("запись в удаленную БД", async () => remoteService.setStateAsync(currentState));
    } else {
      const localService = new DatabaseService(app.getPath("userData"), safeConfig);
      await withDbActivity("инициализация SQLite", async () => localService.init());
      await withDbActivity("запись в SQLite", async () => localService.setStateAsync(currentState));
    }

    saveDbRuntimeConfig(app.getPath("userData"), safeConfig);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return { ok: true };
  });

  ipcMain.handle("db:get-status", async () => {
    await refreshDbConnectionStatus();
    return cachedDbStatus;
  });

  ipcMain.handle("db:open-sqlite-location", async () => {
    const info = dbService.getInfo();
    const targetPath = info.sqlitePath;
    if (!targetPath) return { ok: false, message: "Путь к SQLite не найден." };
    shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  ipcMain.handle("app:get-meta", async () => {
    // app.getVersion() is the most reliable source in packaged builds.
    const appVersion = app.getVersion() || "0.0.0";
    let buildVersion = appVersion;
    try {
      // Keep buildVersion from package.json when available.
      const pkg = require("./package.json");
      if (pkg?.build?.buildVersion) {
        buildVersion = String(pkg.build.buildVersion);
      }
    } catch (_error) {
      buildVersion = appVersion;
    }
    return {
      appName: app.getName() || "TeachAxo",
      appVersion: String(appVersion),
      buildVersion: String(buildVersion)
    };
  });

  ipcMain.handle("app:get-update-status", async () => cachedUpdateStatus);
  ipcMain.handle("app:check-updates", async () => runtimeCheckForUpdates());
  ipcMain.handle("app:install-update", async () => runtimeInstallUpdate());
  ipcMain.handle("app:notify", async (_event, payload) => {
    notifyWindows(payload?.title || "TeachAxo", payload?.message || "");
    return { ok: true };
  });
  ipcMain.handle("app:get-ui-config", async () => appUiConfig);
  ipcMain.handle("app:get-computer-server-config", async () => ({ port: COMPUTER_CONTROL_PORT }));
  ipcMain.handle("app:get-computer-connections", async () => ({ items: getConnectedComputersSnapshot() }));
  ipcMain.handle("app:send-computer-command", async (_event, payload) => {
    const computerNumber = String(payload?.computerNumber || "").trim();
    const action = String(payload?.action || "").trim();
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    if (!computerNumber || !action) {
      return { ok: false, error: "Укажите номер компьютера и команду." };
    }
    const target = connectedComputerSockets.get(computerNumber);
    if (!target?.socket || target.socket.destroyed) {
      return { ok: false, error: "Компьютер не подключен." };
    }
    const commandId = crypto.randomUUID();
    const packet = {
      type: "command",
      commandId,
      action,
      data,
      timestamp: new Date().toISOString()
    };
    try {
      target.socket.write(`${JSON.stringify(packet)}\n`);
    } catch (error) {
      return { ok: false, error: `Не удалось отправить команду: ${error.message}` };
    }
    const result = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingComputerCommands.delete(commandId);
        reject(new Error("Таймаут ответа от компьютера."));
      }, 15000);
      pendingComputerCommands.set(commandId, {
        computerNumber,
        timeoutId,
        resolve,
        reject
      });
    }).catch((error) => ({ ok: false, error: error.message }));
    return result;
  });
  ipcMain.handle("app:pick-icon", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Icon files", extensions: ["ico", "png", "jpg", "jpeg"] }]
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle("app:apply-ui-config", async (_event, config) => {
    const nextConfig = {
      iconPath:
        config && Object.prototype.hasOwnProperty.call(config, "iconPath")
          ? String(config.iconPath || "")
          : String(appUiConfig.iconPath || ""),
      theme:
        config && Object.prototype.hasOwnProperty.call(config, "theme")
          ? normalizeUiTheme(config.theme)
          : normalizeUiTheme(appUiConfig.theme)
    };
    appUiConfig = nextConfig;
    saveUiConfig(app.getPath("userData"), nextConfig);
    const iconImage = resolveWindowIcon(nextConfig.iconPath);
    if (mainWindow && !mainWindow.isDestroyed() && iconImage) {
      mainWindow.setIcon(iconImage);
    }
    if (updaterWindow && !updaterWindow.isDestroyed() && iconImage) {
      updaterWindow.setIcon(iconImage);
    }
    broadcastUpdaterAppearance();
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const runtimeDbConfig = loadDbRuntimeConfig(userDataPath);
  appUiConfig = loadUiConfig(userDataPath);

  const initDatabaseWithFallback = async () => {
    dbService = new DatabaseService(userDataPath, runtimeDbConfig);
    try {
      await dbService.init();
      return;
    } catch (error) {
      const isRemoteMode = runtimeDbConfig.mode === "remote";
      if (!isRemoteMode) {
        throw error;
      }

      console.error("Remote DB init failed, fallback to SQLite:", error);
      backupBrokenDbRuntimeConfig(userDataPath);
      saveDbRuntimeConfig(userDataPath, { mode: "local", localName: runtimeDbConfig.localName || "teachaxo.sqlite" });

      dbService = new DatabaseService(userDataPath, {
        mode: "local",
        localName: runtimeDbConfig.localName || "teachaxo.sqlite"
      });
      await dbService.init();
    }
  };

  try {
    await initDatabaseWithFallback();
    await refreshDbConnectionStatus();
    notifyWindows("TeachAxo", cachedDbStatus.message);
    startDbHealthMonitor();
    registerDatabaseIpcHandlers();
    startComputerControlServer();
    nativeTheme.on("updated", () => {
      if (normalizeUiTheme(appUiConfig.theme) !== "system") return;
      broadcastUpdaterAppearance();
    });
    setupAutoUpdateFlow();
  } catch (error) {
    console.error("DB init failed:", error);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length !== 0) return;
    if (app.isPackaged && !updateInProgress) {
      setupAutoUpdateFlow();
    } else {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (computerControlServer) {
    try {
      computerControlServer.close();
    } catch (_error) {}
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
