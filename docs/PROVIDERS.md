# Provider Notes

amux treats each agent provider as two surfaces: history discovery and launch
commands. Discovery is scoped to the current working directory: amux shows root
histories whose recorded cwd is the current project or one of its child
directories.

For providers whose history stores are organized by encoded project path, amux
only scans directories that match the active project before parsing session
files. Codex stores sessions by date, so Codex discovery still reads recent
session metadata and filters by recorded cwd.

## Codex CLI

- History roots: `~/.codex/sessions` and `~/.codex/archived_sessions`
- Session file shape: JSONL with `session_meta`, user/assistant payloads, and optional `ai-title`
- Start session: `codex --cd <cwd>`
- Resume history: `codex resume <session-id>`
- Useful CLI behavior: `codex resume --last` opens the most recent session; `codex resume --all` disables cwd filtering

## Claude Code

- History root: `~/.claude/projects`
- Session file shape: JSONL with UUID filenames, `sessionId`, `cwd`, `type: "user"`, and message content
- Start session: `claude --add-dir <cwd>` launched from the workspace cwd
- Resume history: `claude --resume <session-id>`
- Useful CLI behavior: `claude agents --json` exposes live background sessions, which is a natural next integration point

## Pi

- History root: `~/.pi/agent/sessions`
- Session file shape: JSONL with a first `type: "session"` record, model changes, and messages
- Start session: `pi` launched from the workspace cwd
- Resume history: `pi --session <session-file>`
- Useful CLI behavior: `pi --continue`, `pi --resume`, `pi --session-dir`, and `pi --export` are all relevant to richer future session management

## Runtime

The OpenTUI app runs on Bun. PTY sessions are hosted by a tiny Node child
process because the native PTY package delivers reliable process events there.
The host streams JSONL back to Bun, and Bun renders output through
`@xterm/headless` into the OpenTUI pane.
