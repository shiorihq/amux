import { expect, test } from "bun:test";
import type { AgentThread, ProviderHealth } from "./types.ts";
import type { TerminalLine } from "./pty.ts";
import {
  activeCommandLine,
  buildActionPaletteActions,
  buildHelpSections,
  buildProviderStatusRows,
  buildRuntimeStatusRow,
  buildSidebarRows,
  exitGuardNotice,
  filterBackspaceState,
  filterActionPaletteActions,
  focusModeLabel,
  footerHelpText,
  formatNotice,
  fuzzyIncludes,
  headerHealthLabel,
  helpPanelLayout,
  helpModeActionClosesOverlay,
  helpModeKeyAction,
  joinStatusLine,
  metricRowParts,
  nextSelectedIndexAfterRefresh,
  nextProviderSelectionIndex,
  onboardingCardWidths,
  onboardingNextAction,
  onboardingStatusText,
  paneStripCardWidth,
  paneStripEmptyCopy,
  paneStripPositionLabel,
  paneStripStatusLine,
  paneStripTitleWidth,
  projectDisplayName,
  newSessionPickerProviders,
  findReusableRuntimeId,
  reusablePaneNotice,
  runtimeStatusLabel,
  runtimeStatusText,
  sidebarEmptyCopy,
  sidebarLoadingStatusText,
  sidebarScrollHintText,
  sidebarThreadRowParts,
  shouldCloseOverlayForExitRequest,
  shouldAppendPrintableToFilter,
  shouldOpenActionPalette,
  shouldOpenNewSessionPicker,
  terminalHeaderParts,
  terminalFocusBlockedNotice,
  terminalLineStyledText,
  threadMatchesFilter,
  threadCountLabel,
  visiblePaneSlotIndexes,
  visiblePaneSlots,
  windowSidebarRows,
  workspaceTitle,
  wrapIndex,
} from "./ui.tsx";

function thread(id: string, source: AgentThread["source"], ageMs: number): AgentThread {
  return {
    id,
    provider: "codex",
    providerName: "Codex",
    title: `thread ${id}`,
    cwd: "/tmp/project",
    source,
    messageCount: 1,
    command: [],
    preview: "",
    tags: [],
    updatedAt: source === "new" ? undefined : new Date(Date.now() - ageMs),
  };
}

function providerThread(id: string, provider: AgentThread["provider"]): AgentThread {
  return {
    ...thread(id, "history", 60 * 1000),
    provider,
    providerName: provider === "claude" ? "Claude Code" : provider === "codex" ? "Codex" : "Pi",
  };
}

const DAY = 86_400_000;

test("buildSidebarRows groups new launchers and history by recency", () => {
  const threads = [
    thread("new-codex", "new", 0),
    thread("a", "history", 1 * 60 * 1000), // today
    thread("b", "history", 2 * 60 * 1000), // today
    thread("c", "history", 1.5 * DAY), // yesterday
    thread("d", "history", 10 * DAY), // past month
  ];

  const rows = buildSidebarRows(threads);
  const headers = rows.filter((row) => row.kind === "header");

  expect(headers.map((header) => header.kind === "header" && header.label)).toEqual([
    "Start a session",
    "Today",
    "Yesterday",
    "Past month",
  ]);

  // Every thread keeps its original selection index.
  const threadRows = rows.filter((row) => row.kind === "thread");
  expect(threadRows.map((row) => (row.kind === "thread" ? row.index : -1))).toEqual([0, 1, 2, 3, 4]);

  // "Today" header counts both of its threads.
  const today = headers.find((header) => header.kind === "header" && header.label === "Today");
  expect(today && today.kind === "header" && today.count).toBe(2);
});

