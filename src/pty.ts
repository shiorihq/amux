import { RGBA, TextAttributes } from "@opentui/core";
import { Terminal } from "@xterm/headless";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import type { AgentThread } from "./types.ts";

export type RuntimeStatus = "starting" | "running" | "exited" | "failed";

export interface RuntimeSnapshot {
  id: string;
  thread: AgentThread;
  title: string;
  status: RuntimeStatus;
  exitCode?: number;
  lines: TerminalLine[];
  scrollOffset: number;
  scrollbackLines: number;
  commandLabel: string;
  startedAt: Date;
}

export interface TerminalLine {
  runs: TerminalRun[];
  cols: number;
}

export interface TerminalRun {
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes?: number;
}

export class AgentRuntime extends EventEmitter {
  readonly id: string;
  readonly thread: AgentThread;
  readonly term: Terminal;
  readonly startedAt = new Date();
  status: RuntimeStatus = "starting";
  exitCode?: number;
  private host?: ReturnType<typeof Bun.spawn>;
  private hostStdin?: { write: (data: string | Uint8Array) => unknown; end?: () => unknown };
  private cols: number;
  private rows: number;
  private scrollOffset = 0;
  private commandLabel: string;
  private closed = false;

  constructor(thread: AgentThread, cols: number, rows: number) {
    super();
    this.id = `${thread.id}:${Date.now()}`;
    this.thread = thread;
    this.cols = Math.max(20, cols);
    this.rows = Math.max(5, rows);
    this.term = new Terminal({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
      scrollback: 5_000,
      convertEol: true,
    });
    this.commandLabel = thread.command.map(shellQuote).join(" ");
  }

  start(): void {
    if (this.closed) return;
    const [command, ...args] = this.thread.command;
    if (!command) {
      this.status = "failed";
      this.term.write("No command configured for this item.\r\n");
      this.emit("change");
      return;
    }

    try {
      this.host = Bun.spawn(["node", fileURLToPath(new URL("./pty-host.cjs", import.meta.url))], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      this.hostStdin = this.host.stdin as unknown as AgentRuntime["hostStdin"];
      this.readHostOutput(this.host.stdout as ReadableStream<Uint8Array>);
      this.sendHost({
        type: "create",
        id: this.id,
        command,
        args,
        cols: this.cols,
        rows: this.rows,
        cwd: this.thread.cwd,
        env: {
          ...cleanEnv(process.env),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
    } catch (error) {
      this.status = "failed";
      this.term.write(`[amux] failed to launch ${this.commandLabel}\r\n${String(error)}\r\n`);
    }

    this.emit("change");
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    const nextCols = Math.max(20, cols);
    const nextRows = Math.max(5, rows);
    if (nextCols === this.cols && nextRows === this.rows) return;

    this.cols = nextCols;
    this.rows = nextRows;
    this.term.resize(nextCols, nextRows);
    this.clampScrollOffset();
    this.sendHost({ type: "resize", id: this.id, cols: nextCols, rows: nextRows });
    this.emit("change");
  }

  write(data: string): void {
    if (this.closed) return;
    if (this.status !== "running" && this.status !== "starting") return;
    this.scrollToBottom();
    this.sendHost({ type: "write", id: this.id, data });
  }

  scrollBy(delta: number): void {
    if (this.closed) return;
    const buffer = this.term.buffer.active;
    const maxOffset = Math.max(0, buffer.baseY);
    this.scrollOffset = clamp(this.scrollOffset + delta, 0, maxOffset);
    this.emit("change");
  }

  scrollPage(direction: "up" | "down"): void {
    this.scrollBy(direction === "up" ? this.rows - 2 : -(this.rows - 2));
  }

  scrollToBottom(): void {
    if (this.closed) return;
    if (this.scrollOffset === 0) return;
    this.scrollOffset = 0;
    this.emit("change");
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    this.sendHost({ type: "kill", id: this.id });
    this.hostStdin?.end?.();
    this.host?.kill();
    this.term.dispose();
    this.removeAllListeners();
  }

  snapshot(): RuntimeSnapshot {
    if (this.closed) {
      return {
        id: this.id,
        thread: this.thread,
        title: this.thread.title,
        status: this.status,
        exitCode: this.exitCode,
        lines: Array.from({ length: this.rows }, () => blankTerminalLine(this.cols)),
        scrollOffset: 0,
        scrollbackLines: 0,
        commandLabel: this.commandLabel,
        startedAt: this.startedAt,
      };
    }

    return {
      id: this.id,
      thread: this.thread,
      title: this.thread.title,
      status: this.status,
      exitCode: this.exitCode,
      lines: this.visibleLines(),
      scrollOffset: this.scrollOffset,
      scrollbackLines: this.term.buffer.active.baseY,
      commandLabel: this.commandLabel,
      startedAt: this.startedAt,
    };
  }

  private visibleLines(): TerminalLine[] {
    const buffer = this.term.buffer.active;
    this.clampScrollOffset();
    const start = Math.max(0, buffer.baseY - this.scrollOffset);
    const lines: TerminalLine[] = [];
    const reusableCell = buffer.getNullCell();

    for (let row = 0; row < this.rows; row += 1) {
      const line = buffer.getLine(start + row);
      lines.push(line ? lineToTerminalLine(line, this.cols, reusableCell) : blankTerminalLine(this.cols));
    }

    return lines;
  }

  private clampScrollOffset(): void {
    this.scrollOffset = clamp(this.scrollOffset, 0, Math.max(0, this.term.buffer.active.baseY));
  }

  private async readHostOutput(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (this.closed) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          this.handleHostMessage(line);
        }
      }
    } catch (error) {
      if (this.status === "running" || this.status === "starting") {
        this.status = "failed";
        this.term.write(`\r\n[amux] PTY host failed: ${String(error)}\r\n`);
        this.emit("change");
      }
    }
  }

  private handleHostMessage(line: string): void {
    if (this.closed) return;
    if (!line.trim()) return;

    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id !== this.id && message.id !== "host") return;

    if (message.type === "ready") {
      this.status = "running";
      this.emit("change");
      return;
    }

    if (message.type === "data") {
      if (this.status === "starting") {
        this.status = "running";
      }
      this.term.write(message.data ?? "", () => this.emit("change"));
      return;
    }

    if (message.type === "exit") {
      this.status = "exited";
      this.exitCode = message.exitCode;
      this.term.write(`\r\n[amux] ${basename(this.thread.command[0] ?? "process")} exited with code ${message.exitCode}\r\n`);
      this.emit("change");
      return;
    }

    if (message.type === "error") {
      this.status = "failed";
      this.term.write(`\r\n[amux] ${message.error}\r\n`);
      this.emit("change");
    }
  }

