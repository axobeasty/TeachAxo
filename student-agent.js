const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const AGENT_DIR = path.join(process.env.APPDATA || process.cwd(), "TeachAxoStudentAgent");
const CONFIG_PATH = path.join(AGENT_DIR, "config.json");
const AUTOSTART_TASK_NAME = "TeachAxoStudentAgent";
const blockedProcesses = new Set();
let blockWatcher = null;

function readSavedConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(AGENT_DIR)) fs.mkdirSync(AGENT_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (_error) {
    // Ignore config write errors.
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "").trim();
    if (item === "--host") args.host = String(argv[i + 1] || "").trim();
    if (item === "--port") args.port = String(argv[i + 1] || "").trim();
    if (item === "--number") args.computerNumber = String(argv[i + 1] || "").trim();
  }
  const first = String(argv[0] || "").trim();
  if (/^\d+$/.test(first) && !args.computerNumber) args.computerNumber = first;
  return args;
}

const savedConfig = readSavedConfig();
const argConfig = parseArgs(process.argv.slice(2));

const serverHost = String(
  process.env.TEACHAXO_HOST || argConfig.host || savedConfig.host || "127.0.0.1"
).trim();
const serverPort = Number(
  process.env.TEACHAXO_PORT || argConfig.port || savedConfig.port || "46811"
);
const computerNumber = String(
  process.env.TEACHAXO_COMPUTER_NUMBER || argConfig.computerNumber || savedConfig.computerNumber || ""
).trim();

if (!/^\d+$/.test(computerNumber) || !Number.isInteger(serverPort) || serverPort <= 0) {
  console.error(
    "Set TEACHAXO_COMPUTER_NUMBER and TEACHAXO_PORT (or pass args: --number <N> --host <IP> --port <PORT>)."
  );
  process.exit(1);
}

saveConfig({
  host: serverHost,
  port: serverPort,
  computerNumber
});

function installAutostartTask() {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__filename);
  const taskCommand = `"${nodePath}" "${scriptPath}" --host "${serverHost}" --port "${serverPort}" --number "${computerNumber}"`;
  const escapedTaskCommand = taskCommand.replace(/"/g, '\\"');
  const createCommand = `schtasks /Create /TN "${AUTOSTART_TASK_NAME}" /TR "${escapedTaskCommand}" /SC ONLOGON /RL LIMITED /F`;
  exec(createCommand, { windowsHide: true }, () => {});
}

function removeAutostartTask() {
  const removeCommand = `schtasks /Delete /TN "${AUTOSTART_TASK_NAME}" /F`;
  exec(removeCommand, { windowsHide: true }, () => {});
}

installAutostartTask();

const executeShellCommand = (command) =>
  new Promise((resolve) => {
    exec(
      command,
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 32 * 1024 * 1024
      },
      (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: String(stderr || error.message || "").trim() });
        return;
      }
      resolve({ ok: true, output: String(stdout || "ok").trim() });
      }
    );
  });

function ensureBlockWatcher() {
  if (blockWatcher || blockedProcesses.size === 0) return;
  blockWatcher = setInterval(async () => {
    for (const processName of blockedProcesses) {
      await executeShellCommand(`taskkill /F /IM "${processName}"`);
    }
  }, 2000);
}

function stopBlockWatcherIfEmpty() {
  if (blockedProcesses.size > 0) return;
  if (!blockWatcher) return;
  clearInterval(blockWatcher);
  blockWatcher = null;
}

function escapePowerShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function captureScreenBase64() {
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
    "$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;",
    "$graphics = [System.Drawing.Graphics]::FromImage($bmp);",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);",
    "$ms = New-Object System.IO.MemoryStream;",
    "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);",
    "$graphics.Dispose();",
    "$bmp.Dispose();",
    "$bytes = $ms.ToArray();",
    "$ms.Dispose();",
    "[Convert]::ToBase64String($bytes)"
  ].join(" ");
  return executeShellCommand(`powershell -NoProfile -Command "${ps}"`);
}

function sendRemoteInput(data) {
  const type = String(data?.type || "");
  if (type === "click") {
    const x = Number(data?.x);
    const y = Number(data?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return Promise.resolve({ ok: false, output: "Некорректные координаты клика." });
    }
    const xx = Math.max(0, Math.min(1, x));
    const yy = Math.max(0, Math.min(1, y));
    const ps = [
      "Add-Type @\"",
      "using System; using System.Runtime.InteropServices;",
      "public class NativeInput {",
      "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
      "  [DllImport(\"user32.dll\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);",
      "}",
      "\"@;",
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      `$x = [int](${xx.toFixed(6)} * $b.Width);`,
      `$y = [int](${yy.toFixed(6)} * $b.Height);`,
      "[NativeInput]::SetCursorPos($x, $y) | Out-Null;",
      "[NativeInput]::mouse_event(2,0,0,0,0);",
      "[NativeInput]::mouse_event(4,0,0,0,0);",
      "Write-Output \"click-ok\""
    ].join(" ");
    return executeShellCommand(`powershell -NoProfile -Command "${ps}"`);
  }
  if (type === "key") {
    const key = String(data?.key || "").trim();
    if (!key) return Promise.resolve({ ok: false, output: "Не передана клавиша." });
    const safeKey = escapePowerShellSingleQuoted(key);
    const ps = [
      "$ws = New-Object -ComObject WScript.Shell;",
      `$ws.SendKeys('${safeKey}');`,
      "Write-Output \"key-ok\""
    ].join(" ");
    return executeShellCommand(`powershell -NoProfile -Command "${ps}"`);
  }
  return Promise.resolve({ ok: false, output: "Неизвестный тип remote_input." });
}

