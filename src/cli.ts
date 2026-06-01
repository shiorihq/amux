export type CliAction = "run" | "help" | "version" | "doctor";
export type DoctorFormat = "text" | "json";

export interface CliOptions {
  action: CliAction;
  doctorFormat: DoctorFormat;
  cwd?: string;
  errors: string[];
}

const helpText = `amux

Usage:
  amux [options]

Controls:
  arrows               move through current-project root histories and starters
  j/k                  move while the filter is empty
  type                 filter by provider, title, path, preview, or tag
  enter                launch or resume the selected item
  tab                  jump to the next visible provider group
  ?                    open in-app help
  shift+n              open new-session picker for Codex, Claude Code, or Pi
  shift+p              open action palette for launches and pane commands
  ctrl+left/right      cycle running panes from navigation mode
  ctrl+w               close the active pane from navigation mode
  ctrl+g               toggle between history navigation and agent terminal
  q                    quit; press twice if panes are running

Options:
  -h, --help           show this help
      --doctor         print provider and history diagnostics
      --json           print --doctor output as JSON
      --cwd <path>     run against a specific project directory
  -v, --version        show the package version`;

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    action: "run",
    doctorFormat: "text",
    errors: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      options.action = "help";
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      options.action = "version";
      continue;
    }

    if (arg === "--doctor") {
      options.action = "doctor";
      continue;
    }

    if (arg === "--json" || arg === "--doctor=json") {
      options.doctorFormat = "json";
      if (arg === "--doctor=json") options.action = "doctor";
      continue;
    }

    if (arg === "--cwd") {
      const next = args[index + 1];
      if (!next) {
        options.errors.push("--cwd requires a path");
      } else {
        options.cwd = next;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      const value = arg.slice("--cwd=".length);
      if (!value) {
        options.errors.push("--cwd requires a path");
      } else {
        options.cwd = value;
      }
      continue;
    }

    options.errors.push(`Unknown option: ${arg}`);
  }

  if (options.doctorFormat === "json" && options.action !== "doctor") {
    options.errors.push("--json can only be used with --doctor");
  }

  return options;
}

export function formatCliHelp(): string {
  return helpText;
}

export function formatCliError(errors: string[]): string {
  return [`amux: ${errors.join("; ")}`, "Run `amux --help` for usage."].join("\n");
}
