import { decodePasteBytes, StyledText, type KeyEvent, type MouseEvent, type PasteEvent, type TextChunk } from "@opentui/core";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
import { spinners } from "ora";
import { basename } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { discoverThreads, starterThreads } from "./history.ts";
import { checkProviderHealth, providers, providerShortName } from "./providers.ts";
import { AgentRuntime, type RuntimeSnapshot, type RuntimeStatus, type TerminalLine as TerminalLineModel } from "./pty.ts";
import { checkRuntimeHealth } from "./runtime-health.ts";
import type { AgentThread, ProviderHealth, ProviderId, RuntimeHealth } from "./types.ts";

export type FocusMode = "threads" | "terminal";
export type LoadStatus = "loading" | "ready" | "error";
type NoticeTone = "info" | "warning" | "error";
type NewSessionProvider = "codex" | "claude" | "pi";

interface Notice {
  tone: NoticeTone;
  message: string;
}

export interface ProviderStatusRow {
  provider: ProviderId;
  label: string;
  state: "checking" | "ready" | "missing";
  detail: string;
}

export interface RuntimeStatusRow {
  label: string;
  state: "checking" | "ready" | "missing";
  detail: string;
}

export interface HelpSection {
  title: string;
  rows: Array<{ key: string; detail: string }>;
}

export interface ActionPaletteAction {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
}

export type SidebarRow =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "thread"; key: string; thread: AgentThread; index: number };

const palette = {
  app: "#0e0e10",
  border: "#222226",
  borderHot: "#4a4a52",
  panel: "#0e0e10",
  panelSoft: "#0e0e10",
  sidebar: "#0e0e10",
  sidebarHeader: "#0e0e10",
  sidebarStripe: "#0e0e10",
  rowFocus: "#1d1d21",
  rowHover: "#161618",
  text: "#cfcfd2",
  textStrong: "#f4f4f6",
  muted: "#6f6f76",
  subtle: "#4a4a52",
  brand: "#e4e4e7",
  brandSoft: "#9a9aa2",
  codex: "#86a394",
  claude: "#bda177",
  pi: "#8497ad",
  danger: "#c98a8a",
  ok: "#8fa98f",
  warn: "#bcae7e",
};

const oraSpinner = spinners.dots;
const logo = ["  __ _ _ __ ___  _   ___  __", " / _` | '_ ` _ \\| | | \\ \\/ /", "| (_| | | | | | | |_| |>  < ", " \\__,_|_| |_| |_|\\__,_/_/\\_\\"];
const maxPaneStripSlots = 6;

function useOraSpinner(active: boolean): string {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setFrameIndex((index) => (index + 1) % oraSpinner.frames.length);
    }, oraSpinner.interval ?? 80);

    return () => clearInterval(timer);
  }, [active]);

  return active ? oraSpinner.frames[frameIndex] ?? oraSpinner.frames[0] ?? "" : "";
}

