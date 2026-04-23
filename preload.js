const { contextBridge } = require("electron");
const pkg = require("./package.json");

contextBridge.exposeInMainWorld("teachAxo", {
  appName: "TeachAxo",
  appVersion: pkg.version,
  buildVersion: pkg.build?.buildVersion || pkg.version
});
