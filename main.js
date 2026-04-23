const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
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

function getDbRuntimeConfigPath(userDataPath) {
  return path.join(userDataPath, DB_RUNTIME_CONFIG_FILE);
}

function loadDbRuntimeConfig(userDataPath) {
  const configPath = getDbRuntimeConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) {
    return { mode: "local" };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      mode: parsed?.mode === "remote" ? "remote" : "local",
      remote: parsed?.remote || {}
    };
  } catch (_error) {
    return { mode: "local" };
  }
}

function saveDbRuntimeConfig(userDataPath, config) {
  const configPath = getDbRuntimeConfigPath(userDataPath);
  const safeConfig = {
    mode: config?.mode === "remote" ? "remote" : "local",
    remote: config?.remote || {}
  };
  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), "utf-8");
}

function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: "TeachAxo",
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

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.maximize();
}

function createUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: "TeachAxo - Проверка обновлений",
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

function openMainAndCloseUpdater() {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.close();
  }
  createMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      sendMainUpdateStatus(cachedUpdateStatus);
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
  ipcMain.handle("db:get-state", async () => {
    const raw = await dbService.getStateAsync();
    return raw ? JSON.parse(raw) : null;
  });

  ipcMain.handle("db:save-state", async (_event, state) => {
    await dbService.setStateAsync(state || {});
    return { ok: true };
  });

  ipcMain.handle("db:get-info", async () => dbService.getInfo());

  ipcMain.handle("db:migrate-mysql", async (_event, config) => {
    await dbService.migrateToMysql(config || {});
    return { ok: true };
  });

  ipcMain.handle("db:test-mysql", async (_event, config) => {
    await dbService.testMysqlConnection(config || {});
    return { ok: true };
  });

  ipcMain.handle("db:apply-runtime-config", async (_event, config) => {
    const safeConfig = {
      mode: config?.mode === "remote" ? "remote" : "local",
      remote: config?.remote || {}
    };
    if (safeConfig.mode === "remote") {
      await dbService.testMysqlConnection(safeConfig);
    }
    saveDbRuntimeConfig(app.getPath("userData"), safeConfig);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
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
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  const runtimeDbConfig = loadDbRuntimeConfig(userDataPath);
  dbService = new DatabaseService(userDataPath, runtimeDbConfig);
  dbService
    .init()
    .then(() => {
      registerDatabaseIpcHandlers();
      setupAutoUpdateFlow();
    })
    .catch((error) => {
      console.error("DB init failed:", error);
      app.quit();
    });
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
