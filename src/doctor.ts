import { existsSync } from "node:fs";
import { discoverProviderThreads } from "./history.ts";
import { checkProviderHealth, providers } from "./providers.ts";
import { checkRuntimeHealth } from "./runtime-health.ts";
import type { ProviderHealth, ProviderId, RuntimeHealth } from "./types.ts";

export interface StoreStatus {
  path: string;
  exists: boolean;
}

export interface ProviderDoctorRow {
  provider: ProviderId;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
  rootHistoryCount: number;
  stores: StoreStatus[];
}

export interface DoctorReport {
  cwd: string;
  historyScope?: string;
  version: string;
  runtime: RuntimeHealth;
  providers: ProviderDoctorRow[];
  hints?: string[];
}

export async function collectDoctorReport(cwd = process.cwd(), version = "unknown"): Promise<DoctorReport> {
  const [health, runtime] = await Promise.all([checkProviderHealth(), checkRuntimeHealth()]);
  const rows = await Promise.all(
    providers.map(async (provider) => {
      const providerHealth = health.find((item) => item.provider === provider.id);
      const threads = await discoverProviderThreads(provider, cwd);
      return providerDoctorRow(provider.id, provider.name, provider.command, provider.sessionRoots, threads.length, providerHealth);
    }),
  );

  const report: DoctorReport = {
    cwd,
    historyScope: "current project and child directories",
    version,
    runtime,
    providers: rows,
  };

  return {
    ...report,
    hints: doctorHints(report),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const installed = report.providers.filter((provider) => provider.installed).length;
  const histories = report.providers.reduce((sum, provider) => sum + provider.rootHistoryCount, 0);
  const runtimeStatus = report.runtime.node.installed ? "runtime ok" : "runtime missing";
  const lines = [
    "amux doctor",
    `version: ${report.version}`,
    `cwd: ${report.cwd}`,
    `history scope: ${report.historyScope ?? "current project and child directories"}`,
    "",
    "runtime:",
    `  Node.js (node): ${report.runtime.node.installed ? "ok" : "missing"}`,
    `    ${report.runtime.node.version ?? report.runtime.node.error ?? report.runtime.node.path ?? "available"}`,
    ...(report.runtime.node.path ? [`    path: ${report.runtime.node.path}`] : []),
    "",
    "providers:",
  ];

  for (const provider of report.providers) {
    const status = provider.installed ? "ok" : "missing";
    const detail = provider.installed ? provider.version ?? "available" : provider.error ?? `install ${provider.command}`;
    lines.push(`  ${provider.name} (${provider.command}): ${status}`);
    lines.push(`    ${detail}`);
    if (provider.path) {
      lines.push(`    path: ${provider.path}`);
    }
    lines.push(`    root histories (current project): ${provider.rootHistoryCount}`);
    lines.push(`    stores: ${formatStores(provider.stores)}`);
  }

  lines.push("");
  lines.push(
    `summary: ${histories} current-project root ${histories === 1 ? "history" : "histories"}, ${installed}/${report.providers.length} provider CLIs available, ${runtimeStatus}`,
  );
  lines.push("");
  lines.push("next steps:");
  for (const hint of report.hints ?? doctorHints(report)) {
    lines.push(`  - ${hint}`);
  }
  return lines.join("\n");
}

export function doctorHints(report: DoctorReport): string[] {
  const hints: string[] = [];
  const missingProviders = report.providers.filter((provider) => !provider.installed);
  const histories = report.providers.reduce((sum, provider) => sum + provider.rootHistoryCount, 0);

  if (!report.runtime.node.installed) {
    hints.push("Install Node.js and make sure node is on PATH; live panes need the Node PTY host.");
  }

  if (missingProviders.length > 0) {
    hints.push(`Install or expose missing provider CLIs on PATH: ${missingProviders.map((provider) => provider.command).join(", ")}.`);
  }

  if (histories === 0) {
    hints.push("Open amux from a project directory and start a provider session to create the first root history.");
  }

  if (hints.length === 0) {
    hints.push("Run amux to open the TUI, then press ? for navigation help.");
  }

  return hints;
}

function providerDoctorRow(
  provider: ProviderId,
  name: string,
  command: string,
  sessionRoots: string[],
  rootHistoryCount: number,
  health?: ProviderHealth,
): ProviderDoctorRow {
  return {
    provider,
    name,
    command,
    installed: health?.installed ?? false,
    version: health?.version,
    path: health?.path,
    error: health?.error,
    rootHistoryCount,
    stores: sessionRoots.map((path) => ({ path: shortPath(path), exists: existsSync(path) })),
  };
}

function formatStores(stores: StoreStatus[]): string {
  if (stores.length === 0) return "none configured";
  return stores.map((store) => `${store.exists ? "ok" : "missing"} ${store.path}`).join("; ");
}

function shortPath(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? path.replace(home, "~") : path;
}
