const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("node:fs");
const https = require("node:https");
const { spawn } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const AdmZip = require("adm-zip");
const { DatabaseService } = require("./database");

let mainWindow = null;
let updaterWindow = null;
let updateInProgress = false;
let dbService = null;

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

function openMainAndCloseUpdater() {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.close();
  }
  createMainWindow();
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

  const downloadFile = (url, destinationPath, onProgress) =>
    new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.destroy();
          resolve(downloadFile(response.headers.location, destinationPath, onProgress));
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
        file.on("finish", () => {
          file.close(() => resolve(destinationPath));
        });
        file.on("error", (error) => reject(error));
      });

      request.on("error", (error) => reject(error));
    });

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

  const downloadAndInstallArchive = async (version) => {
    const archiveName = getUpdateArchiveName(version);
    const archiveUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}/${archiveName}`;
    const tempDir = path.join(app.getPath("temp"), `teachaxo-update-${version}`);
    const archivePath = path.join(tempDir, archiveName);
    const unpackDir = path.join(tempDir, "unpacked");

    fs.mkdirSync(tempDir, { recursive: true });
    sendUpdaterStatus("downloading", "Скачиваем архив обновления...", { progress: 1 });

    await downloadFile(archiveUrl, archivePath, (percent) => {
      sendUpdaterStatus("downloading", `Загрузка архива: ${Math.round(percent)}%`, { progress: percent });
    });

    sendUpdaterStatus("installing", "Архив загружен. Распаковываем...");
    fs.mkdirSync(unpackDir, { recursive: true });
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(unpackDir, true);

    const installerPath = findInstallerExe(unpackDir);
    if (!installerPath) {
      throw new Error("В архиве не найден установщик .exe");
    }

    sendUpdaterStatus("installing", "Запускаем установку обновления...");
    const child = spawn(installerPath, ["/S"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    app.quit();
  };

  autoUpdater.on("checking-for-update", () => {
    sendUpdaterStatus("checking", "Проверяем наличие обновлений...");
  });

  autoUpdater.on("update-available", (info) => {
    updateInProgress = true;
    sendUpdaterStatus(
      "available",
      `Найдено обновление ${info.version}. Загружаем архив...`
    );
    downloadAndInstallArchive(info.version).catch((error) => {
      sendUpdaterStatus(
        "error",
        `Не удалось установить обновление из архива: ${error.message}`
      );
      setTimeout(openMainAndCloseUpdater, 3000);
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const mbps = progress.bytesPerSecond
      ? `${(progress.bytesPerSecond / (1024 * 1024)).toFixed(2)} МБ/с`
      : "0.00 МБ/с";
    sendUpdaterStatus(
      "downloading",
      `Загрузка обновления: ${Math.round(progress.percent)}% (${mbps})`,
      { progress: progress.percent, speed: progress.bytesPerSecond }
    );
  });

  autoUpdater.on("update-downloaded", () => {});

  autoUpdater.on("update-not-available", () => {
    sendUpdaterStatus("up-to-date", "Обновлений нет. Запускаем приложение...");
    setTimeout(openMainAndCloseUpdater, 1200);
  });

  autoUpdater.on("error", (error) => {
    const message = error?.message || "Неизвестная ошибка при проверке обновлений.";
    if (isSkippableUpdaterError(message)) {
      fallbackToMainWithInfo(
        "Релизные файлы обновления еще не готовы (latest.yml отсутствует). Запускаем приложение..."
      );
      return;
    }

    sendUpdaterStatus("error", `Ошибка обновления: ${message}`);
    setTimeout(openMainAndCloseUpdater, 3000);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    if (isSkippableUpdaterError(error?.message)) {
      fallbackToMainWithInfo(
        "Релизные файлы обновления еще не готовы (latest.yml отсутствует). Запускаем приложение..."
      );
      return;
    }
    sendUpdaterStatus("error", `Не удалось запустить проверку обновлений: ${error.message}`);
    setTimeout(openMainAndCloseUpdater, 3000);
  });
}

function registerDatabaseIpcHandlers() {
  ipcMain.handle("db:get-state", async () => {
    const raw = dbService.getState();
    return raw ? JSON.parse(raw) : null;
  });

  ipcMain.handle("db:save-state", async (_event, state) => {
    dbService.setState(state || {});
    return { ok: true };
  });

  ipcMain.handle("db:get-info", async () => dbService.getInfo());

  ipcMain.handle("db:migrate-mysql", async (_event, config) => {
    await dbService.migrateToMysql(config || {});
    return { ok: true };
  });
}

app.whenReady().then(() => {
  dbService = new DatabaseService(app.getPath("userData"));
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
