const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachAxo", {
  getMeta: () => ipcRenderer.invoke("app:get-meta")
});

contextBridge.exposeInMainWorld("teachAxoDb", {
  getState: () => ipcRenderer.invoke("db:get-state"),
  saveState: (state) => ipcRenderer.invoke("db:save-state", state),
  getInfo: () => ipcRenderer.invoke("db:get-info"),
  migrateToMysql: (config) => ipcRenderer.invoke("db:migrate-mysql", config)
});
