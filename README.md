# amux

```text
  __ _ _ __ ___  _   ___  __
 / _` | '_ ` _ \| | | \ \/ /
| (_| | | | | | | |_| |>  <
 \__,_|_| |_| |_|\__,_/_/\_\
```

amux is a polished terminal workspace for local coding agents. It gives Codex,
Claude Code, and Pi a shared command center: browse histories for the current
project, resume root histories, and keep live agent PTYs side by side without
juggling a pile of tabs.

The TUI is built with Bun, OpenTUI, PTY sessions, and xterm's headless terminal
buffer. Agent output keeps its natural terminal colors, while amux adds just
enough interface around it to make navigation, health, scrollback, and pane
state obvious.

Supported providers:

- Codex CLI: discovers `~/.codex/sessions` and `~/.codex/archived_sessions`, resumes with `codex resume <session>`
- Claude Code: discovers `~/.claude/projects`, resumes with `claude --resume <session>`
- Pi: discovers `~/.pi/agent/sessions`, resumes with `pi --session <file>`

Implementation details for each provider are captured in [docs/PROVIDERS.md](docs/PROVIDERS.md).
For first-run issues, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
For bug reports, use the checklist in [docs/ISSUE_REPORTS.md](docs/ISSUE_REPORTS.md).

## Run

amux runs on Bun `>=1.3.0` and Node.js `>=18`. Keep `node` on `PATH` for live
PTY panes.

Install dependencies for local development:

```bash
bun install
```

Start the TUI:

```bash
bun run start
```

Or execute directly while developing:

```bash
bun ./index.tsx
```

If the package is installed globally, launch it with:

```bash
amux
```

After amux is published, install it globally with Bun:

```bash
bun install -g amux
```

For local dogfooding, link the command from this checkout:

```bash
bun link
```

Check provider setup without launching the TUI:

```bash
amux --doctor
```

Run against a project without changing your shell directory first:

```bash
amux --cwd /path/to/project
amux --doctor --cwd /path/to/project
```

Emit the same diagnostics as JSON for bug reports or scripts:

```bash
amux --doctor --json
```

## Experience

- Branded onboarding with provider health and current-project history indexing state
- Active project badge in the header and onboarding, so scoped histories are easy to trust
- Current-project root-history browser for Codex, Claude Code, and Pi
- Non-interactive `--doctor` diagnostics for provider setup and root histories
- Runtime preflight for Node.js, which hosts the live PTY bridge
- Live PTY panes for launched agents, with native ANSI and RGB colors preserved
- Live pane strip labels distinguish running panes from the history list
- Pane strip overflow badge when live panes are off-screen, while keeping the active pane visible
- Saved histories focus their existing live pane instead of launching duplicate resumes
- Ora-backed starting indicators for newly launched agent panes
- Stable header chrome; detailed health stays in onboarding and `--doctor`
- Pane status labels distinguish `running`, clean `done`, and non-zero `exit N`
- Scrollback inside the active agent pane
- In-app `?` help that explains the pane strip, navigation, and terminal focus
- Refresh preserves the current history selection when that row still exists
- Keyboard and mouse navigation designed for repeated daily use
- Claude subagent sidechains filtered out of the main history list
- Missing provider CLIs are marked before launch, with an in-app notice instead of a failed PTY

## Controls

- Arrows: move through current-project root histories and starters
- `j/k`: move while the filter is empty
- Type: fuzzy-filter by provider, title, path, preview, or tag
- Once a filter is active, ordinary typing continues the query; `?` still opens help
- `Enter`: launch or resume the selected item
- `Tab`: jump to the next visible provider group
- `?`: open the compact in-app help view
- Mouse click: launch a history, starter, or running pane
- Mouse wheel over the terminal: scroll agent output
- `Ctrl+Left` / `Ctrl+Right` in navigation mode: cycle running panes
- `Ctrl+W` in navigation mode: close the active pane
- `PageUp` / `PageDown` in terminal mode: scroll agent output
- `Shift+Home` / `Shift+End` in terminal mode: jump to top or bottom of scrollback
- `Shift+N`: open a picker to start a new Codex, Claude Code, or Pi session
- `Shift+P`: open the action palette for provider launches, pane commands, refresh, and help
- `Ctrl+G`: toggle between history navigation and the active agent terminal
- `r`: refresh root histories and provider health
- `q`: quit from navigation mode; press twice if panes are still running

When terminal mode is active, keystrokes are forwarded to the running agent.
That means `Ctrl+C` is delivered to Codex, Claude Code, or Pi instead of closing
amux. Use `Ctrl+G` first, then `q`, to exit the shell. If panes are still
running, amux asks for a second `q` before closing them.

Agent output is rendered from the PTY buffer without applying an amux foreground
color. Default text stays on your terminal's default foreground/background, and
ANSI palette or RGB colors emitted by the agent are preserved.

The top strip is a live pane switcher for agents you have already launched.
It is separate from the left root-history list, which stays scoped to the current
project.

Launching a saved history that is already running focuses its existing live pane.
Launching a starter row still creates a fresh session.

## Release Notes

amux is still early, but the repository is shaped for open-source use: MIT
licensed, typed, tested, and packaged with a `bin` entry for the `amux` command.
See [CHANGELOG.md](CHANGELOG.md) for release history and
[CONTRIBUTING.md](CONTRIBUTING.md) for development notes.
