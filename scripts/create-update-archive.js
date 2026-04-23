const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const pkg = require("../package.json");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const version = pkg.version;
const installerName = `TeachAxo Setup ${version}.exe`;
const installerPath = path.join(distDir, installerName);
const archiveName = `TeachAxo-Update-${version}.zip`;
const archivePath = path.join(distDir, archiveName);

if (!fs.existsSync(installerPath)) {
  throw new Error(`Installer not found: ${installerPath}. Run "npm run dist" first.`);
}

const zip = new AdmZip();
zip.addLocalFile(installerPath);
zip.writeZip(archivePath);

console.log(`Created update archive: ${archivePath}`);