test("windowSidebarRows always keeps the selected thread visible", () => {
  const threads = Array.from({ length: 30 }, (_, i) => thread(`t${i}`, "history", (i + 1) * 60 * 1000));
  const rows = buildSidebarRows(threads);
  const budget = 12; // ~6 thread rows worth of lines

  const selectedRow = rows.findIndex((row) => row.kind === "thread" && row.index === 20);
  const { rows: visible, hiddenAbove, hiddenBelow } = windowSidebarRows(rows, selectedRow, budget);

  const selectedVisible = visible.some((row) => row.kind === "thread" && row.index === 20);
  expect(selectedVisible).toBe(true);

  // The window never exceeds the height budget.
  const used = visible.length;
  expect(used).toBeLessThanOrEqual(budget);

  // Hidden counts reconcile with the total thread count.
  const shown = visible.filter((row) => row.kind === "thread").length;
  expect(hiddenAbove + shown + hiddenBelow).toBe(30);
});

test("windowSidebarRows reports no overflow when everything fits", () => {
  const threads = [thread("a", "history", 60 * 1000), thread("b", "history", 120 * 1000)];
  const rows = buildSidebarRows(threads);
  const { hiddenAbove, hiddenBelow } = windowSidebarRows(rows, 1, 100);
  expect(hiddenAbove).toBe(0);
  expect(hiddenBelow).toBe(0);
});

test("windowSidebarRows handles an empty list", () => {
  expect(windowSidebarRows([], -1, 20)).toEqual({ rows: [], hiddenAbove: 0, hiddenBelow: 0 });
});

test("buildProviderStatusRows summarizes checking, ready, and missing providers", () => {
  const health: ProviderHealth[] = [
    { provider: "codex", installed: true, path: "/bin/codex", version: "codex 1.0.0" },
    { provider: "claude", installed: false, error: "claude was not found on PATH" },
  ];

  const readyRows = buildProviderStatusRows(health, "ready");
  expect(readyRows.map((row) => [row.provider, row.state])).toEqual([
    ["codex", "ready"],
    ["claude", "missing"],
    ["pi", "missing"],
  ]);
  expect(readyRows[0]?.detail).toBe("codex 1.0.0");

  const loadingRows = buildProviderStatusRows([], "loading");
  expect(loadingRows.every((row) => row.state === "checking")).toBe(true);
});

test("buildRuntimeStatusRow summarizes Node runtime health", () => {
  expect(buildRuntimeStatusRow(undefined, "loading")).toEqual({
    label: "Node.js",
    state: "checking",
    detail: "checking node",
  });

  expect(buildRuntimeStatusRow({ node: { installed: true, version: "v25.0.0", path: "/usr/bin/node" } }, "ready")).toEqual({
    label: "Node.js",
    state: "ready",
    detail: "v25.0.0",
  });

  expect(buildRuntimeStatusRow({ node: { installed: false, error: "node was not found on PATH" } }, "ready")).toEqual({
    label: "Node.js",
    state: "missing",
    detail: "install node",
  });
});

test("sidebarLoadingStatusText keeps the loading copy singular", () => {
  expect(sidebarLoadingStatusText("⠋", 1)).toBe("⠋ scanning 1 provider");
  expect(sidebarLoadingStatusText("", 3)).toBe("scanning 3 providers");
});

test("sidebarThreadRowParts keeps sidebar rows compact", () => {
  const row = sidebarThreadRowParts(
    {
      ...thread("a", "history", 60 * 1000),
      title: "Make sidebar design much more minimal and robust",
      providerName: "Claude Code",
      messageCount: 2,
      preview: "",
      tags: [],
      cwd: "/repo/app",
    },
    44,
    true,
  );

  expect(row.title.length).toBeGreaterThan(0);
  expect(row.meta).toContain("CDX");
  expect(row.meta).not.toContain("msg");
  expect(row.title.length + row.meta.length + 5).toBeLessThanOrEqual(44);
});

test("thread filtering supports fuzzy token matching", () => {
  const target = {
    ...thread("auth", "history", 60 * 1000),
    title: "Fix authentication callback",
    providerName: "Claude Code",
    cwd: "/repo/amux/packages/cli",
    preview: "Repair OAuth redirect state",
    tags: ["main"],
  };

  expect(fuzzyIncludes("authentication callback", "authcb")).toBe(true);
  expect(threadMatchesFilter(target, "clde authcb")).toBe(true);
  expect(threadMatchesFilter(target, "oauth cli")).toBe(true);
  expect(threadMatchesFilter(target, "zzzz")).toBe(false);
});

