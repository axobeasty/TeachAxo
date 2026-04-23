const { contextBridge, ipcRenderer } = require("electron");
const pkg = require("./package.json");

contextBridge.exposeInMainWorld("teachAxo", {
  appName: "TeachAxo",
  appVersion: pkg.version,
  buildVersion: pkg.build?.buildVersion || pkg.version
});

contextBridge.exposeInMainWorld("teachAxoDb", {
  getState: () => ipcRenderer.invoke("db:get-state"),
  saveState: (state) => ipcRenderer.invoke("db:save-state", state),
  getInfo: () => ipcRenderer.invoke("db:get-info"),
  migrateToMysql: (config) => ipcRenderer.invoke("db:migrate-mysql", config)
});