export function App({ onExit }: { onExit: () => void }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | undefined>();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadMessage, setLoadMessage] = useState("Indexing this project's root histories...");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("");
  const [focusMode, setFocusMode] = useState<FocusMode>("threads");
  const [showHelp, setShowHelp] = useState(false);
  const [showNewSessionPicker, setShowNewSessionPicker] = useState(false);
  const [showActionPalette, setShowActionPalette] = useState(false);
  const [actionPaletteQuery, setActionPaletteQuery] = useState("");
  const [actionPaletteSelection, setActionPaletteSelection] = useState(0);
  const [newSessionSelection, setNewSessionSelection] = useState(0);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [quitArmed, setQuitArmed] = useState(false);
  const [runtimes, setRuntimes] = useState<AgentRuntime[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | undefined>();
  const [snapshots, setSnapshots] = useState<RuntimeSnapshot[]>([]);
  const runtimesRef = useRef<AgentRuntime[]>([]);
  const projectPath = process.cwd();

  const filteredThreads = useMemo(() => filterThreads(threads, filter), [threads, filter]);
  const activeRuntime = runtimes.find((runtime) => runtime.id === activeRuntimeId) ?? runtimes.at(-1);
  const activeSnapshot = snapshots.find((snapshot) => snapshot.id === activeRuntime?.id);
  const sidebarWidth = Math.min(44, Math.max(28, Math.floor(dimensions.width * 0.34)));
  const terminalCols = Math.max(20, dimensions.width - sidebarWidth - 4);
  const terminalRows = Math.max(5, dimensions.height - 6);
  const sidebarListHeight = Math.max(3, dimensions.height - 6);
  const isLoading = loadStatus === "loading";
  const hasStartingRuntime = snapshots.some((snapshot) => snapshot.status === "starting");
  const spinnerFrame = useOraSpinner(isLoading || hasStartingRuntime);
  const actionPaletteActions = useMemo(
    () =>
      filterActionPaletteActions(
        buildActionPaletteActions({
          selectedThread: filteredThreads[selected],
          hasActiveRuntime: Boolean(activeRuntime),
          runtimeCount: runtimes.length,
          filterActive: filter.length > 0,
        }),
        actionPaletteQuery,
      ),
    [activeRuntime, actionPaletteQuery, filter.length, filteredThreads, runtimes.length, selected],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadStatus("loading");
    setLoadMessage("Indexing this project's root histories...");
    void Promise.all([discoverThreads(), checkProviderHealth(), checkRuntimeHealth()])
      .then(([nextThreads, nextHealth, nextRuntimeHealth]) => {
        if (cancelled) return;
        setThreads(nextThreads);
        setHealth(nextHealth);
        setRuntimeHealth(nextRuntimeHealth);
        setLoadStatus("ready");
        setLoadMessage("");
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadStatus("error");
        setLoadMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    runtimesRef.current = runtimes;
    setSnapshots(runtimes.map((runtime) => runtime.snapshot()));
  }, [runtimes]);

  useEffect(() => {
    for (const runtime of runtimes) {
      runtime.resize(terminalCols, terminalRows);
    }
  }, [runtimes, terminalCols, terminalRows]);

  useEffect(() => {
    setSelected((value) => clamp(value, 0, Math.max(0, filteredThreads.length - 1)));
  }, [filteredThreads.length]);

  useEffect(() => {
    setActionPaletteSelection((value) => clamp(value, 0, Math.max(0, actionPaletteActions.length - 1)));
  }, [actionPaletteActions.length]);

  useEffect(() => {
    if (!quitArmed) return;
    const timer = setTimeout(() => setQuitArmed(false), 2_500);
    return () => clearTimeout(timer);
  }, [quitArmed]);

  useEffect(() => {
    return () => {
      for (const runtime of runtimesRef.current) {
        runtime.kill();
      }
    };
  }, []);

  usePaste((event: PasteEvent) => {
    if (focusMode === "terminal" && activeRuntime) {
      event.preventDefault();
      activeRuntime.write(decodePasteBytes(event.bytes));
    }
  });

  useKeyboard((key: KeyEvent) => {
    if (key.eventType === "release") return;

    if (key.ctrl && key.name === "c" && focusMode !== "terminal") {
      requestExit();
      return;
    }

    if (key.ctrl && key.name === "g") {
      key.preventDefault();
      if (focusMode !== "terminal" && !activeRuntime) {
        setShowHelp(false);
        setShowNewSessionPicker(false);
        setShowActionPalette(false);
        setQuitArmed(false);
        setNotice({ tone: "info", message: terminalFocusBlockedNotice() });
        return;
      }

      setNotice(undefined);
      setShowNewSessionPicker(false);
      setShowActionPalette(false);
      setFocusMode((mode) => {
        const next = mode === "terminal" ? "threads" : "terminal";
        if (next === "terminal") {
          setShowHelp(false);
          setShowNewSessionPicker(false);
          setShowActionPalette(false);
        }
        return next;
      });
      return;
    }

    if (showActionPalette) {
      handleActionPaletteKey(key);
      return;
    }

    if (showNewSessionPicker) {
      handleNewSessionPickerKey(key);
      return;
    }

    if (showHelp) {
      handleThreadKey(key);
      return;
    }

    if (focusMode === "terminal" && activeRuntime) {
      key.preventDefault();
      key.stopPropagation();
      if (key.name === "escape" && key.shift) {
        setFocusMode("threads");
        return;
      }
      if (key.name === "pageup") {
        activeRuntime.scrollPage("up");
        return;
      }
      if (key.name === "pagedown") {
        activeRuntime.scrollPage("down");
        return;
      }
      if (key.shift && key.name === "up") {
        activeRuntime.scrollBy(1);
        return;
      }
      if (key.shift && key.name === "down") {
        activeRuntime.scrollBy(-1);
        return;
      }
      if (key.name === "home" && key.shift) {
        activeRuntime.scrollBy(Number.MAX_SAFE_INTEGER);
        return;
      }
      if (key.name === "end" && key.shift) {
        activeRuntime.scrollToBottom();
        return;
      }
      activeRuntime.write(key.raw || key.sequence || "");
      return;
    }

    handleThreadKey(key);
  });

  function handleThreadKey(key: KeyEvent): void {
    if (key.name === "escape") {
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (showActionPalette) {
        setShowActionPalette(false);
        setActionPaletteQuery("");
        return;
      }
      setFilter("");
      setNotice(undefined);
      setQuitArmed(false);
      return;
    }

    if (key.raw === "?" || key.name === "?") {
      key.preventDefault();
      setShowHelp((value) => !value);
      setNotice(undefined);
      setQuitArmed(false);
      setShowActionPalette(false);
      return;
    }

    if (showHelp) {
      const action = helpModeKeyAction(key);
      key.preventDefault();
      if (helpModeActionClosesOverlay(action)) setShowHelp(false);

      if (action === "quit") {
        requestExit();
        return;
      }

      if (action === "refresh") {
        setQuitArmed(false);
        void refresh();
        return;
      }

      if (action === "close-pane") {
        setQuitArmed(false);
        closeActiveRuntime();
        return;
      }

      if (action === "previous-pane" || action === "next-pane") {
        setQuitArmed(false);
        cycleRuntime(action === "next-pane" ? 1 : -1);
      }

      return;
    }

    if (shouldOpenNewSessionPicker(key, focusMode)) {
      key.preventDefault();
      setNotice(undefined);
      setQuitArmed(false);
      setShowHelp(false);
      setShowActionPalette(false);
      setShowNewSessionPicker(true);
      setNewSessionSelection(0);
      return;
    }

    if (shouldOpenActionPalette(key, focusMode)) {
      key.preventDefault();
      setNotice(undefined);
      setQuitArmed(false);
      setShowHelp(false);
      setShowNewSessionPicker(false);
      setShowActionPalette(true);
      setActionPaletteQuery("");
      setActionPaletteSelection(0);
      return;
    }

    if (shouldAppendPrintableToFilter(filter, key)) {
      setNotice(undefined);
      setQuitArmed(false);
      setFilter((value) => value + (key.raw ?? ""));
      setSelected(0);
      return;
    }

    if (key.name === "q") {
      requestExit();
      return;
    }

    if (showHelp) return;

    if (key.name === "r") {
      setQuitArmed(false);
      void refresh();
      return;
    }

    if (key.ctrl && key.name === "w") {
      key.preventDefault();
      setQuitArmed(false);
      closeActiveRuntime();
      return;
    }

    if (key.ctrl && (key.name === "left" || key.name === "right")) {
      key.preventDefault();
      setQuitArmed(false);
      cycleRuntime(key.name === "right" ? 1 : -1);
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      const thread = filteredThreads[selected];
      setQuitArmed(false);
      if (thread) launch(thread);
      return;
    }

    if (key.name === "up" || key.name === "k") {
      key.preventDefault();
      setNotice(undefined);
      setQuitArmed(false);
      setSelected((value) => Math.max(0, value - 1));
      return;
    }

    if (key.name === "down" || key.name === "j") {
      key.preventDefault();
      setNotice(undefined);
      setQuitArmed(false);
      setSelected((value) => clamp(value + 1, 0, Math.max(0, filteredThreads.length - 1)));
      return;
    }

    if (key.ctrl && key.name === "u") {
      setNotice(undefined);
      setQuitArmed(false);
      setSelected((value) => Math.max(0, value - 8));
      return;
    }

    if (key.ctrl && key.name === "d") {
      setNotice(undefined);
      setQuitArmed(false);
      setSelected((value) => clamp(value + 8, 0, Math.max(0, filteredThreads.length - 1)));
      return;
    }

    if (key.name === "backspace" || key.name === "delete") {
      setNotice(undefined);
      setQuitArmed(false);
      const next = filterBackspaceState(filter, selected);
      setFilter(next.filter);
      setSelected(next.selected);
      return;
    }

    if (key.name === "tab") {
      setNotice(undefined);
      setQuitArmed(false);
      cycleProvider();
      return;
    }

    if (key.raw && key.raw.length === 1 && !key.ctrl && !key.meta) {
      setNotice(undefined);
      setQuitArmed(false);
      setFilter((value) => value + key.raw);
      setSelected(0);
    }
  }

  function requestExit(): void {
    if (runtimes.length === 0 || quitArmed) {
      onExit();
      return;
    }

    if (shouldCloseOverlayForExitRequest(runtimes.length)) setShowHelp(false);
    setShowActionPalette(false);
    setQuitArmed(true);
    setFocusMode("threads");
    setNotice({ tone: "warning", message: exitGuardNotice(runtimes.length) });
  }

  async function refresh(): Promise<void> {
    const selectedBeforeRefresh = filteredThreads[selected];
    const filterBeforeRefresh = filter;
    setLoadStatus("loading");
    setLoadMessage("Refreshing root histories and provider health...");
    setShowHelp(false);
    setShowActionPalette(false);
    setNotice(undefined);
    setQuitArmed(false);
    try {
      const [nextThreads, nextHealth, nextRuntimeHealth] = await Promise.all([discoverThreads(), checkProviderHealth(), checkRuntimeHealth()]);
      setThreads(nextThreads);
      setHealth(nextHealth);
      setRuntimeHealth(nextRuntimeHealth);
      setSelected(nextSelectedIndexAfterRefresh(selectedBeforeRefresh, filterThreads(nextThreads, filterBeforeRefresh)));
      setLoadStatus("ready");
      setLoadMessage("");
    } catch (error) {
      setLoadStatus("error");
      setLoadMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function launch(thread: AgentThread): void {
    const reusableRuntimeId = findReusableRuntimeId(thread, runtimes);
    if (reusableRuntimeId) {
      setActiveRuntimeId(reusableRuntimeId);
      setFocusMode("terminal");
      setShowHelp(false);
      setShowActionPalette(false);
      setQuitArmed(false);
      setNotice({ tone: "info", message: reusablePaneNotice(thread.providerName) });
      return;
    }

    if (runtimeHealth && !runtimeHealth.node.installed) {
      setNotice({
        tone: "error",
        message: "Node.js is not on PATH. amux needs node to host live PTY panes.",
      });
      setQuitArmed(false);
      setFocusMode("threads");
      return;
    }

    const providerHealth = health.find((item) => item.provider === thread.provider);
    if (providerHealth && !providerHealth.installed) {
      setNotice({
        tone: "error",
        message: `${thread.providerName} is not on PATH. Install ${providerCommand(thread.provider)} or refresh after updating your shell environment.`,
      });
      setQuitArmed(false);
      setFocusMode("threads");
      return;
    }

    setNotice(undefined);
    setShowHelp(false);
    setShowActionPalette(false);
    setQuitArmed(false);
    const runtime = new AgentRuntime(thread, terminalCols, terminalRows);
    runtime.on("change", () => {
      setSnapshots((current) => {
        const next = current.filter((snapshot) => snapshot.id !== runtime.id);
        return [...next, runtime.snapshot()];
      });
      renderer.requestLive();
    });
    runtime.start();
    setRuntimes((current) => [...current, runtime]);
    setActiveRuntimeId(runtime.id);
    setFocusMode("terminal");
  }

  function launchNewSession(provider: ProviderId): void {
    const thread = starterThreads(projectPath).find((candidate) => candidate.provider === provider);
    if (!thread) {
      setNotice({ tone: "warning", message: `No starter row found for ${provider}.` });
      return;
    }

    const index = threads.findIndex((candidate) => candidate.id === thread.id);
    if (index >= 0) setSelected(index);
    launch(thread);
  }

  function handleNewSessionPickerKey(key: KeyEvent): void {
    key.preventDefault();

    if (key.name === "escape") {
      setShowNewSessionPicker(false);
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      const provider = newSessionPickerProviders()[newSessionSelection];
      if (provider) {
        setShowNewSessionPicker(false);
        launchNewSession(provider.id);
      }
      return;
    }

    if (key.name === "up" || key.name === "k" || key.name === "left" || key.name === "h") {
      setNewSessionSelection((value) => wrapIndex(value - 1, newSessionPickerProviders().length));
      return;
    }

    if (key.name === "down" || key.name === "j" || key.name === "right" || key.name === "l" || key.name === "tab") {
      setNewSessionSelection((value) => wrapIndex(value + 1, newSessionPickerProviders().length));
      return;
    }

    if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1) {
      const normalized = key.raw.toLowerCase();
      const index = newSessionPickerProviders().findIndex((provider) => provider.shortcut === normalized);
      if (index >= 0) {
        setNewSessionSelection(index);
      }
    }
  }

  function handleActionPaletteKey(key: KeyEvent): void {
    key.preventDefault();

    if (key.name === "escape") {
      setShowActionPalette(false);
      setActionPaletteQuery("");
      return;
    }

    if (key.name === "backspace" || key.name === "delete") {
      setActionPaletteQuery((value) => value.slice(0, -1));
      setActionPaletteSelection(0);
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      const action = actionPaletteActions[actionPaletteSelection];
      if (action) {
        setShowActionPalette(false);
        setActionPaletteQuery("");
        runActionPaletteAction(action.id);
      }
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setActionPaletteSelection((value) => wrapIndex(value - 1, actionPaletteActions.length));
      return;
    }

    if (key.name === "down" || key.name === "j" || key.name === "tab") {
      setActionPaletteSelection((value) => wrapIndex(value + 1, actionPaletteActions.length));
      return;
    }

    if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1) {
      setActionPaletteQuery((value) => value + key.raw);
      setActionPaletteSelection(0);
    }
  }

  function runActionPaletteAction(actionId: string): void {
    if (actionId.startsWith("new:")) {
      launchNewSession(actionId.slice("new:".length) as ProviderId);
      return;
    }

    if (actionId === "launch-selected") {
      const thread = filteredThreads[selected];
      if (thread) launch(thread);
      return;
    }

    if (actionId === "focus-terminal") {
      if (activeRuntime) {
        setFocusMode("terminal");
        setNotice(undefined);
      } else {
        setNotice({ tone: "info", message: terminalFocusBlockedNotice() });
      }
      return;
    }

    if (actionId === "previous-pane") {
      cycleRuntime(-1);
      return;
    }

    if (actionId === "next-pane") {
      cycleRuntime(1);
      return;
    }

    if (actionId === "close-pane") {
      closeActiveRuntime();
      return;
    }

    if (actionId === "refresh") {
      void refresh();
      return;
    }

    if (actionId === "clear-filter") {
      setFilter("");
      setSelected(0);
      setNotice(undefined);
      return;
    }

    if (actionId === "help") {
      setShowHelp(true);
      return;
    }

    if (actionId === "quit") {
      requestExit();
    }
  }

  function closeActiveRuntime(): void {
    const runtime = activeRuntime;
    if (!runtime) {
      setNotice({ tone: "info", message: "No active pane to close." });
      return;
    }

    const index = runtimes.findIndex((candidate) => candidate.id === runtime.id);
    const nextRuntimes = runtimes.filter((candidate) => candidate.id !== runtime.id);
    const nextActive = nextRuntimes[Math.min(Math.max(0, index), nextRuntimes.length - 1)] ?? nextRuntimes.at(-1);

    runtime.kill();
    setRuntimes(nextRuntimes);
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== runtime.id));
    setActiveRuntimeId(nextActive?.id);
    setFocusMode("threads");
    setQuitArmed(false);
    setNotice({ tone: "info", message: `Closed ${runtime.thread.providerName} pane.` });
  }

  function cycleRuntime(direction: -1 | 1): void {
    if (runtimes.length === 0) {
      setNotice({ tone: "info", message: "No running panes yet." });
      return;
    }

    const currentIndex = Math.max(0, runtimes.findIndex((runtime) => runtime.id === activeRuntime?.id));
    const nextIndex = wrapIndex(currentIndex + direction, runtimes.length);
    setActiveRuntimeId(runtimes[nextIndex]?.id);
    setFocusMode("terminal");
    setQuitArmed(false);
    setNotice(undefined);
  }

  function cycleProvider(): void {
    const index = nextProviderSelectionIndex(filteredThreads, selected);
    if (index !== selected) setSelected(index);
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={palette.app}>
      <Header projectPath={projectPath} focusMode={focusMode} loadStatus={loadStatus} width={dimensions.width} spinnerFrame={spinnerFrame} />
      <box flexGrow={1} flexDirection="row" backgroundColor={palette.app}>
        <Sidebar
          width={sidebarWidth}
          threads={filteredThreads}
          totalThreads={threads}
          selected={selected}
          filter={filter}
          health={health}
          loadStatus={loadStatus}
          isLoading={isLoading}
          loadMessage={loadMessage}
          spinnerFrame={spinnerFrame}
          listHeight={sidebarListHeight}
          onSelect={(index) => {
            setNotice(undefined);
            setSelected(index);
          }}
          onLaunch={(thread) => launch(thread)}
        />
        <Workspace
          active={activeSnapshot}
          runtimes={snapshots}
          threads={threads}
          health={health}
          runtimeHealth={runtimeHealth}
          notice={notice}
          projectPath={projectPath}
          loadStatus={loadStatus}
          loadMessage={loadMessage}
          spinnerFrame={spinnerFrame}
          width={terminalCols}
          height={terminalRows}
          focusMode={focusMode}
          showHelp={showHelp}
          showNewSessionPicker={showNewSessionPicker}
          showActionPalette={showActionPalette}
          newSessionProviders={newSessionPickerProviders()}
          newSessionSelection={newSessionSelection}
          actionPaletteActions={actionPaletteActions}
          actionPaletteQuery={actionPaletteQuery}
          actionPaletteSelection={actionPaletteSelection}
          onFocusTerminal={() => {
            if (!showHelp && !showNewSessionPicker && !showActionPalette && activeRuntime) setFocusMode("terminal");
          }}
          onTerminalScroll={(delta) => activeRuntime?.scrollBy(delta)}
          onActivate={(id) => {
            setActiveRuntimeId(id);
            setFocusMode("terminal");
          }}
        />
      </box>
      <Footer notice={notice} focusMode={focusMode} runtimeCount={runtimes.length} width={dimensions.width} filterActive={filter.length > 0} />
    </box>
  );
}

