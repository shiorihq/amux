import { expect, test } from "bun:test";
import { AgentRuntime } from "./pty.ts";
import type { AgentThread } from "./types.ts";

function thread(command: string[]): AgentThread {
  return {
    id: `test:${Math.random()}`,
    provider: "codex",
    providerName: "Codex",
    title: "test runtime",
    cwd: process.cwd(),
    source: "new",
    messageCount: 0,
    command,
    preview: "",
    tags: [],
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for runtime state");
    }
    await Bun.sleep(20);
  }
}

test("AgentRuntime stays starting until the PTY host reports readiness", async () => {
  const runtime = new AgentRuntime(thread(["node", "-e", "setTimeout(() => {}, 250)"]), 80, 12);

  runtime.start();
  expect(runtime.snapshot().status).toBe("starting");

  try {
    await waitFor(() => runtime.snapshot().status === "running");
  } finally {
    runtime.kill();
  }
});

test("AgentRuntime records process exit after launch", async () => {
  const runtime = new AgentRuntime(thread(["node", "-e", "console.log('amux runtime ok')"]), 80, 12);

  runtime.start();

  try {
    await waitFor(() => runtime.snapshot().status === "exited");
    const snapshot = runtime.snapshot();
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.lines.some((line) => line.runs.some((run) => run.text.includes("amux runtime ok")))).toBe(true);
  } finally {
    runtime.kill();
  }
});

test("AgentRuntime kill is idempotent and detaches listeners", async () => {
  const runtime = new AgentRuntime(thread(["node", "-e", "setTimeout(() => {}, 500)"]), 80, 12);
  let changes = 0;
  runtime.on("change", () => {
    changes += 1;
  });

  runtime.start();
  await waitFor(() => changes > 0);
  runtime.kill();
  runtime.kill();

  const changesAfterKill = changes;
  await Bun.sleep(80);

  expect(runtime.listenerCount("change")).toBe(0);
  expect(changes).toBe(changesAfterKill);
  expect(runtime.snapshot().lines).toHaveLength(12);
});