test("filterBackspaceState preserves selection when filter is empty", () => {
  expect(filterBackspaceState("", 8)).toEqual({ filter: "", selected: 8 });
  expect(filterBackspaceState("auth", 8)).toEqual({ filter: "aut", selected: 0 });
});

test("shouldAppendPrintableToFilter lets active filters receive shortcut letters", () => {
  expect(shouldAppendPrintableToFilter("auth", { name: "q", raw: "q" })).toBe(true);
  expect(shouldAppendPrintableToFilter("auth", { name: "r", raw: "r" })).toBe(true);
  expect(shouldAppendPrintableToFilter("auth", { name: "j", raw: "j" })).toBe(true);
  expect(shouldAppendPrintableToFilter("", { name: "q", raw: "q" })).toBe(false);
  expect(shouldAppendPrintableToFilter("auth", { name: "backspace", raw: "\u007f" })).toBe(false);
  expect(shouldAppendPrintableToFilter("auth", { name: "tab", raw: "\t" })).toBe(false);
  expect(shouldAppendPrintableToFilter("auth", { name: "c", raw: "c", ctrl: true })).toBe(false);
});

test("footerHelpText reflects active filter key behavior", () => {
  const idle = footerHelpText({ focusMode: "threads", runtimeCount: 1, width: 140, filterActive: false });
  expect(idle).toContain("q quit");
  expect(idle).toContain("type filters");

  const filtering = footerHelpText({ focusMode: "threads", runtimeCount: 1, width: 140, filterActive: true });
  expect(filtering).toContain("typing extends query");
  expect(filtering).toContain("Esc clear");
  expect(filtering).toContain("? help");
  expect(filtering).not.toContain("q quit");

  const terminal = footerHelpText({ focusMode: "terminal", runtimeCount: 2, width: 140, filterActive: true });
  expect(terminal).toContain("agent focused");
  expect(terminal).toContain("panes 2");
  expect(terminal).not.toContain("Esc clear");
});

test("helpModeKeyAction keeps help from editing the hidden filter", () => {
  expect(shouldAppendPrintableToFilter("auth", { name: "j", raw: "j" })).toBe(true);
  expect(helpModeKeyAction({ name: "j" })).toBe("ignore");
  expect(helpModeKeyAction({ name: "q" })).toBe("quit");
  expect(helpModeKeyAction({ name: "r" })).toBe("refresh");
  expect(helpModeKeyAction({ name: "w", ctrl: true })).toBe("close-pane");
  expect(helpModeKeyAction({ name: "left", ctrl: true })).toBe("previous-pane");
  expect(helpModeKeyAction({ name: "right", ctrl: true })).toBe("next-pane");
});

test("helpModeActionClosesOverlay keeps app-command feedback visible", () => {
  expect(helpModeActionClosesOverlay("ignore")).toBe(false);
  expect(helpModeActionClosesOverlay("quit")).toBe(true);
  expect(helpModeActionClosesOverlay("refresh")).toBe(true);
  expect(helpModeActionClosesOverlay("close-pane")).toBe(true);
  expect(helpModeActionClosesOverlay("previous-pane")).toBe(true);
  expect(helpModeActionClosesOverlay("next-pane")).toBe(true);
});

test("shouldCloseOverlayForExitRequest reveals the quit guard when panes are running", () => {
  expect(shouldCloseOverlayForExitRequest(0)).toBe(false);
  expect(shouldCloseOverlayForExitRequest(1)).toBe(true);
  expect(shouldCloseOverlayForExitRequest(3)).toBe(true);
});

test("shouldOpenNewSessionPicker only reacts to Shift+N in threads mode", () => {
  expect(shouldOpenNewSessionPicker({ name: "n", shift: true }, "threads")).toBe(true);
  expect(shouldOpenNewSessionPicker({ name: "n" }, "threads")).toBe(false);
  expect(shouldOpenNewSessionPicker({ name: "n", shift: true }, "terminal")).toBe(false);
  expect(shouldOpenNewSessionPicker({ name: "n", shift: true, ctrl: true }, "threads")).toBe(false);
});