function Header({
  projectPath,
  focusMode,
  loadStatus,
  width,
  spinnerFrame,
}: {
  projectPath: string;
  focusMode: FocusMode;
  loadStatus: LoadStatus;
  width: number;
  spinnerFrame: string;
}) {
  const healthLabel = headerHealthLabel(loadStatus, spinnerFrame);
  const headerText = fit(`  ${projectDisplayName(projectPath)}   ${focusModeLabel(focusMode)}   ${healthLabel}`, Math.max(0, width - 7));
  return (
    <box height={1} paddingX={1} alignItems="center" backgroundColor={palette.app}>
      <text>
        <span fg={palette.textStrong}>amux</span>
        <span fg={palette.subtle}>{headerText}</span>
      </text>
    </box>
  );
}

export function headerHealthLabel(loadStatus: LoadStatus, spinnerFrame: string): string {
  if (loadStatus === "loading") return `${spinnerFrame} scanning`.trim();
  if (loadStatus === "error") return "attention";
  return "ready";
}

export function focusModeLabel(focusMode: FocusMode): string {
  return focusMode === "threads" ? "histories" : "terminal";
}

function Sidebar({
  width,
  threads,
  totalThreads,
  selected,
  filter,
  health,
  loadStatus,
  isLoading,
  loadMessage,
  spinnerFrame,
  listHeight,
  onSelect,
  onLaunch,
}: {
  width: number;
  threads: AgentThread[];
  totalThreads: AgentThread[];
  selected: number;
  filter: string;
  health: ProviderHealth[];
  loadStatus: LoadStatus;
  isLoading: boolean;
  loadMessage: string;
  spinnerFrame: string;
  listHeight: number;
  onSelect: (index: number) => void;
  onLaunch: (thread: AgentThread) => void;
}) {
  const [hovered, setHovered] = useState<string | undefined>();
  const rows = useMemo(() => buildSidebarRows(threads), [threads]);
  const selectedRow = rows.findIndex((row) => row.kind === "thread" && row.index === selected);
  const budget = Math.max(3, listHeight - 1);
  const { rows: visibleRows, hiddenAbove, hiddenBelow } = windowSidebarRows(rows, selectedRow, budget);

  const position = threads.length > 0 ? `${selected + 1}/${threads.length}` : "";
  const statusLine = joinStatusLine(threadCountLabel(threads, totalThreads, filter), position, width - 4);

  return (
    <box
      width={width}
      height="100%"
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={palette.border}
      backgroundColor={palette.sidebar}
      onMouseScroll={(event: MouseEvent) => {
        event.preventDefault();
        const direction = event.scroll?.direction === "up" ? -1 : 1;
        onSelect(clamp(selected + direction * 3, 0, Math.max(0, threads.length - 1)));
      }}
    >
      <box height={2} paddingX={1} flexDirection="column" backgroundColor={palette.sidebar}>
        <text>
          <span fg={filter ? palette.text : palette.subtle}>{filter ? fit(filter, width - 5) : fit("filter", width - 5)}</span>
          {filter ? <span fg={palette.muted}>{"▏"}</span> : null}
        </text>
        <text fg={isLoading ? palette.warn : palette.subtle}>
          {fit(isLoading ? `${spinnerFrame} ${loadMessage}` : statusLine, width - 4)}
        </text>
      </box>
      <box flexGrow={1} flexDirection="column" backgroundColor={palette.sidebar}>
        {isLoading ? (
          <SidebarLoadingRows width={width} spinnerFrame={spinnerFrame} />
        ) : visibleRows.length === 0 ? (
          <SidebarEmpty filter={filter} width={width} />
        ) : (
          <>
            <box flexGrow={1} flexDirection="column">
              {visibleRows.map((row) =>
                row.kind === "header" ? (
                  <GroupHeader key={row.key} label={row.label} count={row.count} width={width} />
                ) : (
                  <ThreadRow
                    key={row.key}
                    thread={row.thread}
                    width={width}
                    selected={row.index === selected}
                    hovered={hovered === row.thread.id}
                    installed={loadStatus === "loading" || health.find((item) => item.provider === row.thread.provider)?.installed !== false}
                    onActivate={() => {
                      onSelect(row.index);
                      onLaunch(row.thread);
                    }}
                    onHover={() => setHovered(row.thread.id)}
                    onHoverEnd={() => setHovered((value) => (value === row.thread.id ? undefined : value))}
                  />
                ),
              )}
            </box>
            <SidebarScrollHint hiddenAbove={hiddenAbove} hiddenBelow={hiddenBelow} width={width} />
          </>
        )}
      </box>
    </box>
  );
}

function GroupHeader({ label, count, width }: { label: string; count: number; width: number }) {
  const available = Math.max(4, width - 4);
  const countText = `  ${count}`;
  const labelText = fit(label.toUpperCase(), Math.max(0, available - countText.length));
  return (
    <box height={1} paddingX={1} backgroundColor={palette.sidebar}>
      <text>
        <span fg={palette.muted}>{labelText}</span>
        <span fg={palette.subtle}>{countText}</span>
      </text>
    </box>
  );
}

