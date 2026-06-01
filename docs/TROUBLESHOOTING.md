# Troubleshooting

Start with the doctor output. The final `next steps` section is meant to be
copy-pastable into an issue or followed top-to-bottom:

```bash
amux --doctor
```

Doctor history counts are scoped to the current project and its child
directories. Use `amux --doctor --cwd /path/to/project` when reporting an issue
for a project that is not your current shell directory.

For issue reports, JSON is easier to attach:

```bash
amux --doctor --json
```

## Node.js Missing

amux uses Bun for the TUI and a small Node.js helper for reliable PTY lifecycle
events. If doctor reports `Node.js (node): missing`, install Node.js `>=18` and
make sure `node` is on `PATH`, then run `amux --doctor` again.

## Provider Missing

If Codex, Claude Code, or Pi is marked missing, amux will keep its launcher in
the sidebar but will not start a broken PTY. Install the provider CLI, confirm
it is available in the same shell with `which <command>`, and press `r` in amux
to refresh provider health.

## No Root Histories

amux only shows root histories for the current project. If the sidebar only
shows starters, check that you launched the provider from this project before,
or start a fresh provider session from the left rail.

## Agent Output Looks Wrong

The agent pane preserves the agent process's own ANSI and RGB colors. If colors
look wrong, check your terminal theme and make sure the provider itself renders
correctly outside amux.

## Keys Go To The Wrong Place

When the agent terminal is focused, normal keystrokes go to the agent. Press
`Ctrl+G` to return to navigation, then use `j/k`, `?`, `r`, or `q`.

## Pane Will Not Quit

If panes are still running, `q` asks for confirmation before closing them. Press
`q` a second time from navigation mode to quit amux and close live panes.