test("shouldOpenActionPalette only reacts to Shift+P in threads mode", () => {
  expect(shouldOpenActionPalette({ name: "p", shift: true }, "threads")).toBe(true);
  expect(shouldOpenActionPalette({ name: "p" }, "threads")).toBe(false);
  expect(shouldOpenActionPalette({ name: "p", shift: true }, "terminal")).toBe(false);
  expect(shouldOpenActionPalette({ name: "p", shift: true, meta: true }, "threads")).toBe(false);
});

test("newSessionPickerProviders includes Codex, Claude Code, and Pi", () => {
  expect(newSessionPickerProviders().map((provider) => provider.id)).toEqual(["codex", "claude", "pi"]);
  expect(newSessionPickerProviders().map((provider) => provider.shortcut)).toEqual(["1", "2", "3"]);
});

test("buildActionPaletteActions exposes provider-compatible launch and context actions", () => {
  const actions = buildActionPaletteActions({
    selectedThread: providerThread("selected", "pi"),
    hasActiveRuntime: true,
    runtimeCount: 2,
    filterActive: true,
  });

  expect(actions.map((action) => action.id)).toContain("new:codex");
  expect(actions.map((action) => action.id)).toContain("new:claude");
  expect(actions.map((action) => action.id)).toContain("new:pi");
  expect(actions.map((action) => action.id)).toContain("launch-selected");
  expect(actions.map((action) => action.id)).toContain("focus-terminal");
  expect(actions.map((action) => action.id)).toContain("clear-filter");

  const filtered = filterActionPaletteActions(actions, "pi session");
  expect(filtered.some((action) => action.id === "new:pi")).toBe(true);
  expect(filtered.length).toBeLessThan(actions.length);
});

test("nextProviderSelectionIndex skips providers absent from the visible list", () => {
  const visible = [providerThread("codex-a", "codex"), providerThread("pi-a", "pi"), providerThread("pi-b", "pi")];

  expect(nextProviderSelectionIndex(visible, 0)).toBe(1);
  expect(nextProviderSelectionIndex(visible, 1)).toBe(0);
  expect(nextProviderSelectionIndex([providerThread("codex-a", "codex")], 0)).toBe(0);
  expect(nextProviderSelectionIndex([], 3)).toBe(3);
});

test("nextSelectedIndexAfterRefresh preserves the selected history when possible", () => {
  const selected = thread("b", "history", 120 * 1000);
  const refreshed = [thread("a", "history", 60 * 1000), selected, thread("c", "history", 180 * 1000)];

  expect(nextSelectedIndexAfterRefresh(selected, refreshed)).toBe(1);
  expect(nextSelectedIndexAfterRefresh(thread("missing", "history", 60 * 1000), refreshed)).toBe(0);
  expect(nextSelectedIndexAfterRefresh(undefined, refreshed)).toBe(0);
});

test("headerHealthLabel uses the Ora frame while loading", () => {
  expect(headerHealthLabel("loading", "⠋")).toBe("⠋ scanning");
  expect(headerHealthLabel("loading", "")).toBe("scanning");
  expect(headerHealthLabel("ready", "")).toBe("ready");
  expect(headerHealthLabel("error", "")).toBe("attention");
});

test("focusModeLabel uses user-facing navigation language", () => {
  expect(focusModeLabel("threads")).toBe("histories");
  expect(focusModeLabel("terminal")).toBe("terminal");
});

test("projectDisplayName shows a compact current-project badge", () => {
  expect(projectDisplayName("/home/dev/projects/amux")).toBe("amux");
  expect(projectDisplayName("/")).toBe("/");
});

test("workspaceTitle fits long active thread titles into the pane border", () => {
  expect(workspaceTitle(true, false, "Ignored", 30)).toBe(" help ");
  expect(workspaceTitle(false, true, "Ignored", 30)).toBe(" action palette ");
  expect(workspaceTitle(false, false, undefined, 30)).toBe(" terminal ");

  const title = workspaceTitle(false, false, "Investigate a very long provider session title", 24);
  expect(title.length).toBeLessThanOrEqual(22);
  expect(title.startsWith(" ")).toBe(true);
  expect(title.endsWith(" ")).toBe(true);
  expect(title).toContain("...");
});