async function runAction(action, data) {
  switch (action) {
    case "check_connection":
      return {
        ok: true,
        output: `Связь установлена. Host: ${os.hostname()}, платформа: ${os.platform()}`
      };
    case "shutdown":
      return executeShellCommand("shutdown /s /t 0");
    case "restart":
      return executeShellCommand("shutdown /r /t 0");
    case "lock":
      return executeShellCommand("rundll32.exe user32.dll,LockWorkStation");
    case "unlock":
      return executeShellCommand("tscon console /dest:console");
    case "start_app":
      if (!data?.path) return { ok: false, output: "Для запуска приложения передайте data.path." };
      return executeShellCommand(`start "" "${String(data.path)}"`);
    case "close_app":
      if (!data?.processName) return { ok: false, output: "Для закрытия приложения передайте data.processName." };
      return executeShellCommand(`taskkill /F /IM "${String(data.processName)}"`);
    case "screen_view":
    case "screen_frame":
      return captureScreenBase64();
    case "remote_input":
      return sendRemoteInput(data);
    case "screen_snapshot_file":
      {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const screenshotPath = `C:\\Temp\\teachaxo-screen-${stamp}.png`;
        const ps = [
          "Add-Type -AssemblyName System.Windows.Forms;",
          "Add-Type -AssemblyName System.Drawing;",
          "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
          "$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;",
          "$graphics = [System.Drawing.Graphics]::FromImage($bmp);",
          "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);",
          `$target = '${escapePowerShellSingleQuoted(screenshotPath)}';`,
          "$dir = Split-Path -Parent $target;",
          "if (!(Test-Path $dir)) { New-Item -Path $dir -ItemType Directory | Out-Null }",
          "$bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png);",
          "$graphics.Dispose();",
          "$bmp.Dispose();",
          "Write-Output $target"
        ].join(" ");
        return executeShellCommand(`powershell -NoProfile -Command "${ps}"`);
      }
    case "deny_app_launch":
      if (!data?.processName) return { ok: false, output: "Для блокировки передайте data.processName." };
      blockedProcesses.add(String(data.processName).trim());
      ensureBlockWatcher();
      return { ok: true, output: `Блокировка запуска включена для ${String(data.processName).trim()}.` };
    case "group_policy":
      return executeShellCommand("start \"\" gpedit.msc");
    case "remote_control":
      await executeShellCommand('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f');
      await executeShellCommand('netsh advfirewall firewall set rule group="remote desktop" new enable=Yes');
      return { ok: true, output: `RDP включен. Подключайтесь к ${os.hostname()} по адресу ${serverHost}.` };
    case "disable_management":
      removeAutostartTask();
      try {
        if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
      } catch (_error) {}
      return {
        ok: true,
        output: "Управление отключено: автозапуск удален, агент будет остановлен.",
        exitAfterResponse: true
      };
    case "allow_app_launch":
      if (!data?.processName) return { ok: false, output: "Для разблокировки передайте data.processName." };
      blockedProcesses.delete(String(data.processName).trim());
      stopBlockWatcherIfEmpty();
      return { ok: true, output: `Блокировка запуска снята для ${String(data.processName).trim()}.` };
    default:
      return { ok: false, output: `Неизвестная команда: ${action}` };
  }
}

function connect() {
  const socket = net.createConnection({ host: serverHost, port: serverPort }, () => {
    socket.write(
      `${JSON.stringify({
        type: "register",
        computerNumber,
        hostname: os.hostname(),
        platform: os.platform()
      })}\n`
    );
  });
  socket.setEncoding("utf8");

  let buffer = "";
  socket.on("data", async (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const raw of parts) {
      const line = String(raw || "").trim();
      if (!line) continue;
      let message = null;
      try {
        message = JSON.parse(line);
      } catch (_error) {
        continue;
      }
      if (message?.type !== "command") continue;
      const commandId = String(message?.commandId || "");
      const action = String(message?.action || "");
      const result = await runAction(action, message?.data || {});
      socket.write(
        `${JSON.stringify({
          type: "command_result",
          commandId,
          ok: Boolean(result.ok),
          output: String(result.output || "")
        })}\n`
      );
      if (result?.exitAfterResponse) {
        setTimeout(() => process.exit(0), 500);
      }
    }
  });

  socket.on("error", () => {});
  socket.on("close", () => {
    setTimeout(connect, 3000);
  });
}

connect();
