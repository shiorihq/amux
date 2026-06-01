import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { providers } from "./providers.ts";
import type { AgentThread, ProviderDefinition, ProviderId } from "./types.ts";

const MAX_FILES_PER_PROVIDER = 500;
const MAX_LINES_PER_FILE = 400;
const MAX_BYTES_PER_FILE = 256 * 1024;

interface ParsedHistory {
  id?: string;
  title?: string;
  cwd?: string;
  isSidechain?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  messageCount: number;
  preview?: string;
  tags: string[];
}

export async function discoverThreads(cwd = process.cwd()): Promise<AgentThread[]> {
  const history = await Promise.all(providers.map((provider) => discoverProviderThreads(provider, cwd)));
  const threads = history
    .flat()
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));

  return [...starterThreads(cwd), ...threads];
}

export async function discoverProviderThreads(provider: ProviderDefinition, cwd = process.cwd()): Promise<AgentThread[]> {
  const files = projectSessionRoots(provider.id, provider.sessionRoots, cwd)
    .flatMap((root) => findSessionFiles(root))
    .filter((file) => !isSubagentSessionPath(provider.id, file));
  const threads: AgentThread[] = [];

  for (let index = 0; index < files.length && threads.length < MAX_FILES_PER_PROVIDER; index += 32) {
    const parsed = await Promise.all(files.slice(index, index + 32).map((file) => parseThreadFile(provider, file)));
    for (const thread of parsed) {
      if (thread && isProjectThread(thread, cwd)) {
        threads.push(thread);
      }
    }
  }

  return dedupeThreads(threads);
}

export function starterThreads(cwd: string): AgentThread[] {
  return providers.map((provider) => ({
    id: `${provider.id}:new`,
    provider: provider.id,
    providerName: provider.name,
    title: `Start ${provider.name} session`,
    cwd,
    source: "new",
    messageCount: 0,
    command: provider.newCommand(cwd),
    preview: `Start ${provider.command} in this workspace.`,
    tags: ["new", provider.command],
  }));
}

export function projectSessionRoots(provider: ProviderId, roots: string[], cwd: string): string[] {
  if (!usesProjectDirectoryRoots(provider)) return roots;

  return roots.flatMap((root) => projectDirectoriesForRoot(root, cwd));
}

function projectDirectoriesForRoot(root: string, cwd: string): string[] {
  if (!existsSync(root)) return [];

  let entries: string[] = [];
  try {
    entries = Array.from(new Bun.Glob("*").scanSync({ cwd: root, onlyFiles: false, dot: true }));
  } catch {
    return [];
  }

  const directories: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;
    const decoded = decodeDashedPath(entry);
    if ((decoded && isProjectPath(decoded, cwd)) || isEncodedProjectPath(entry, cwd)) {
      directories.push(path);
    }
  }

  return directories;
}

function findSessionFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  const files: Array<{ path: string; mtime: number }> = [];
  const pending = [root];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (!dir) continue;

    let entries: string[] = [];
    try {
      entries = Array.from(new Bun.Glob("*").scanSync({ cwd: dir, onlyFiles: false, dot: true }));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = join(dir, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        pending.push(path);
      } else if (path.endsWith(".jsonl")) {
        files.push({ path, mtime: stat.mtimeMs });
      }
    }
  }

  return files.sort((a, b) => b.mtime - a.mtime).map((file) => file.path);
}

async function parseThreadFile(provider: ProviderDefinition, path: string): Promise<AgentThread | undefined> {
  const content = await Bun.file(path)
    .slice(0, MAX_BYTES_PER_FILE)
    .text()
    .catch(() => "");
  if (!content.trim()) return undefined;

  const parsed = parseHistory(provider.id, path, content);
  if (parsed.isSidechain) return undefined;

  const id = parsed.id ?? idFromPath(provider.id, path);
  const cwd = parsed.cwd ?? cwdFromPath(provider.id, path);
  if (!cwd) return undefined;
  const updatedAt = fileDate(path) ?? parsed.updatedAt;
  const title = parsed.title ?? titleFromPath(path);
  const thread: AgentThread = {
    id: `${provider.id}:${id}`,
    provider: provider.id,
    providerName: provider.name,
    title: cleanTitle(title),
    cwd,
    sessionId: id,
    sessionPath: path,
    updatedAt,
    createdAt: parsed.createdAt,
    messageCount: parsed.messageCount,
    source: "history",
    command: provider.resumeCommand({
      id,
      provider: provider.id,
      providerName: provider.name,
      title,
      cwd,
      sessionId: id,
      sessionPath: path,
      updatedAt,
      createdAt: parsed.createdAt,
      messageCount: parsed.messageCount,
      source: "history",
      command: [],
      preview: "",
      tags: [],
    }),
    preview: parsed.preview ?? "",
    tags: parsed.tags,
  };

  return thread;
}

export function parseHistory(provider: ProviderId, path: string, content: string): ParsedHistory {
  const result: ParsedHistory = {
    messageCount: 0,
    tags: [],
  };

  const lines = content.split("\n").filter(Boolean);
  for (const line of lines.slice(0, MAX_LINES_PER_FILE)) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = parseDate(entry.timestamp ?? entry.message?.timestamp ?? entry.payload?.timestamp);
    if (timestamp) {
      result.createdAt ??= timestamp;
      result.updatedAt = timestamp;
    }

    if (provider === "codex") readCodexEntry(entry, result);
    if (provider === "claude") readClaudeEntry(entry, result);
    if (provider === "pi") readPiEntry(entry, result);
  }

  result.id ??= idFromPath(provider, path);
  return result;
}