function ThreadRow({
  thread,
  width,
  selected,
  hovered,
  installed,
  onActivate,
  onHover,
  onHoverEnd,
}: {
  thread: AgentThread;
  width: number;
  selected: boolean;
  hovered: boolean;
  installed: boolean;
  onActivate: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const rowBg = selected ? palette.rowFocus : hovered ? palette.rowHover : palette.sidebar;
  const parts = sidebarThreadRowParts(thread, width, installed);

  return (
    <box
      height={1}
      flexDirection="row"
      backgroundColor={rowBg}
      onMouseDown={onActivate}
      onMouseOver={onHover}
      onMouseOut={onHoverEnd}
    >
      <box flexGrow={1} paddingX={1} flexDirection="row">
        <text>
          <span fg={selected ? palette.text : palette.subtle}>{selected ? "›" : " "}</span>
          <span fg={selected ? palette.textStrong : palette.text}>
            {selected ? <strong>{parts.title}</strong> : parts.title}
          </span>
          {parts.meta ? (
            <span fg={installed ? palette.subtle : palette.danger}>{`${SIDEBAR_META_SEPARATOR}${parts.meta}`}</span>
          ) : null}
        </text>
      </box>
    </box>
  );
}

function SidebarScrollHint({ hiddenAbove, hiddenBelow, width }: { hiddenAbove: number; hiddenBelow: number; width: number }) {
  const hint = sidebarScrollHintText(hiddenAbove, hiddenBelow);
  return (
    <box height={1} paddingX={1} backgroundColor={palette.sidebar}>
      <text fg={palette.subtle}>{truncate(hint, width - 4)}</text>
    </box>
  );
}

function SidebarLoadingRows({ width, spinnerFrame }: { width: number; spinnerFrame: string }) {
  const textWidth = Math.max(4, width - 4);
  return (
    <box flexGrow={1} flexDirection="column" backgroundColor={palette.sidebar}>
      <box height={1} paddingX={1} backgroundColor={palette.sidebar}>
        <text fg={palette.muted}>{fit(sidebarLoadingStatusText(spinnerFrame, providers.length), width - 4)}</text>
      </box>
      {providers.map((provider) => (
        <box key={provider.id} height={1} flexDirection="row" backgroundColor={palette.sidebar}>
          <box width={1} backgroundColor={palette.sidebar} />
          <box flexGrow={1} paddingX={1} flexDirection="row" justifyContent="space-between">
            <text fg={providerColor(provider.id)}>{fit(provider.name, textWidth)}</text>
            <text fg={palette.subtle}>{fit(spinnerFrame || "·", 2)}</text>
          </box>
        </box>
      ))}
    </box>
  );
}

export function sidebarLoadingStatusText(spinnerFrame: string, providerCount: number): string {
  const noun = providerCount === 1 ? "provider" : "providers";
  return `${spinnerFrame} scanning ${providerCount} ${noun}`.trim();
}

export function shouldOpenNewSessionPicker(
  key: { name?: string; shift?: boolean; ctrl?: boolean; meta?: boolean },
  focusMode: FocusMode,
): boolean {
  return Boolean(focusMode === "threads" && key.shift && !key.ctrl && !key.meta && key.name === "n");
}

export function shouldOpenActionPalette(
  key: { name?: string; shift?: boolean; ctrl?: boolean; meta?: boolean },
  focusMode: FocusMode,
): boolean {
  return Boolean(focusMode === "threads" && key.shift && !key.ctrl && !key.meta && key.name === "p");
}

export function sidebarThreadRowParts(
  thread: AgentThread,
  width: number,
  installed: boolean,
): { title: string; meta: string } {
  // Inner content width: sidebar width minus 2 borders, the 1-col accent bar, and 2 padding cols.
  const available = Math.max(8, width - 5);
  const isNew = thread.source === "new";
  const providerLabel = providerShortName(thread.provider);
  const tokens = [isNew ? `+ ${providerLabel}` : providerLabel, isNew ? "ready" : timeAgo(thread.updatedAt)];
  if (!installed) tokens.push("missing");
  const meta = tokens.join(" · ");

  if (available < 18) {
    return {
      title: fit(thread.title, available),
      meta: "",
    };
  }

  // title + SIDEBAR_META_SEPARATOR + meta fills `available` exactly so every cell is repainted.
  // Meta only takes the room it needs (capped) so the title gets the rest.
  const metaWidth = Math.min(meta.length, Math.max(0, available - 8 - SIDEBAR_META_SEPARATOR.length));
  const titleWidth = Math.max(4, available - metaWidth - SIDEBAR_META_SEPARATOR.length);

  return {
    title: fit(thread.title, titleWidth),
    meta: fit(meta, metaWidth),
  };
}

const SIDEBAR_META_SEPARATOR = " · ";

function SidebarEmpty({ filter, width }: { filter: string; width: number }) {
  const copy = sidebarEmptyCopy(filter);
  return (
    <box flexGrow={1} paddingX={1} flexDirection="column" justifyContent="center" backgroundColor={palette.sidebar}>
      <text fg={palette.text}>{fit(copy.title, width - 4)}</text>
      <text fg={palette.muted}>{fit(copy.detail, width - 4)}</text>
    </box>
  );
}

function Workspace({
  active,
  runtimes,
  threads,
  health,
  runtimeHealth,
  notice,
  projectPath,
  loadStatus,
  loadMessage,
  spinnerFrame,
  width,
  height,
  focusMode,
  showHelp,
  showNewSessionPicker,
  showActionPalette,
  newSessionProviders,
  newSessionSelection,
  actionPaletteActions,
  actionPaletteQuery,
  actionPaletteSelection,
  onFocusTerminal,
  onTerminalScroll,
  onActivate,
}: {
  active?: RuntimeSnapshot;
  runtimes: RuntimeSnapshot[];
  threads: AgentThread[];
  health: ProviderHealth[];
  runtimeHealth?: RuntimeHealth;
  notice?: Notice;
  projectPath: string;
  loadStatus: LoadStatus;
  loadMessage: string;
  spinnerFrame: string;
  width: number;
  height: number;
  focusMode: FocusMode;
  showHelp: boolean;
  showNewSessionPicker: boolean;
  showActionPalette: boolean;
  newSessionProviders: Array<{ id: NewSessionProvider; name: string; shortcut: string }>;
  newSessionSelection: number;
  actionPaletteActions: ActionPaletteAction[];
  actionPaletteQuery: string;
  actionPaletteSelection: number;
  onFocusTerminal: () => void;
  onTerminalScroll: (delta: number) => void;
  onActivate: (id: string) => void;
}) {
  return (
    <box flexGrow={1} height="100%" flexDirection="column" backgroundColor={palette.app}>
      <AgentStrip runtimes={runtimes} active={active} spinnerFrame={spinnerFrame} width={width} onActivate={onActivate} />
      <box
        flexGrow={1}
        border
        borderStyle="single"
        borderColor={showHelp || showActionPalette || focusMode === "terminal" ? palette.borderHot : palette.border}
        flexDirection="column"
        title={workspaceTitle(showHelp, showActionPalette, active?.title, width)}
        onMouseDown={onFocusTerminal}
        onMouseScroll={(event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          onFocusTerminal();
          onTerminalScroll(event.scroll?.direction === "up" ? 3 : -3);
        }}
      >
        {showHelp ? (
          <HelpPanel width={width} height={height} />
        ) : showActionPalette ? (
          <ActionPalette width={width} height={height} actions={actionPaletteActions} query={actionPaletteQuery} selected={actionPaletteSelection} />
        ) : showNewSessionPicker ? (
          <NewSessionPicker width={width} height={height} providers={newSessionProviders} selected={newSessionSelection} />
        ) : active ? (
          <ActiveTerminal active={active} width={width} spinnerFrame={spinnerFrame} />
        ) : (
          <Onboarding
            key={onboardingKey(loadStatus, threads, health)}
            threads={threads}
            health={health}
            runtimeHealth={runtimeHealth}
            notice={notice}
            projectPath={projectPath}
            loadStatus={loadStatus}
            loadMessage={loadMessage}
            spinnerFrame={spinnerFrame}
            width={width}
            height={height}
          />
        )}
      </box>
    </box>
  );
}

function ActiveTerminal({ active, width, spinnerFrame }: { active: RuntimeSnapshot; width: number; spinnerFrame: string }) {
  const header = terminalHeaderParts(active, width, spinnerFrame);
  return (
    <>
      <box height={1} paddingX={1} backgroundColor={palette.app}>
        <text>
          <span fg={palette.muted}>{header.command}</span>
          <span fg={runtimeStatusColor(active)}>{header.status}</span>
          {header.scrollback ? <span fg={palette.brandSoft}>{header.scrollback}</span> : null}
        </text>
      </box>
      <box flexGrow={1} flexDirection="column" paddingX={1}>
        {active.lines.map((line, index) => (
          <TerminalLine key={`${active.id}:${index}`} line={line} />
        ))}
      </box>
    </>
  );
}

export function workspaceTitle(showHelp: boolean, showActionPalette: boolean, activeTitle: string | undefined, width: number): string {
  if (showHelp) return " help ";
  if (showActionPalette) return " action palette ";
  if (!activeTitle) return " terminal ";
  return ` ${truncate(activeTitle, Math.max(4, width - 6))} `;
}

function AgentStrip({
  runtimes,
  active,
  spinnerFrame,
  width,
  onActivate,
}: {
  runtimes: RuntimeSnapshot[];
  active?: RuntimeSnapshot;
  spinnerFrame: string;
  width: number;
  onActivate: (id: string) => void;
}) {
  const activeIndex = active ? runtimes.findIndex((runtime) => runtime.id === active.id) : -1;
  const { indexes: visibleIndexes, hiddenCount } = visiblePaneSlotIndexes(runtimes.length, maxPaneStripSlots, activeIndex);
  const visibleRuntimes = visibleIndexes.map((index) => runtimes[index]).filter((runtime): runtime is RuntimeSnapshot => Boolean(runtime));
  const chipWidth = Math.max(8, Math.floor((width - 2) / Math.max(1, maxPaneStripSlots)) - 2);
  return (
    <box height={1} paddingX={1} flexDirection="row" gap={2} backgroundColor={palette.app}>
      {visibleRuntimes.length === 0 ? (
        <text fg={palette.subtle}>no live panes</text>
      ) : (
        <>
          {visibleRuntimes.map((runtime) => {
            const isActive = runtime.id === active?.id;
            const status = runtimeStatusText(runtime, spinnerFrame);
            return (
              <text key={runtime.id} onMouseDown={() => onActivate(runtime.id)}>
                <span fg={providerColor(runtime.thread.provider)}>{isActive ? "●" : "○"}</span>
                <span fg={isActive ? palette.textStrong : palette.muted}>{` ${fit(`${runtime.thread.providerName} ${status}`, chipWidth)}`}</span>
              </text>
            );
          })}
          {hiddenCount > 0 ? <text fg={palette.subtle}>{`+${hiddenCount}`}</text> : null}
        </>
      )}
    </box>
  );
}

function TerminalLine({ line }: { line: TerminalLineModel }) {
  return <text content={terminalLineStyledText(line)} />;
}

export function terminalLineStyledText(line: TerminalLineModel): StyledText {
  const runs = line.runs.length > 0 ? line.runs : [{ text: " ".repeat(line.cols) }];
  const chunks: TextChunk[] = runs.map((run) => ({
    __isChunk: true,
    text: run.text,
    fg: run.fg,
    bg: run.bg,
    attributes: run.attributes,
  }));
  return new StyledText(chunks);
}

function HelpPanel({ width, height }: { width: number; height: number }) {
  const sections = buildHelpSections();
  const compact = width < 90 || height < 18;
  const layout = helpPanelLayout(width);

  if (compact) {
    const rows = [
      { key: "Histories", detail: "arrows move, j/k when empty, type filter" },
      { key: "Panes", detail: "top strip is live PTY panes; Ctrl+Left/Right cycles" },
      { key: "Terminal", detail: "Ctrl+G focuses agent; PageUp/PageDown scrolls" },
        { key: "App", detail: "Shift+P actions, ? help, r refresh, q quit" },
    ].slice(0, Math.max(2, height - 5));

    return (
      <box flexGrow={1} paddingX={2} flexDirection="column" backgroundColor={palette.panel}>
        <text fg={palette.textStrong}>{fit("help", layout.contentWidth)}</text>
        <box height={1} />
        {rows.map((row) => (
          <text key={row.key}>
            <span fg={palette.text}>{fit(row.key, layout.compactKeyWidth)}</span>
            <span fg={palette.muted}>{fit(row.detail, layout.compactDetailWidth)}</span>
          </text>
        ))}
        <box height={1} />
        <text fg={palette.subtle}>{fit("Esc or ? closes  ·  Ctrl+G focuses the agent", layout.contentWidth)}</text>
      </box>
    );
  }

  return (
    <box flexGrow={1} paddingX={2} justifyContent="center" flexDirection="column" backgroundColor={palette.panel}>
      <text fg={palette.textStrong}>{fit("help", layout.contentWidth)}</text>
      <box height={1} />
      <box flexDirection="row" gap={2}>
        {sections.map((section) => (
          <box key={section.title} width={layout.cardWidth} flexDirection="column" backgroundColor={palette.panel}>
            <text fg={palette.muted}>{fit(section.title.toLowerCase(), layout.cardTextWidth)}</text>
            {section.rows.map((row) => (
              <text key={`${section.title}:${row.key}`}>
                <span fg={palette.text}>{fit(row.key, layout.cardKeyWidth)}</span>
                <span fg={palette.subtle}>{fit(row.detail, layout.cardDetailWidth)}</span>
              </text>
            ))}
          </box>
        ))}
      </box>
      <box height={1} />
      <text fg={palette.subtle}>{fit("Esc or ? closes  ·  Ctrl+G returns focus to the agent terminal", layout.contentWidth)}</text>
    </box>
  );
}

export function newSessionPickerProviders(): Array<{ id: NewSessionProvider; name: string; shortcut: string }> {
  return [
    { id: "codex", name: "Codex", shortcut: "1" },
    { id: "claude", name: "Claude Code", shortcut: "2" },
    { id: "pi", name: "Pi", shortcut: "3" },
  ];
}

export function buildActionPaletteActions({
  selectedThread,
  hasActiveRuntime,
  runtimeCount,
  filterActive,
}: {
  selectedThread?: AgentThread;
  hasActiveRuntime: boolean;
  runtimeCount: number;
  filterActive: boolean;
}): ActionPaletteAction[] {
  const actions: ActionPaletteAction[] = newSessionPickerProviders().map((provider) => ({
    id: `new:${provider.id}`,
    label: `New ${provider.name} session`,
    detail: "Start a fresh provider session in this project",
    shortcut: provider.shortcut,
  }));

  if (selectedThread) {
    actions.push({
      id: "launch-selected",
      label: selectedThread.source === "new" ? `Start ${selectedThread.providerName}` : `Resume ${selectedThread.providerName} history`,
      detail: selectedThread.title,
      shortcut: "Enter",
    });
  }

  if (hasActiveRuntime) {
    actions.push(
      { id: "focus-terminal", label: "Focus active agent terminal", detail: "Send keystrokes to the selected live pane", shortcut: "Ctrl+G" },
      { id: "previous-pane", label: "Previous live pane", detail: "Cycle to the previous running agent pane", shortcut: "Ctrl+Left" },
      { id: "next-pane", label: "Next live pane", detail: "Cycle to the next running agent pane", shortcut: "Ctrl+Right" },
      { id: "close-pane", label: "Close active live pane", detail: "Stop tracking the selected pane in amux", shortcut: "Ctrl+W" },
    );
  }

  actions.push(
    { id: "refresh", label: "Refresh histories and health", detail: "Rescan this project and provider CLIs", shortcut: "r" },
    { id: "help", label: "Show help", detail: "Open the built-in keyboard and layout guide", shortcut: "?" },
  );

  if (filterActive) {
    actions.push({ id: "clear-filter", label: "Clear history filter", detail: "Show every current-project root history again", shortcut: "Esc" });
  }

  actions.push({
    id: "quit",
    label: runtimeCount > 0 ? "Quit amux with running panes" : "Quit amux",
    detail: runtimeCount > 0 ? "Ask for confirmation before closing live panes" : "Exit the workspace",
    shortcut: "q",
  });

  return actions;
}

export function filterActionPaletteActions(actions: ActionPaletteAction[], query: string): ActionPaletteAction[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return actions;

  return actions.filter((action) => {
    const haystack = [action.label, action.detail, action.shortcut ?? ""].join(" ").toLowerCase();
    return tokens.every((token) => fuzzyIncludes(haystack, token));
  });
}

function ActionPalette({
  width,
  height,
  actions,
  query,
  selected,
}: {
  width: number;
  height: number;
  actions: ActionPaletteAction[];
  query: string;
  selected: number;
}) {
  const contentWidth = Math.max(34, Math.min(72, width - 6));
  const bodyHeight = Math.max(10, Math.min(18, height - 4));
  const rowLimit = Math.max(1, bodyHeight - 6);
  const selectedIndex = clamp(selected, 0, Math.max(0, actions.length - 1));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(rowLimit / 2), Math.max(0, actions.length - rowLimit)));
  const visible = actions.slice(start, start + rowLimit);
  const queryText = query ? `> ${query}` : "> action or provider";

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={palette.panel}>
      <box width={contentWidth} height={bodyHeight} border borderStyle="single" borderColor={palette.borderHot} paddingX={1} flexDirection="column" backgroundColor={palette.panelSoft}>
        <text fg={palette.textStrong}>
          <strong>Action palette</strong>
        </text>
        <text fg={query ? palette.text : palette.subtle}>{fit(queryText, contentWidth - 4)}</text>
        <box height={1} />
        {visible.length === 0 ? (
          <text fg={palette.muted}>{fit("No matching actions", contentWidth - 4)}</text>
        ) : (
          visible.map((action, offset) => {
            const index = start + offset;
            const active = index === selectedIndex;
            const labelWidth = Math.max(8, contentWidth - 18);
            return (
              <box key={action.id} height={1} flexDirection="row" backgroundColor={active ? palette.rowFocus : palette.panelSoft} paddingX={1}>
                <text fg={active ? palette.textStrong : palette.text}>{active ? ">" : " "}</text>
                <text fg={active ? palette.textStrong : palette.text}>{fit(action.label, labelWidth)}</text>
                <text fg={palette.subtle}>{fit(action.shortcut ?? "", 10)}</text>
              </box>
            );
          })
        )}
        <box height={1} />
        <text fg={palette.subtle}>{fit("Type to filter · Enter runs · Esc closes", contentWidth - 4)}</text>
      </box>
    </box>
  );
}