test("threadCountLabel separates root histories from starters", () => {
  const threads = [
    thread("new-codex", "new", 0),
    thread("new-claude", "new", 0),
    thread("a", "history", 60 * 1000),
    thread("b", "history", 120 * 1000),
  ];

  expect(threadCountLabel(threads, threads, "")).toBe("2 roots · 2 starters");
  expect(threadCountLabel(threads.slice(0, 3), threads, "cod")).toBe("3 matches · 1/2 roots");
  expect(threadCountLabel([threads[2]!], threads, "auth")).toBe("1 match · 1/2 roots");
});

test("joinStatusLine drops secondary position before truncating the primary count", () => {
  expect(joinStatusLine("3 roots · 3 starters", "1/6", 30)).toBe("3 roots · 3 starters  ·  1/6");
  expect(joinStatusLine("3 roots · 3 starters", "1/6", 24)).toBe("3 roots · 3 starters");
});

test("buildHelpSections explains the pane strip and navigation controls", () => {
  const sections = buildHelpSections();
  const panes = sections.find((section) => section.title === "Panes");

  expect(sections.map((section) => section.title)).toContain("Histories");
  expect(sections.map((section) => section.title)).toContain("Terminal");
  expect(panes?.rows.some((row) => row.key === "top strip" && row.detail.includes("live PTY panes"))).toBe(true);
  expect(sections.flatMap((section) => section.rows).some((row) => row.key === "j/k" && row.detail.includes("filter is empty"))).toBe(true);
  expect(sections.flatMap((section) => section.rows).some((row) => row.key === "Tab" && row.detail.includes("visible provider"))).toBe(true);
  expect(sections.flatMap((section) => section.rows).some((row) => row.key === "Shift+N" && row.detail.includes("Codex, Claude Code, or Pi"))).toBe(true);
  expect(sections.flatMap((section) => section.rows).some((row) => row.key === "Shift+P" && row.detail.includes("action palette"))).toBe(true);
  expect(sections.flatMap((section) => section.rows).some((row) => row.key === "?")).toBe(true);
});

test("helpPanelLayout keeps compact and card rows inside available widths", () => {
  const compact = helpPanelLayout(48);
  expect(compact.compactKeyWidth + compact.compactDetailWidth).toBe(compact.contentWidth);

  for (const width of [90, 120, 180]) {
    const layout = helpPanelLayout(width);
    expect(layout.cardWidth * 4 + 3).toBeLessThanOrEqual(layout.contentWidth);
    expect(layout.cardKeyWidth + layout.cardDetailWidth).toBe(layout.cardTextWidth);
  }
});

test("terminalLineStyledText keeps terminal spacing in styled chunks", () => {
  const line: TerminalLine = {
    cols: 12,
    runs: [
      { text: "alpha " },
      { text: " beta" },
    ],
  };

  expect(terminalLineStyledText(line).chunks.map((chunk) => chunk.text).join("")).toBe("alpha  beta");
  expect(terminalLineStyledText({ cols: 4, runs: [] }).chunks[0]?.text).toBe("    ");
});

test("runtime status labels distinguish clean exits from failures", () => {
  expect(runtimeStatusLabel({ status: "starting" })).toBe("starting");
  expect(runtimeStatusLabel({ status: "running" })).toBe("running");
  expect(runtimeStatusLabel({ status: "exited", exitCode: 0 })).toBe("done");
  expect(runtimeStatusLabel({ status: "exited", exitCode: 2 })).toBe("exit 2");
  expect(runtimeStatusLabel({ status: "exited" })).toBe("exit ?");
  expect(runtimeStatusLabel({ status: "failed" })).toBe("failed");
  expect(runtimeStatusText({ status: "starting" }, "⠋")).toBe("⠋ starting");
  expect(runtimeStatusText({ status: "starting" }, "")).toBe("starting");
  expect(runtimeStatusText({ status: "running" }, "⠋")).toBe("running");
});

