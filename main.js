const { app, BrowserWindow } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let updaterWindow = null;
let updateInProgress = false;

function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1100,
    minHeight: 700,
    title: "TeachAxo",
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

function setupAutoUpdateFlow() {
  if (!app.isPackaged) {
    createMainWindow();
    return;
  }

  createUpdaterWindow();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdaterStatus("checking", "Проверяем наличие обновлений...");
  });

  autoUpdater.on("update-available", (info) => {
    updateInProgress = true;
    sendUpdaterStatus(
      "available",
      `Найдено обновление ${info.version}. Загружаем пакет...`
    );
    autoUpdater.downloadUpdate().catch((error) => {
      sendUpdaterStatus(
        "error",
        `Не удалось загрузить обновление: ${error.message}`
      );
      setTimeout(openMainAndCloseUpdater, 3000);
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdaterStatus(
      "downloading",
      `Загрузка обновления: ${Math.round(progress.percent)}%`,
      { progress: progress.percent }
    );
  });

  autoUpdater.on("update-downloaded", () => {
    sendUpdaterStatus(
      "installing",
      "Обновление загружено. Устанавливаем и перезапускаем приложение..."
    );
    setTimeout(() => autoUpdater.quitAndInstall(), 1500);
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdaterStatus("up-to-date", "Обновлений нет. Запускаем приложение...");
    setTimeout(openMainAndCloseUpdater, 1200);
  });

  autoUpdater.on("error", (error) => {
    const message = error?.message || "Неизвестная ошибка при проверке обновлений.";
    const noPublishedVersion =
      message.toLowerCase().includes("no published versions on github") ||
      message.toLowerCase().includes("no published versions");

    if (noPublishedVersion) {
      sendUpdaterStatus(
        "up-to-date",
        "Пока нет опубликованных версий на GitHub. Запускаем приложение..."
      );
      setTimeout(openMainAndCloseUpdater, 1200);
      return;
    }

    sendUpdaterStatus("error", `Ошибка обновления: ${message}`);
    setTimeout(openMainAndCloseUpdater, 3000);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    sendUpdaterStatus("error", `Не удалось запустить проверку обновлений: ${error.message}`);
    setTimeout(openMainAndCloseUpdater, 3000);
  });
}

app.whenReady().then(() => {
  setupAutoUpdateFlow();
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
