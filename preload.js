const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("teachAxo", {
  appName: "TeachAxo",
  appVersion: "1.0.0"
});