  private sendHost(message: Record<string, unknown>): void {
    if (this.closed && message.type !== "kill") return;
    this.hostStdin?.write(`${JSON.stringify(message)}\n`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function lineToTerminalLine(line: { getCell: (index: number, cell?: any) => any }, cols: number, reusableCell: any): TerminalLine {
  const runs: TerminalRun[] = [];
  let current: TerminalRun | undefined;

  for (let column = 0; column < cols; column += 1) {
    const cell = line.getCell(column, reusableCell);
    if (!cell || cell.getWidth() === 0) continue;

    const text = cell.getChars() || " ";
    const style = cellStyle(cell);
    const key = styleKey(style);

    if (current && styleKey(current) === key) {
      current.text += text;
    } else {
      current = { text, ...style };
      runs.push(current);
    }
  }

  return { runs, cols };
}

function blankTerminalLine(cols: number): TerminalLine {
  return {
    cols,
    runs: [{ text: " ".repeat(cols) }],
  };
}

function cellStyle(cell: any): Omit<TerminalRun, "text"> {
  const style: Omit<TerminalRun, "text"> = {};

  if (!cell.isFgDefault()) {
    style.fg = cell.isFgRGB() ? rgbColor(cell.getFgColor()) : RGBA.fromIndex(cell.getFgColor());
  }

  if (!cell.isBgDefault()) {
    style.bg = cell.isBgRGB() ? rgbColor(cell.getBgColor()) : RGBA.fromIndex(cell.getBgColor());
  }

  const attributes = cellAttributes(cell);
  if (attributes !== TextAttributes.NONE) {
    style.attributes = attributes;
  }

  return style;
}

function cellAttributes(cell: any): number {
  let attributes = TextAttributes.NONE;
  if (cell.isBold()) attributes |= TextAttributes.BOLD;
  if (cell.isDim()) attributes |= TextAttributes.DIM;
  if (cell.isItalic()) attributes |= TextAttributes.ITALIC;
  if (cell.isUnderline()) attributes |= TextAttributes.UNDERLINE;
  if (cell.isBlink()) attributes |= TextAttributes.BLINK;
  if (cell.isInverse()) attributes |= TextAttributes.INVERSE;
  if (cell.isInvisible()) attributes |= TextAttributes.HIDDEN;
  if (cell.isStrikethrough()) attributes |= TextAttributes.STRIKETHROUGH;
  return attributes;
}

function rgbColor(value: number): RGBA {
  return RGBA.fromInts((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function styleKey(style: Omit<TerminalRun, "text">): string {
  return `${style.fg?.toString() ?? ""}|${style.bg?.toString() ?? ""}|${style.attributes ?? 0}`;
}
