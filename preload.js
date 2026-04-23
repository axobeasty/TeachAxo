const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachAxo", {
  getMeta: () => ipcRenderer.invoke("app:get-meta"),
  getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("app:update-status", (_event, payload) => callback(payload));
  }
});

contextBridge.exposeInMainWorld("teachAxoDb", {
  getState: () => ipcRenderer.invoke("db:get-state"),
  saveState: (state) => ipcRenderer.invoke("db:save-state", state),
  getInfo: () => ipcRenderer.invoke("db:get-info"),
  migrateToMysql: (config) => ipcRenderer.invoke("db:migrate-mysql", config),
  testMysqlConnection: (config) => ipcRenderer.invoke("db:test-mysql", config),
  applyRuntimeConfig: (config) => ipcRenderer.invoke("db:apply-runtime-config", config)
});