test("activeCommandLine reserves space for the status label", () => {
  const snapshot = {
    commandLabel: "codex resume a-very-long-session-id-that-would-not-fit",
    status: "exited" as const,
    exitCode: 2,
  };
  const line = activeCommandLine(
    snapshot,
    36,
  );

  expect(`${line} [exit 2]`.length).toBeLessThanOrEqual(32);
  expect(line.endsWith("...")).toBe(true);
  expect(line).toBe(terminalHeaderParts({ ...snapshot, scrollOffset: 0 }, 36).command);

  const starting = activeCommandLine(
    {
      commandLabel: "claude --resume a-very-long-session-id-that-would-not-fit",
      status: "starting",
    },
    36,
    "⠋",
  );
  expect(`${starting} [⠋ starting]`.length).toBeLessThanOrEqual(32);
});

test("terminalHeaderParts reserves space for status and scrollback", () => {
  const header = terminalHeaderParts(
    {
      commandLabel: "claude --resume a-very-long-session-id-that-would-not-fit",
      status: "running",
      scrollOffset: 128,
    },
    44,
  );

  expect(`${header.command}${header.status}${header.scrollback}`.length).toBeLessThanOrEqual(40);
  expect(header.command.endsWith("...")).toBe(true);
  expect(header.status).toBe(" [running]");
  expect(header.scrollback).toBe(" scrollback -128");
});

test("terminalHeaderParts degrades gracefully in narrow panes", () => {
  const header = terminalHeaderParts(
    {
      commandLabel: "claude --resume a-very-long-session-id-that-would-not-fit",
      status: "running",
      scrollOffset: 128_000,
    },
    18,
  );

  expect(`${header.command}${header.status}${header.scrollback}`.length).toBeLessThanOrEqual(14);
  expect(header.status).toBe(" [running]");
  expect(header.scrollback.endsWith("...")).toBe(true);
});

test("terminalHeaderParts does not invent ellipses when no command room remains", () => {
  const header = terminalHeaderParts(
    {
      commandLabel: "claude --resume a-very-long-session-id-that-would-not-fit",
      status: "running",
      scrollOffset: 128_000,
    },
    12,
  );

  expect(`${header.command}${header.status}${header.scrollback}`.length).toBeLessThanOrEqual(8);
  expect(header.command).toBe("");
});

test("onboarding text responds to first-run and ready states", () => {
  expect(onboardingStatusText("ready", "", "", 0, 1, 3)).toBe("Fresh project. Ready for a first agent session.");
  expect(onboardingNextAction("ready", 0, 1)).toContain("first session");
  expect(onboardingStatusText("ready", "", "", 4, 2, 3)).toBe("Ready with 4 root histories and 2/3 providers.");
  expect(onboardingNextAction("ready", 4, 2)).toContain("recent root history");
  expect(onboardingStatusText("error", "boom", "", 0, 0, 3)).toBe("boom");
});

test("onboardingCardWidths keeps card rows within the available content width", () => {
  for (const width of [96, 120, 180]) {
    const contentWidth = width - 6;
    const widths = onboardingCardWidths(width);

    expect(widths.feature * 3 + 2).toBeLessThanOrEqual(contentWidth);
    expect(widths.status * 4 + 3).toBeLessThanOrEqual(contentWidth);
    expect(widths.main).toBeGreaterThanOrEqual(12);
  }
});

test("metricRowParts fits long onboarding metric details", () => {
  const row = metricRowParts(30, "runtime", "ok", "/home/dev/.local/bin/node");
  const rendered = `${row.value}${row.label}${row.detail}`;

  expect(rendered.length).toBe(30);
  expect(row.detail.endsWith("...")).toBe(true);
});

test("wrapIndex cycles pane indices in both directions", () => {
  expect(wrapIndex(0, 3)).toBe(0);
  expect(wrapIndex(3, 3)).toBe(0);
  expect(wrapIndex(-1, 3)).toBe(2);
  expect(wrapIndex(7, 3)).toBe(1);
  expect(wrapIndex(2, 0)).toBe(0);
});

test("exitGuardNotice pluralizes running panes", () => {
  expect(exitGuardNotice(1)).toBe("Press q again to quit and close 1 running pane.");
  expect(exitGuardNotice(2)).toBe("Press q again to quit and close 2 running panes.");
});

test("terminalFocusBlockedNotice explains why Ctrl+G did nothing", () => {
  expect(terminalFocusBlockedNotice()).toBe("Launch an agent pane before entering terminal focus.");
});

