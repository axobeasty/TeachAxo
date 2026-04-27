const net = require("node:net");
const os = require("node:os");
const { exec } = require("node:child_process");

const serverHost = process.env.TEACHAXO_HOST || "127.0.0.1";
const serverPort = Number(process.env.TEACHAXO_PORT || "46811");
const computerNumber = String(process.env.TEACHAXO_COMPUTER_NUMBER || process.argv[2] || "").trim();

if (!/^\d+$/.test(computerNumber)) {
  console.error("Set TEACHAXO_COMPUTER_NUMBER (or first CLI arg) to a positive computer number.");
  process.exit(1);
}

const executeShellCommand = (command) =>
  new Promise((resolve) => {
    exec(command, { windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: String(stderr || error.message || "").trim() });
        return;
      }
      resolve({ ok: true, output: String(stdout || "ok").trim() });
    });
  });

async function runAction(action, data) {
  switch (action) {
    case "shutdown":
      return executeShellCommand("shutdown /s /t 0");
    case "restart":
      return executeShellCommand("shutdown /r /t 0");
    case "lock":
      return executeShellCommand("rundll32.exe user32.dll,LockWorkStation");
    case "unlock":
      return { ok: false, output: "Windows не поддерживает удаленную разблокировку без доменной политики." };
    case "start_app":
      if (!data?.path) return { ok: false, output: "Для запуска приложения передайте data.path." };
      return executeShellCommand(`start "" "${String(data.path)}"`);
    case "close_app":
      if (!data?.processName) return { ok: false, output: "Для закрытия приложения передайте data.processName." };
      return executeShellCommand(`taskkill /F /IM "${String(data.processName)}"`);
    case "screen_view":
      return { ok: false, output: "Просмотр экрана требует отдельного видео-канала (WebRTC/RTSP)." };
    case "deny_app_launch":
      return { ok: false, output: "Запрет запуска приложений требует отдельного policy-модуля." };
    case "group_policy":
      return executeShellCommand("start \"\" gpedit.msc");
    case "remote_control":
      return { ok: false, output: "Удаленное управление требует отдельного модуля удаленного рабочего стола." };
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
    }
  });

  socket.on("error", () => {});
  socket.on("close", () => {
    setTimeout(connect, 3000);
  });
}

connect();