function NewSessionPicker({
  width,
  height,
  providers,
  selected,
}: {
  width: number;
  height: number;
  providers: Array<{ id: NewSessionProvider; name: string; shortcut: string }>;
  selected: number;
}) {
  const contentWidth = Math.max(28, Math.min(42, width - 6));
  const bodyHeight = Math.max(9, Math.min(12, height - 4));
  const selectedProvider = providers[selected];

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={palette.panel}>
      <box width={contentWidth} height={bodyHeight} border borderStyle="single" borderColor={palette.borderHot} paddingX={1} flexDirection="column" backgroundColor={palette.panelSoft}>
        <text fg={palette.textStrong}>
          <strong>New session</strong>
        </text>
        <text fg={palette.muted}>{fit("Choose a provider to start a fresh session.", contentWidth - 4)}</text>
        <box height={1} />
        {providers.map((provider, index) => {
          const active = index === selected;
          return (
            <box
              key={provider.id}
              height={1}
              flexDirection="row"
              backgroundColor={active ? palette.rowFocus : palette.panelSoft}
              paddingX={1}
            >
              <text fg={active ? palette.textStrong : palette.text}>{active ? ">" : " "}</text>
              <text fg={providerColor(provider.id)}>{fit(provider.name, Math.max(4, contentWidth - 14))}</text>
              <text fg={palette.subtle}>{fit(`[${provider.shortcut}]`, 6)}</text>
            </box>
          );
        })}
        <box height={1} />
        <text fg={palette.subtle}>{fit(`Enter launches ${selectedProvider?.name ?? "the selected provider"} · Esc closes`, contentWidth - 4)}</text>
      </box>
    </box>
  );
}

