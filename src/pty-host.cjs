const pty = require("@lydell/node-pty");
const readline = require("node:readline");

const sessions = new Map();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    send({ type: "error", id: "host", error: String(error) });
    return;
  }

  try {
    if (message.type === "create") createSession(message);
    if (message.type === "write") sessions.get(message.id)?.write(message.data ?? "");
    if (message.type === "resize") sessions.get(message.id)?.resize(message.cols, message.rows);
    if (message.type === "kill") {
      sessions.get(message.id)?.kill();
      sessions.delete(message.id);
    }
  } catch (error) {
    send({ type: "error", id: message.id, error: String(error) });
  }
});

process.on("exit", () => {
  for (const session of sessions.values()) {
    session.kill();
  }
});

function createSession(message) {
  const proc = pty.spawn(message.command, message.args ?? [], {
    name: "xterm-256color",
    cols: message.cols,
    rows: message.rows,
    cwd: message.cwd,
    env: message.env,
  });

  sessions.set(message.id, proc);
  proc.on("data", (data) => send({ type: "data", id: message.id, data }));
  proc.on("exit", (exitCode) => {
    send({ type: "exit", id: message.id, exitCode });
    sessions.delete(message.id);
  });
  send({ type: "ready", id: message.id, pid: proc.pid });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