test("findReusableRuntimeId reuses only live saved-history panes", () => {
  const history = { ...thread("abc", "history", 60 * 1000), sessionId: "abc" };
  const sameHistory = { ...thread("abc-copy", "history", 30 * 1000), sessionId: "abc" };
  const starter = thread("new-codex", "new", 0);

  expect(
    findReusableRuntimeId(sameHistory, [
      { id: "pane-1", thread: history, status: "running" },
      { id: "pane-2", thread: { ...history, sessionId: "done" }, status: "exited" },
    ]),
  ).toBe("pane-1");
  expect(findReusableRuntimeId(sameHistory, [{ id: "pane-1", thread: history, status: "exited" }])).toBeUndefined();
  expect(findReusableRuntimeId(starter, [{ id: "pane-1", thread: starter, status: "running" }])).toBeUndefined();
  expect(reusablePaneNotice("Codex")).toBe("That history is already running. Focused the existing Codex pane.");
});

test("sidebarEmptyCopy gives one clear next action", () => {
  expect(sidebarEmptyCopy("auth")).toEqual({
    title: "No matching histories",
    detail: "Press Esc to clear the filter.",
  });
  expect(sidebarEmptyCopy("")).toEqual({
    title: "No root histories yet",
    detail: "Start a provider session from the left rail.",
  });
});

test("sidebarScrollHintText matches visible-provider Tab behavior", () => {
  expect(sidebarScrollHintText(0, 0)).toBe("↵ launch  ·  tab visible provider");
  expect(sidebarScrollHintText(2, 4)).toBe("↑ 2   ↓ 4");
});

test("pane strip copy labels live panes directly", () => {
  expect(paneStripEmptyCopy()).toEqual({
    title: "live panes",
    detail: "None yet. Enter launches the selected history or starter.",
  });
  expect(paneStripPositionLabel(0, 3)).toBe("live pane 1/3");
  expect(paneStripPositionLabel(2, 3)).toBe("live pane 3/3");
});

test("formatNotice labels notice severity for scanning", () => {
  expect(formatNotice({ tone: "info", message: "No active pane." })).toBe("info: No active pane.");
  expect(formatNotice({ tone: "warning", message: "Press q again." })).toBe("warn: Press q again.");
  expect(formatNotice({ tone: "error", message: "Node.js is missing." })).toBe("error: Node.js is missing.");
});

test("visiblePaneSlotIndexes reports original pane positions", () => {
  expect(visiblePaneSlotIndexes(5, 4)).toEqual({ indexes: [2, 3, 4], hiddenCount: 2 });
  expect(visiblePaneSlotIndexes(5, 4, 1)).toEqual({ indexes: [1, 3, 4], hiddenCount: 2 });
});

test("visiblePaneSlots reserves a badge slot for hidden panes", () => {
  expect(visiblePaneSlots(["a", "b", "c"], 4)).toEqual({ visible: ["a", "b", "c"], hiddenCount: 0 });
  expect(visiblePaneSlots(["a", "b", "c", "d", "e"], 4)).toEqual({ visible: ["c", "d", "e"], hiddenCount: 2 });
  expect(visiblePaneSlots(["a", "b", "c", "d", "e"], 4, 1)).toEqual({ visible: ["b", "d", "e"], hiddenCount: 2 });
});

test("paneStripTitleWidth follows the available pane card width", () => {
  expect(paneStripCardWidth(120, 4)).toBe(29);
  expect(paneStripTitleWidth(120, 4)).toBe(25);
  expect(paneStripCardWidth(40, 4)).toBe(9);
  expect(paneStripTitleWidth(40, 4)).toBe(5);
  expect(paneStripCardWidth(8, 4)).toBe(8);
  expect(paneStripTitleWidth(8, 4)).toBe(4);
});

test("paneStripStatusLine fits status and title into one pane card line", () => {
  const line = paneStripStatusLine({ status: "starting", title: "a long agent task title", exitCode: undefined }, 12, "⠋");
  expect(line.length).toBe(12);
  expect(line.endsWith("...")).toBe(true);
});