export function helpPanelLayout(width: number): {
  contentWidth: number;
  compactKeyWidth: number;
  compactDetailWidth: number;
  cardWidth: number;
  cardTextWidth: number;
  cardKeyWidth: number;
  cardDetailWidth: number;
} {
  const contentWidth = Math.max(12, width - 6);
  const compactKeyWidth = Math.min(18, Math.max(8, Math.floor(contentWidth * 0.4)));
  const compactDetailWidth = Math.max(4, contentWidth - compactKeyWidth);
  const cardWidth = Math.max(16, Math.floor((contentWidth - 3) / 4));
  const cardTextWidth = Math.max(4, cardWidth - 4);
  const cardKeyWidth = Math.min(12, Math.max(6, Math.floor(cardTextWidth * 0.38)));
  const cardDetailWidth = Math.max(4, cardTextWidth - cardKeyWidth);

  return {
    contentWidth,
    compactKeyWidth,
    compactDetailWidth,
    cardWidth,
    cardTextWidth,
    cardKeyWidth,
    cardDetailWidth,
  };
}

function Onboarding({
  threads,
  health,
  runtimeHealth,
  notice,
  projectPath,
  loadStatus,
  loadMessage,
  spinnerFrame,
  width,
  height,
}: {
  threads: AgentThread[];
  health: ProviderHealth[];
  runtimeHealth?: RuntimeHealth;
  notice?: Notice;
  projectPath: string;
  loadStatus: LoadStatus;
  loadMessage: string;
  spinnerFrame: string;
  width: number;
  height: number;
}) {
  const historyCount = threads.filter((thread) => thread.source === "history").length;
  const installedCount = health.filter((item) => item.installed).length;
  const providerRows = buildProviderStatusRows(health, loadStatus);
  const runtimeRow = buildRuntimeStatusRow(runtimeHealth, loadStatus);
  const statusColorValue = loadStatus === "error" ? palette.danger : loadStatus === "loading" ? palette.warn : palette.ok;
  const statusText = onboardingStatusText(loadStatus, loadMessage, spinnerFrame, historyCount, installedCount, providers.length);
  const nextAction = onboardingNextAction(loadStatus, historyCount, installedCount);
  const projectPathLabel = shortPath(projectPath);
  const contentWidth = Math.max(12, width - 6);
  const statusLine = [...providerRows.map((row) => `${row.label} ${row.state}`), `node ${runtimeRow.state}`].join("   ·   ");

  return (
    <box flexGrow={1} paddingX={2} justifyContent="center" flexDirection="column" backgroundColor={palette.panel}>
      <text fg={palette.textStrong}>
        <strong>amux</strong>
      </text>
      <text fg={palette.subtle}>{fit(projectPathLabel, contentWidth)}</text>
      <box height={1} />
      {notice ? <NoticeLine notice={notice} width={contentWidth} /> : null}
      <text fg={statusColorValue}>{fit(statusText, contentWidth)}</text>
      <text fg={palette.muted}>{fit(nextAction, contentWidth)}</text>
      <box height={1} />
      <text fg={palette.subtle}>{fit(statusLine, contentWidth)}</text>
      <box height={1} />
      <text fg={palette.muted}>{fit("Pick a history at left  ·  Shift+N new session  ·  ? help", contentWidth)}</text>
    </box>
  );
}

export function onboardingCardWidths(width: number): { feature: number; status: number; main: number } {
  const contentWidth = Math.max(12, width - 6);
  return {
    feature: Math.max(18, Math.floor((contentWidth - 2) / 3)),
    status: Math.max(14, Math.floor((contentWidth - 3) / 4)),
    main: Math.max(12, width - 46),
  };
}

function MetricRow({ width, label, value, detail }: { width: number; label: string; value: string; detail: string }) {
  const row = metricRowParts(width, label, value, detail);
  return (
    <text fg={palette.muted}>
      <span fg={palette.brandSoft}>{row.value}</span>
      <span fg={palette.subtle}>{row.label}</span>
      {row.detail}
    </text>
  );
}

export function metricRowParts(width: number, label: string, value: string, detail: string): { value: string; label: string; detail: string } {
  const valueText = value.padStart(3, " ");
  const labelText = `  ${label.padEnd(10, " ")}`;
  const detailWidth = Math.max(0, width - valueText.length - labelText.length);
  return {
    value: valueText,
    label: labelText,
    detail: fit(detail, detailWidth),
  };
}

function OnboardingCard({ width, title, body }: { width: number; title: string; body: string }) {
  const textWidth = Math.max(4, width - 4);
  return (
    <box width={width} height={5} border borderStyle="single" borderColor={palette.border} paddingX={1} flexDirection="column" backgroundColor={palette.panelSoft}>
      <text fg={palette.text}>{fit(title, textWidth)}</text>
      <text fg={palette.muted}>{fit(body, textWidth)}</text>
    </box>
  );
}

function ProviderStatusCard({ row, width }: { row: ProviderStatusRow; width: number }) {
  const color = row.state === "ready" ? palette.ok : row.state === "missing" ? palette.danger : palette.warn;
  const marker = row.state === "ready" ? "●" : row.state === "missing" ? "!" : "○";
  const textWidth = Math.max(4, width - 4);
  return (
    <box width={width} height={4} border borderStyle="single" borderColor={palette.border} paddingX={1} flexDirection="column" backgroundColor={palette.panelSoft}>
      <text>
        <span fg={color}>{marker} </span>
        <span fg={providerColor(row.provider)}>{fit(row.label, Math.max(1, textWidth - 2))}</span>
      </text>
      <text fg={palette.muted}>{fit(row.detail, textWidth)}</text>
    </box>
  );
}

function RuntimeStatusCard({ row, width }: { row: RuntimeStatusRow; width: number }) {
  const color = row.state === "ready" ? palette.ok : row.state === "missing" ? palette.danger : palette.warn;
  const marker = row.state === "ready" ? "●" : row.state === "missing" ? "!" : "○";
  const textWidth = Math.max(4, width - 4);
  return (
    <box width={width} height={4} border borderStyle="single" borderColor={palette.border} paddingX={1} flexDirection="column" backgroundColor={palette.panelSoft}>
      <text>
        <span fg={color}>{marker} </span>
        <span fg={palette.brandSoft}>{fit(row.label, Math.max(1, textWidth - 2))}</span>
      </text>
      <text fg={palette.muted}>{fit(row.detail, textWidth)}</text>
    </box>
  );
}

function onboardingKey(loadStatus: LoadStatus, threads: AgentThread[], health: ProviderHealth[]): string {
  return [
    loadStatus,
    threads.length,
    health.map((item) => `${item.provider}:${item.installed ? "1" : "0"}:${item.version ?? item.error ?? ""}`).join("|"),
  ].join(":");
}

function NoticeLine({ notice, width }: { notice: Notice; width: number }) {
  return <text fg={noticeColor(notice.tone)}>{truncate(formatNotice(notice), width)}</text>;
}

function Footer({
  notice,
  focusMode,
  runtimeCount,
  width,
  filterActive,
}: {
  notice?: Notice;
  focusMode: FocusMode;
  runtimeCount: number;
  width: number;
  filterActive: boolean;
}) {
  const help = footerHelpText({ notice, focusMode, runtimeCount, width, filterActive });
  return (
    <box height={1} paddingX={1} backgroundColor={palette.app}>
      <text fg={notice ? noticeColor(notice.tone) : palette.subtle}>{truncate(help, width - 2)}</text>
    </box>
  );
}

export function footerHelpText({
  notice,
  focusMode,
  runtimeCount,
  width,
  filterActive,
}: {
  notice?: { tone: NoticeTone; message: string };
  focusMode: FocusMode;
  runtimeCount: number;
  width: number;
  filterActive: boolean;
}): string {
  if (notice) return formatNotice(notice);

  const compact = width < 96;
  const navHelp = filterActive
    ? compact
      ? "filtering | type extends | ? help | Esc clear | Enter launch"
      : "filtering | typing extends query | arrows move | ? help | Esc clear | Enter launch | Tab visible provider"
    : compact
      ? "arrows move | j/k if empty | Enter launch | ? help | Ctrl+Left/Right panes | q quit"
      : "arrows move | j/k if filter empty | type filters | Enter launch | Tab visible provider | ? help | Ctrl+Left/Right panes | Ctrl+W close | q quit";
  const terminalHelp = compact
    ? "agent focused | wheel/PageUp scroll | Ctrl+G nav | Ctrl+C to agent"
    : "agent focused | wheel/PageUp scrollback | Ctrl+G nav | Ctrl+C to agent | Shift+Esc nav";

  return `${focusMode === "terminal" ? terminalHelp : navHelp} | panes ${runtimeCount}`;
}

