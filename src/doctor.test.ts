import { expect, test } from "bun:test";
import { collectDoctorReport, doctorHints, formatDoctorReport, type DoctorReport } from "./doctor.ts";

test("formatDoctorReport summarizes provider health and root histories", () => {
  const report: DoctorReport = {
    version: "0.1.0",
    cwd: "/repo/app",
    runtime: {
      node: {
        installed: true,
        version: "v25.0.0",
        path: "/usr/bin/node",
      },
    },
    providers: [
      {
        provider: "codex",
        name: "Codex",
        command: "codex",
        installed: true,
        version: "codex 1.0.0",
        path: "/bin/codex",
        rootHistoryCount: 2,
        stores: [{ path: "~/.codex/sessions", exists: true }],
      },
      {
        provider: "claude",
        name: "Claude Code",
        command: "claude",
        installed: false,
        error: "claude was not found on PATH",
        rootHistoryCount: 0,
        stores: [{ path: "~/.claude/projects", exists: false }],
      },
      {
        provider: "pi",
        name: "Pi",
        command: "pi",
        installed: true,
        path: "/bin/pi",
        rootHistoryCount: 1,
        stores: [{ path: "~/.pi/agent/sessions", exists: true }],
      },
    ],
  };

  const output = formatDoctorReport(report);

  expect(output).toContain("amux doctor");
  expect(output).toContain("version: 0.1.0");
  expect(output).toContain("history scope: current project and child directories");
  expect(output).toContain("Node.js (node): ok");
  expect(output).toContain("path: /usr/bin/node");
  expect(output).toContain("Codex (codex): ok");
  expect(output).toContain("Claude Code (claude): missing");
  expect(output).toContain("stores: missing ~/.claude/projects");
  expect(output).toContain("root histories (current project): 2");
  expect(output).toContain("summary: 3 current-project root histories, 2/3 provider CLIs available, runtime ok");
  expect(output).toContain("next steps:");
  expect(output).toContain("Install or expose missing provider CLIs on PATH: claude.");
});

test("doctorHints gives actionable first-run guidance", () => {
  const report: DoctorReport = {
    version: "0.1.0",
    cwd: "/repo/app",
    runtime: {
      node: {
        installed: false,
        error: "node was not found on PATH",
      },
    },
    providers: [
      {
        provider: "codex",
        name: "Codex",
        command: "codex",
        installed: false,
        error: "codex was not found on PATH",
        rootHistoryCount: 0,
        stores: [{ path: "~/.codex/sessions", exists: false }],
      },
      {
        provider: "claude",
        name: "Claude Code",
        command: "claude",
        installed: false,
        error: "claude was not found on PATH",
        rootHistoryCount: 0,
        stores: [{ path: "~/.claude/projects", exists: false }],
      },
      {
        provider: "pi",
        name: "Pi",
        command: "pi",
        installed: false,
        error: "pi was not found on PATH",
        rootHistoryCount: 0,
        stores: [{ path: "~/.pi/agent/sessions", exists: false }],
      },
    ],
  };

  expect(doctorHints(report)).toEqual([
    "Install Node.js and make sure node is on PATH; live panes need the Node PTY host.",
    "Install or expose missing provider CLIs on PATH: codex, claude, pi.",
    "Open amux from a project directory and start a provider session to create the first root history.",
  ]);
});

test("doctorHints keeps healthy reports short", () => {
  const report: DoctorReport = {
    version: "0.1.0",
    cwd: "/repo/app",
    runtime: {
      node: {
        installed: true,
        version: "v25.0.0",
        path: "/usr/bin/node",
      },
    },
    providers: [
      {
        provider: "codex",
        name: "Codex",
        command: "codex",
        installed: true,
        version: "codex 1.0.0",
        path: "/bin/codex",
        rootHistoryCount: 1,
        stores: [{ path: "~/.codex/sessions", exists: true }],
      },
    ],
  };

  expect(doctorHints(report)).toEqual(["Run amux to open the TUI, then press ? for navigation help."]);
});

test("collectDoctorReport includes hints for JSON diagnostics", async () => {
  const report = await collectDoctorReport("/tmp/amux-project-that-should-not-have-histories", "0.1.0-test");

  expect(report.version).toBe("0.1.0-test");
  expect(report.hints).toBeDefined();
  expect(report.hints?.length).toBeGreaterThan(0);
});
