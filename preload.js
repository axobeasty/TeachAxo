const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachAxo", {
  getMeta: () => ipcRenderer.invoke("app:get-meta"),
  getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  getUiConfig: () => ipcRenderer.invoke("app:get-ui-config"),
  pickIcon: () => ipcRenderer.invoke("app:pick-icon"),
  applyUiConfig: (config) => ipcRenderer.invoke("app:apply-ui-config", config),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowState: (callback) => {
    ipcRenderer.on("window:state", (_event, payload) => callback(payload));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on("app:update-status", (_event, payload) => callback(payload));
  }
});

contextBridge.exposeInMainWorld("teachAxoDb", {
  getState: () => ipcRenderer.invoke("db:get-state"),
  saveState: (state) => ipcRenderer.invoke("db:save-state", state),
  getInfo: () => ipcRenderer.invoke("db:get-info"),
  getStatus: () => ipcRenderer.invoke("db:get-status"),
  migrateToMysql: (config) => ipcRenderer.invoke("db:migrate-mysql", config),
  testMysqlConnection: (config) => ipcRenderer.invoke("db:test-mysql", config),
  applyRuntimeConfig: (config) => ipcRenderer.invoke("db:apply-runtime-config", config),
  openSqliteLocation: () => ipcRenderer.invoke("db:open-sqlite-location"),
  onStatus: (callback) => {
    ipcRenderer.on("app:db-status", (_event, payload) => callback(payload));
  }
});