export function buildHelpSections(): HelpSection[] {
  return [
    {
      title: "Histories",
      rows: [
        { key: "arrows", detail: "move through current-project root histories" },
        { key: "j/k", detail: "move only while the filter is empty" },
        { key: "type", detail: "filter provider, title, path, preview, or tag" },
        { key: "Enter", detail: "launch or resume the selected item" },
        { key: "Tab", detail: "jump to the next visible provider group" },
      ],
    },
    {
      title: "Panes",
      rows: [
        { key: "top strip", detail: "live PTY panes for launched agents" },
        { key: "Ctrl+Left/Right", detail: "cycle running panes from navigation mode" },
        { key: "Ctrl+W", detail: "close the active pane" },
        { key: "Mouse", detail: "click a pane to focus it" },
      ],
    },
    {
      title: "Terminal",
      rows: [
        { key: "Ctrl+G", detail: "toggle between navigation and agent focus" },
        { key: "Ctrl+C", detail: "sent to the agent while terminal is focused" },
        { key: "PageUp/PageDown", detail: "scroll active agent output" },
        { key: "Shift+Esc", detail: "leave terminal focus" },
      ],
    },
    {
      title: "App",
      rows: [
        { key: "Shift+N", detail: "open the new session picker for Codex, Claude Code, or Pi" },
        { key: "Shift+P", detail: "open the action palette for provider and pane commands" },
        { key: "r", detail: "refresh root histories and provider health" },
        { key: "?", detail: "toggle this help" },
        { key: "q", detail: "quit from navigation mode" },
        { key: "Esc", detail: "clear filter, notice, or help" },
      ],
    },
  ];
}

export function threadCountLabel(shownThreads: AgentThread[], totalThreads: number | AgentThread[], filter: string): string {
  const shown = countThreadSources(shownThreads);
  const total = Array.isArray(totalThreads) ? countThreadSources(totalThreads) : countThreadSourcesFromTotal(totalThreads);

  if (filter) {
    const matches = plural(shown.total, "match", "matches");
    const rootProgress = `${shown.histories}/${total.histories} ${pluralWord(total.histories, "root", "roots")}`;
    return `${matches} · ${rootProgress}`;
  }

  const roots = plural(total.histories, "root", "roots");
  if (total.starters === 0) return roots;
  return `${roots} · ${plural(total.starters, "starter", "starters")}`;
}

export function joinStatusLine(primary: string, secondary: string, width: number): string {
  if (!secondary) return primary;
  const full = `${primary}  ·  ${secondary}`;
  return full.length <= width ? full : primary;
}

function countThreadSources(threads: AgentThread[]): { histories: number; starters: number; total: number } {
  const histories = threads.filter((thread) => thread.source === "history").length;
  const starters = threads.filter((thread) => thread.source === "new").length;
  return { histories, starters, total: threads.length };
}

function countThreadSourcesFromTotal(total: number): { histories: number; starters: number; total: number } {
  const starters = Math.min(providers.length, total);
  return { histories: Math.max(0, total - starters), starters, total };
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function pluralWord(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}


export function buildSidebarRows(threads: AgentThread[]): SidebarRow[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const label = sectionLabel(thread);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const rows: SidebarRow[] = [];
  let current: string | undefined;
  threads.forEach((thread, index) => {
    const label = sectionLabel(thread);
    if (label !== current) {
      rows.push({ kind: "header", key: `section:${label}`, label, count: counts.get(label) ?? 0 });
      current = label;
    }
    rows.push({ kind: "thread", key: thread.id, thread, index });
  });
  return rows;
}

export function windowSidebarRows(
  rows: SidebarRow[],
  selectedRow: number,
  budget: number,
): { rows: SidebarRow[]; hiddenAbove: number; hiddenBelow: number } {
  if (rows.length === 0) return { rows: [], hiddenAbove: 0, hiddenBelow: 0 };

  const heightOf = (row: SidebarRow) => 1;
  const anchor = clamp(selectedRow < 0 ? 0 : selectedRow, 0, rows.length - 1);
  let start = anchor;
  let end = anchor;
  let used = heightOf(rows[anchor]!);

  // Grow the window outward from the selected row until the height budget is spent,
  // preferring to reveal rows below first so launched context stays in view.
  while (used < budget) {
    const next = rows[end + 1];
    const prev = rows[start - 1];
    let progressed = false;
    if (next && used + heightOf(next) <= budget) {
      used += heightOf(next);
      end += 1;
      progressed = true;
    }
    if (prev && used + heightOf(prev) <= budget) {
      used += heightOf(prev);
      start -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  const countThreads = (slice: SidebarRow[]) => slice.filter((row) => row.kind === "thread").length;
  return {
    rows: rows.slice(start, end + 1),
    hiddenAbove: countThreads(rows.slice(0, start)),
    hiddenBelow: countThreads(rows.slice(end + 1)),
  };
}

function sectionLabel(thread: AgentThread): string {
  if (thread.source === "new") return "Start a session";
  return recencyLabel(thread.updatedAt);
}

function recencyLabel(date?: Date): string {
  if (!date) return "Older";
  const day = 86_400_000;
  const elapsed = Date.now() - date.getTime();
  if (elapsed < day) return "Today";
  if (elapsed < 2 * day) return "Yesterday";
  if (elapsed < 7 * day) return "Past week";
  if (elapsed < 30 * day) return "Past month";
  return "Older";
}

function filterThreads(threads: AgentThread[], filter: string): AgentThread[] {
  const query = filter.trim().toLowerCase();
  if (!query) return threads;

  return threads.filter((thread) => threadMatchesFilter(thread, query));
}

export function threadMatchesFilter(thread: AgentThread, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = [thread.title, thread.providerName, thread.cwd, thread.preview, ...thread.tags].join(" ").toLowerCase();
  return tokens.every((token) => fuzzyIncludes(haystack, token));
}

export function filterBackspaceState(filter: string, selected: number): { filter: string; selected: number } {
  if (filter.length === 0) return { filter, selected };
  return { filter: filter.slice(0, -1), selected: 0 };
}

export function shouldAppendPrintableToFilter(
  filter: string,
  key: { name?: string; raw?: string; ctrl?: boolean; meta?: boolean },
): boolean {
  if (filter.length === 0) return false;
  if (key.ctrl || key.meta) return false;
  if (key.name === "backspace" || key.name === "delete" || key.name === "escape" || key.name === "enter" || key.name === "return" || key.name === "tab") {
    return false;
  }
  return key.raw?.length === 1;
}

export type HelpModeKeyAction = "quit" | "refresh" | "close-pane" | "previous-pane" | "next-pane" | "ignore";

export function helpModeKeyAction(key: { name?: string; ctrl?: boolean; meta?: boolean }): HelpModeKeyAction {
  if (key.ctrl && key.name === "w") return "close-pane";
  if (key.ctrl && key.name === "left") return "previous-pane";
  if (key.ctrl && key.name === "right") return "next-pane";
  if (!key.ctrl && !key.meta && key.name === "q") return "quit";
  if (!key.ctrl && !key.meta && key.name === "r") return "refresh";
  return "ignore";
}

export function helpModeActionClosesOverlay(action: HelpModeKeyAction): boolean {
  return action !== "ignore";
}

export function shouldCloseOverlayForExitRequest(runtimeCount: number): boolean {
  return runtimeCount > 0;
}

export function nextSelectedIndexAfterRefresh(previouslySelected: AgentThread | undefined, nextThreads: AgentThread[]): number {
  if (!previouslySelected) return 0;

  const nextIndex = nextThreads.findIndex((thread) => thread.id === previouslySelected.id);
  return nextIndex >= 0 ? nextIndex : 0;
}

export function nextProviderSelectionIndex(threads: AgentThread[], selected: number): number {
  if (threads.length === 0) return selected;

  const currentIndex = clamp(selected, 0, threads.length - 1);
  const currentProvider = threads[currentIndex]?.provider;
  const ids = providers.map((provider) => provider.id);
  const currentProviderIndex = Math.max(0, ids.indexOf(currentProvider ?? providers[0]?.id ?? "codex"));

  for (let offset = 1; offset <= ids.length; offset += 1) {
    const nextProvider = ids[(currentProviderIndex + offset) % ids.length];
    const nextIndex = threads.findIndex((thread) => thread.provider === nextProvider);
    if (nextIndex >= 0) return nextIndex;
  }

  return currentIndex;
}

export function fuzzyIncludes(value: string, query: string): boolean {
  if (query === "") return true;
  if (value.includes(query)) return true;

  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) return true;
    }
  }

  return false;
}

function providerColor(provider: ProviderId): string {
  if (provider === "codex") return palette.codex;
  if (provider === "claude") return palette.claude;
  return palette.pi;
}

export function projectDisplayName(path: string): string {
  const label = basename(path) || path;
  return label === "." ? path : label;
}

export function runtimeStatusLabel(snapshot: Pick<RuntimeSnapshot, "status" | "exitCode">): string {
  if (snapshot.status === "exited") {
    return snapshot.exitCode === 0 ? "done" : `exit ${snapshot.exitCode ?? "?"}`;
  }
  return snapshot.status;
}

