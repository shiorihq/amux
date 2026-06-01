import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { discoverProviderThreads, isProjectPath, parseHistory, projectSessionRoots } from "./history.ts";
import type { ProviderDefinition } from "./types.ts";

describe("parseHistory", () => {
  test("extracts Codex session metadata and title", () => {
    const parsed = parseHistory(
      "codex",
      "/tmp/rollout-2026-05-25T00-00-00-abc.jsonl",
      [
        JSON.stringify({
          timestamp: "2026-05-25T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "abc", cwd: "/repo", model: "gpt-5.4" },
        }),
        JSON.stringify({ type: "ai-title", aiTitle: "Fix auth flow" }),
      ].join("\n"),
    );

    expect(parsed.id).toBe("abc");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.title).toBe("Fix auth flow");
    expect(parsed.tags).toContain("gpt-5.4");
  });

  test("extracts Claude user prompts", () => {
    const parsed = parseHistory(
      "claude",
      "/tmp/0e52.jsonl",
      JSON.stringify({
        type: "user",
        sessionId: "0e52",
        cwd: "/repo",
        timestamp: "2026-05-15T12:17:38.767Z",
        message: { role: "user", content: "replace links" },
      }),
    );

    expect(parsed.id).toBe("0e52");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.title).toBe("replace links");
    expect(parsed.messageCount).toBe(1);
  });

  test("marks Claude sidechain subagent sessions", () => {
    const parsed = parseHistory(
      "claude",
      "/tmp/agent-a.jsonl",
      JSON.stringify({
        type: "user",
        isSidechain: true,
        agentId: "agent-a",
        sessionId: "root-session",
        cwd: "/repo",
        timestamp: "2026-05-15T12:17:38.767Z",
        message: { role: "user", content: "audit this in a subagent" },
      }),
    );

    expect(parsed.isSidechain).toBe(true);
    expect(parsed.id).toBe("root-session");
  });

  test("extracts Pi session files", () => {
    const parsed = parseHistory(
      "pi",
      "/tmp/2026-03-14T10-27-38-663Z_9fa5.jsonl",
      [
        JSON.stringify({ type: "session", id: "9fa5", timestamp: "2026-03-14T10:27:38.663Z", cwd: "/repo" }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "Fix TS errors" }] },
        }),
      ].join("\n"),
    );

    expect(parsed.id).toBe("9fa5");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.preview).toBe("Fix TS errors");
  });
});

describe("isProjectPath", () => {
  test("accepts the project root and child working directories", () => {
    expect(isProjectPath("/repo/app", "/repo/app")).toBe(true);
    expect(isProjectPath("/repo/app/packages/cli", "/repo/app")).toBe(true);
  });

  test("rejects sibling and parent projects", () => {
    expect(isProjectPath("/repo/application", "/repo/app")).toBe(false);
    expect(isProjectPath("/repo", "/repo/app")).toBe(false);
  });
});

describe("discoverProviderThreads", () => {
  test("only returns histories for the active project", async () => {
    const root = mkdtempSync(join(tmpdir(), "amux-history-"));
    const provider: ProviderDefinition = {
      id: "codex",
      name: "Codex",
      command: "codex",
      home: root,
      sessionRoots: [root],
      resumeCommand: (thread) => ["codex", "resume", thread.sessionId ?? thread.id],
      newCommand: (cwd) => ["codex", "--cd", cwd],
    };

    await Bun.write(
      join(root, "rollout-2026-05-30T10-00-00-current.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { id: "current", cwd: "/repo/app" }, timestamp: "2026-05-30T10:00:00Z" }),
    );
    await Bun.write(
      join(root, "rollout-2026-05-30T10-01-00-child.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { id: "child", cwd: "/repo/app/packages/cli" }, timestamp: "2026-05-30T10:01:00Z" }),
    );
    await Bun.write(
      join(root, "rollout-2026-05-30T10-02-00-other.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { id: "other", cwd: "/repo/other" }, timestamp: "2026-05-30T10:02:00Z" }),
    );

    const threads = await discoverProviderThreads(provider, "/repo/app");

    expect(threads.map((thread) => thread.sessionId).sort()).toEqual(["child", "current"]);
  });

  test("uses only current project directories for project-scoped stores", () => {
    const root = mkdtempSync(join(tmpdir(), "amux-history-roots-"));
    const current = join(root, "-repo-app");
    const child = join(root, "-repo-app-packages-cli");
    const sibling = join(root, "-repo-application");
    const parent = join(root, "-repo");

    mkdirSync(current);
    mkdirSync(child);
    mkdirSync(sibling);
    mkdirSync(parent);

    expect(projectSessionRoots("claude", [root], "/repo/app").sort()).toEqual([child, current].sort());
    expect(projectSessionRoots("codex", [root], "/repo/app")).toEqual([root]);
  });

  test("excludes Claude subagent histories from root discovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "amux-claude-subagents-"));
    const project = join(root, "-repo-app");
    const subagents = join(project, "subagents");
    mkdirSync(project);
    mkdirSync(subagents);

    const provider: ProviderDefinition = {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      home: root,
      sessionRoots: [root],
      resumeCommand: (thread) => ["claude", "--resume", thread.sessionId ?? thread.id],
      newCommand: (cwd) => ["claude", "--add-dir", cwd],
    };

    await Bun.write(
      join(project, "root.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId: "root",
        cwd: "/repo/app",
        timestamp: "2026-05-30T10:00:00Z",
        message: { role: "user", content: "root work" },
      }),
    );
    await Bun.write(
      join(project, "sidechain.jsonl"),
      JSON.stringify({
        type: "user",
        isSidechain: true,
        agentId: "agent-a",
        sessionId: "sidechain",
        cwd: "/repo/app",
        timestamp: "2026-05-30T10:01:00Z",
        message: { role: "user", content: "subagent work" },
      }),
    );
    await Bun.write(
      join(subagents, "nested.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId: "nested",
        cwd: "/repo/app",
        timestamp: "2026-05-30T10:02:00Z",
        message: { role: "user", content: "nested subagent work" },
      }),
    );

    const threads = await discoverProviderThreads(provider, "/repo/app");

    expect(threads.map((thread) => thread.sessionId)).toEqual(["root"]);
  });

  test("keeps hyphenated project directories eligible for metadata filtering", () => {
    const root = mkdtempSync(join(tmpdir(), "amux-history-hyphen-"));
    const current = join(root, "-repo-my-app");
    const possibleSibling = join(root, "-repo-my-app-v2");

    mkdirSync(current);
    mkdirSync(possibleSibling);

    expect(projectSessionRoots("claude", [root], "/repo/my-app").sort()).toEqual([current, possibleSibling].sort());
  });
});