function readCodexEntry(entry: any, result: ParsedHistory): void {
  if (entry.type === "session_meta") {
    result.id ??= entry.payload?.id;
    result.cwd ??= entry.payload?.cwd;
    result.createdAt ??= parseDate(entry.payload?.timestamp);
    pushTag(result, entry.payload?.model);
    pushTag(result, entry.payload?.source);
  }

  if (entry.type === "ai-title" || entry.payload?.type === "ai-title") {
    result.title ??= entry.aiTitle ?? entry.payload?.aiTitle;
  }

  const role = entry.payload?.role ?? entry.payload?.message?.role;
  const content = entry.payload?.content ?? entry.payload?.message?.content;
  if (role === "user") {
    acceptMessageText(result, content);
  }
}

function readClaudeEntry(entry: any, result: ParsedHistory): void {
  if (entry.isSidechain === true || typeof entry.agentId === "string") {
    result.isSidechain = true;
  }

  result.id ??= entry.sessionId;
  result.cwd ??= entry.cwd;
  pushTag(result, entry.version);
  pushTag(result, entry.gitBranch);

  if (entry.type === "summary" || entry.type === "custom-title") {
    result.title ??= entry.summary ?? entry.title ?? entry.name;
  }

  if (entry.type === "user" && entry.message?.role === "user") {
    acceptMessageText(result, entry.message.content);
  }
}

function readPiEntry(entry: any, result: ParsedHistory): void {
  if (entry.type === "session") {
    result.id ??= entry.id;
    result.cwd ??= entry.cwd;
    result.createdAt ??= parseDate(entry.timestamp);
  }

  if (entry.type === "model_change") {
    pushTag(result, entry.modelId);
    pushTag(result, entry.provider);
  }

  if (entry.type === "message") {
    const role = entry.message?.role;
    if (role === "user") {
      acceptMessageText(result, entry.message.content);
    }
  }
}

function acceptMessageText(result: ParsedHistory, content: unknown): void {
  const text = contentToText(content);
  if (!text) return;

  result.messageCount += 1;
  result.preview ??= text;
  result.title ??= text;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" || part?.type === "input_text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

function idFromPath(provider: ProviderId, path: string): string {
  const file = basename(path, ".jsonl");
  if (provider === "codex") {
    const match = file.match(/rollout-[^-]+-\d\d-\d\dT\d\d-\d\d-\d\d-([a-f0-9-]+)/);
    return match?.[1] ?? file.replace(/^rollout-/, "");
  }
  if (provider === "pi") {
    return file.split("_").at(-1) ?? file;
  }
  return file;
}

function cwdFromPath(provider: ProviderId, path: string): string | undefined {
  if (provider === "claude") {
    return decodeDashedPath(basename(dirname(path)));
  }

  if (provider === "pi") {
    return decodeDashedPath(basename(dirname(path)));
  }

  return undefined;
}

function decodeDashedPath(value: string): string | undefined {
  if (!value.startsWith("-") && !value.startsWith("--")) return undefined;
  const normalized = value.replace(/^--?/, sep).replace(/--$/, "").replaceAll("-", sep);
  return normalized.length > 1 ? normalized : undefined;
}

function isEncodedProjectPath(value: string, cwd: string): boolean {
  const encoded = encodeDashedPath(cwd);
  return value === encoded || value.startsWith(`${encoded}-`);
}

function encodeDashedPath(value: string): string {
  const body = normalizePath(value).split(sep).filter(Boolean).join("-");
  return body ? `-${body}` : "-";
}

function titleFromPath(path: string): string {
  return basename(path, ".jsonl").replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 90) || "Untitled history";
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function fileDate(path: string): Date | undefined {
  try {
    return statSync(path).mtime;
  } catch {
    return undefined;
  }
}

export function isProjectThread(thread: AgentThread, cwd: string): boolean {
  return isProjectPath(thread.cwd, cwd);
}

export function isProjectPath(candidate: string, project: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedProject = normalizePath(project);
  const pathBetween = relative(normalizedProject, normalizedCandidate);
  return pathBetween === "" || (pathBetween !== "" && !pathBetween.startsWith("..") && !isAbsolute(pathBetween));
}

function normalizePath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return resolve(value);
  }
}

function pushTag(result: ParsedHistory, value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") return;
  if (!result.tags.includes(value)) {
    result.tags.push(value);
  }
}

function isSubagentSessionPath(provider: ProviderId, path: string): boolean {
  return provider === "claude" && path.split(sep).includes("subagents");
}

function usesProjectDirectoryRoots(provider: ProviderId): boolean {
  return provider === "claude" || provider === "pi";
}

function dedupeThreads(threads: AgentThread[]): AgentThread[] {
  const seen = new Set<string>();
  const result: AgentThread[] = [];

  for (const thread of threads) {
    const key = `${thread.provider}:${thread.sessionId ?? thread.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(thread);
  }

  return result;
}