export function runtimeStatusText(snapshot: Pick<RuntimeSnapshot, "status" | "exitCode">, spinnerFrame = ""): string {
  const label = runtimeStatusLabel(snapshot);
  if (snapshot.status !== "starting") return label;
  return `${spinnerFrame} ${label}`.trim();
}

function runtimeStatusColor(snapshot: Pick<RuntimeSnapshot, "status" | "exitCode">): string {
  if (snapshot.status === "running") return palette.ok;
  if (snapshot.status === "exited" && snapshot.exitCode === 0) return palette.ok;
  if (snapshot.status === "failed" || snapshot.status === "exited") return palette.danger;
  return palette.muted;
}

export function activeCommandLine(snapshot: Pick<RuntimeSnapshot, "commandLabel" | "status" | "exitCode">, width: number, spinnerFrame = ""): string {
  return terminalHeaderParts({ ...snapshot, scrollOffset: 0 }, width, spinnerFrame).command;
}

export function terminalHeaderParts(
  snapshot: Pick<RuntimeSnapshot, "commandLabel" | "status" | "exitCode" | "scrollOffset">,
  width: number,
  spinnerFrame = "",
): { command: string; status: string; scrollback: string } {
  const rowWidth = Math.max(0, width - 4);
  const status = truncate(` [${runtimeStatusText(snapshot, spinnerFrame)}]`, rowWidth);
  const remainingAfterStatus = Math.max(0, rowWidth - status.length);
  const scrollback = snapshot.scrollOffset > 0 ? truncate(` scrollback -${snapshot.scrollOffset}`, remainingAfterStatus) : "";
  const command = truncate(snapshot.commandLabel, Math.max(0, rowWidth - status.length - scrollback.length));
  return { command, status, scrollback };
}

function noticeColor(tone: NoticeTone): string {
  if (tone === "error") return palette.danger;
  if (tone === "warning") return palette.warn;
  return palette.brand;
}

export function formatNotice(notice: { tone: NoticeTone; message: string }): string {
  const label = notice.tone === "error" ? "error" : notice.tone === "warning" ? "warn" : "info";
  return `${label}: ${notice.message}`;
}

function providerCommand(provider: ProviderId): string {
  return providers.find((candidate) => candidate.id === provider)?.command ?? provider;
}

export function buildProviderStatusRows(health: ProviderHealth[], loadStatus: LoadStatus): ProviderStatusRow[] {
  return providers.map((provider) => {
    const item = health.find((candidate) => candidate.provider === provider.id);
    if (loadStatus === "loading" && !item) {
      return {
        provider: provider.id,
        label: provider.name,
        state: "checking",
        detail: `checking ${provider.command}`,
      };
    }

    if (item?.installed) {
      return {
        provider: provider.id,
        label: provider.name,
        state: "ready",
        detail: item.version ?? shortPath(item.path ?? provider.command),
      };
    }

    return {
      provider: provider.id,
      label: provider.name,
      state: "missing",
      detail: `install ${provider.command}`,
    };
  });
}

export function buildRuntimeStatusRow(runtimeHealth: RuntimeHealth | undefined, loadStatus: LoadStatus): RuntimeStatusRow {
  if (loadStatus === "loading" && !runtimeHealth) {
    return {
      label: "Node.js",
      state: "checking",
      detail: "checking node",
    };
  }

  if (runtimeHealth?.node.installed) {
    return {
      label: "Node.js",
      state: "ready",
      detail: runtimeHealth.node.version ?? shortPath(runtimeHealth.node.path ?? "node"),
    };
  }

  return {
    label: "Node.js",
    state: "missing",
    detail: "install node",
  };
}

export function onboardingStatusText(
  loadStatus: LoadStatus,
  loadMessage: string,
  spinnerFrame: string,
  historyCount: number,
  installedCount: number,
  totalProviders: number,
): string {
  if (loadStatus === "loading") return `${spinnerFrame} ${loadMessage}`.trim();
  if (loadStatus === "error") return loadMessage || "Could not index root histories.";
  if (installedCount === 0) return "Provider CLIs are missing.";
  if (historyCount === 0) return "Fresh project. Ready for a first agent session.";
  return `Ready with ${historyCount} root ${historyCount === 1 ? "history" : "histories"} and ${installedCount}/${totalProviders} provider${totalProviders === 1 ? "" : "s"}.`;
}

export function onboardingNextAction(loadStatus: LoadStatus, historyCount: number, installedCount: number): string {
  if (loadStatus === "loading") return "Scanning provider stores and checking PATH.";
  if (loadStatus === "error") return "Refresh after fixing the provider store or shell environment.";
  if (installedCount === 0) return "Install Codex, Claude Code, or Pi to launch from amux.";
  if (historyCount === 0) return "Start a provider from the left rail to create this project's first session.";
  return "Choose a recent root history or start a new provider session.";
}

export function exitGuardNotice(runtimeCount: number): string {
  return `Press q again to quit and close ${runtimeCount} running pane${runtimeCount === 1 ? "" : "s"}.`;
}

export function terminalFocusBlockedNotice(): string {
  return "Launch an agent pane before entering terminal focus.";
}

export function reusablePaneNotice(providerName: string): string {
  return `That history is already running. Focused the existing ${providerName} pane.`;
}

export function findReusableRuntimeId(
  thread: AgentThread,
  runtimes: Array<{ id: string; thread: AgentThread; status: RuntimeStatus }>,
): string | undefined {
  const key = reusableThreadKey(thread);
  if (!key) return undefined;

  return runtimes.find((runtime) => runtime.status !== "exited" && runtime.status !== "failed" && reusableThreadKey(runtime.thread) === key)?.id;
}

function reusableThreadKey(thread: AgentThread): string | undefined {
  if (thread.source !== "history") return undefined;
  return `${thread.provider}:${thread.sessionPath ?? thread.sessionId ?? thread.id}`;
}

export function sidebarEmptyCopy(filter: string): { title: string; detail: string } {
  if (filter.trim()) {
    return { title: "No matching histories", detail: "Press Esc to clear the filter." };
  }

  return { title: "No root histories yet", detail: "Start a provider session from the left rail." };
}

export function sidebarScrollHintText(hiddenAbove: number, hiddenBelow: number): string {
  const scroll = [hiddenAbove > 0 ? `↑ ${hiddenAbove}` : "", hiddenBelow > 0 ? `↓ ${hiddenBelow}` : ""].filter(Boolean).join("   ");
  return scroll || "↵ launch  ·  tab visible provider";
}

export function paneStripEmptyCopy(): { title: string; detail: string } {
  return {
    title: "live panes",
    detail: "None yet. Enter launches the selected history or starter.",
  };
}

export function paneStripPositionLabel(index: number, total: number): string {
  return `live pane ${index + 1}/${Math.max(0, total)}`;
}

export function paneStripStatusLine(snapshot: Pick<RuntimeSnapshot, "status" | "exitCode" | "title">, width: number, spinnerFrame = ""): string {
  return fit(`${runtimeStatusText(snapshot, spinnerFrame)} ${snapshot.title}`, width);
}

export function visiblePaneSlotIndexes(
  length: number,
  maxSlots = maxPaneStripSlots,
  activeIndex = length - 1,
): { indexes: number[]; hiddenCount: number } {
  const indexes = Array.from({ length }, (_, index) => index);
  const { visible, hiddenCount } = visiblePaneSlots(indexes, maxSlots, activeIndex);
  return { indexes: visible, hiddenCount };
}

export function visiblePaneSlots<T>(items: T[], maxSlots = maxPaneStripSlots, activeIndex = items.length - 1): { visible: T[]; hiddenCount: number } {
  const capacity = Math.max(1, maxSlots);
  if (items.length <= capacity) return { visible: items, hiddenCount: 0 };

  const visibleCount = Math.max(1, capacity - 1);
  const normalizedActive = clamp(activeIndex, 0, items.length - 1);
  const tail = items.slice(-visibleCount);
  if (normalizedActive >= items.length - visibleCount) {
    return {
      visible: tail,
      hiddenCount: items.length - visibleCount,
    };
  }

  const active = items[normalizedActive]!;
  const newestCount = visibleCount - 1;
  const newest = newestCount > 0 ? items.slice(-newestCount).filter((item) => item !== active) : [];
  return {
    visible: [active, ...newest].slice(0, visibleCount),
    hiddenCount: items.length - visibleCount,
  };
}

export function paneStripTitleWidth(totalWidth: number, slots = maxPaneStripSlots): number {
  return Math.max(4, paneStripCardWidth(totalWidth, slots) - 4);
}

export function paneStripCardWidth(totalWidth: number, slots = maxPaneStripSlots): number {
  const slotCount = Math.max(1, slots);
  const gapBudget = Math.max(0, slotCount - 1);
  return Math.max(8, Math.floor(Math.max(0, totalWidth - gapBudget) / slotCount));
}

function shortProvider(provider: ProviderId): string {
  if (provider === "claude") return "Claude";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function truncate(value: string, size: number): string {
  if (size <= 0) return "";
  if (value.length <= size) return value;
  if (size <= 3) return ".".repeat(size);
  return `${value.slice(0, Math.max(0, size - 3))}...`;
}

function fit(value: string, size: number): string {
  const width = Math.max(0, size);
  return truncate(value, width).padEnd(width, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

function shortPath(value: string): string {
  return value.replace(process.env.HOME ?? "", "~");
}

function timeAgo(date?: Date): string {
  if (!date) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
