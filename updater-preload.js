const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachAxoUpdater", {
  onStatus: (callback) => {
    ipcRenderer.on("updater:status", (_event, payload) => callback(payload));
  },
  getAppearance: () => ipcRenderer.invoke("updater:get-appearance"),
  onAppearance: (callback) => {
    ipcRenderer.on("updater:appearance", (_event, payload) => callback(payload));
  },
  closeWindow: () => ipcRenderer.invoke("updater:close-window")
});
