import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentThread, ProviderDefinition, ProviderHealth, ProviderId } from "./types.ts";

const home = homedir();

export interface ProviderHealthDeps {
  executablePath?: (command: string) => Promise<string | undefined>;
  commandVersion?: (command: string) => Promise<string | undefined>;
}

export const providers: ProviderDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    home: join(home, ".codex"),
    sessionRoots: [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")],
    resumeCommand: (thread: AgentThread) => ["codex", "resume", thread.sessionId ?? thread.id],
    newCommand: (cwd: string) => ["codex", "--cd", cwd],
  },
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    home: join(home, ".claude"),
    sessionRoots: [join(home, ".claude", "projects")],
    resumeCommand: (thread: AgentThread) => ["claude", "--resume", thread.sessionId ?? thread.id],
    newCommand: (cwd: string) => ["claude", "--add-dir", cwd],
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    home: join(home, ".pi", "agent"),
    sessionRoots: [join(home, ".pi", "agent", "sessions")],
    resumeCommand: (thread: AgentThread) =>
      thread.sessionPath ? ["pi", "--session", thread.sessionPath] : ["pi", "--resume"],
    newCommand: (cwd: string) => ["pi"],
  },
];

const providerShortNames: Record<ProviderId, string> = {
  codex: "CDX",
  claude: "CC",
  pi: "Pi",
};

export function providerShortName(id: ProviderId): string {
  return providerShortNames[id] ?? providerById(id).name;
}

export function providerById(id: ProviderId): ProviderDefinition {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

export async function checkProviderHealth(deps: ProviderHealthDeps = {}): Promise<ProviderHealth[]> {
  const resolveExecutable = deps.executablePath ?? executablePath;
  const resolveVersion = deps.commandVersion ?? commandVersion;

  return Promise.all(
    providers.map(async (provider) => {
      const path = await resolveExecutable(provider.command);
      if (!path) {
        return {
          provider: provider.id,
          installed: false,
          error: `${provider.command} was not found on PATH`,
        };
      }

      const version = await resolveVersion(provider.command);
      return {
        provider: provider.id,
        installed: true,
        path,
        version: cleanVersionLine(version),
      };
    }),
  );
}

async function executablePath(command: string): Promise<string | undefined> {
  return Bun.which(command) ?? undefined;
}

async function commandVersion(command: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn([command, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PI_OFFLINE: "1",
      },
    });

    const timeout = Bun.sleep(1_500).then(() => "timeout" as const);
    const exited = proc.exited;
    const result = await Promise.race([timeout, exited]);
    if (result === "timeout") {
      proc.kill();
      await proc.exited.catch(() => undefined);
      return undefined;
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    if (result !== 0) return undefined;
    return (stdout || stderr).trim().split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function cleanVersionLine(version: string | undefined): string | undefined {
  const line = version?.trim().split("\n")[0]?.trim();
  if (!line) return undefined;
  if (/^(error|exception|traceback|uncaught)\b/i.test(line)) return undefined;
  if (line.startsWith("/")) return undefined;
  return line;
}
