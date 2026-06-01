import type { RuntimeHealth } from "./types.ts";

export interface RuntimeHealthDeps {
  executablePath?: (command: string) => Promise<string | undefined>;
  commandVersion?: (command: string) => Promise<string | undefined>;
}

export async function checkRuntimeHealth(deps: RuntimeHealthDeps = {}): Promise<RuntimeHealth> {
  const executablePath = deps.executablePath ?? defaultExecutablePath;
  const commandVersion = deps.commandVersion ?? defaultCommandVersion;
  const path = await executablePath("node");

  if (!path) {
    return {
      node: {
        installed: false,
        error: "node was not found on PATH",
      },
    };
  }

  return {
    node: {
      installed: true,
      path,
      version: await commandVersion("node"),
    },
  };
}

async function defaultExecutablePath(command: string): Promise<string | undefined> {
  return Bun.which(command) ?? undefined;
}

async function defaultCommandVersion(command: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn([command, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = Bun.sleep(1_500).then(() => "timeout" as const);
    const exited = proc.exited.then(() => "exited" as const);
    const result = await Promise.race([timeout, exited]);
    if (result === "timeout") {
      proc.kill();
      await proc.exited.catch(() => undefined);
      return undefined;
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return (stdout || stderr).trim().split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}
