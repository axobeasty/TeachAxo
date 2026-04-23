const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachAxoUpdater", {
  onStatus: (callback) => {
    ipcRenderer.on("updater:status", (_event, payload) => callback(payload));
  }
});
