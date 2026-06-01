# Contributing

Thanks for helping polish amux.

## Development

Install dependencies:

```bash
bun install
```

Make sure Node.js `>=18` is available on `PATH`; amux uses a small Node helper
process for reliable PTY lifecycle events.

Run the TUI:

```bash
bun run start
```

Run checks before sending changes:

```bash
bun run release:check
```

`release:check` typechecks, runs the test suite, smokes `--help`, `--doctor`,
and `--version`, and dry-runs the package payload.

When reporting bugs, include the checklist from [docs/ISSUE_REPORTS.md](docs/ISSUE_REPORTS.md).

## Design Principles

- Keep the agent output pane faithful to the agent's own terminal colors.
- Force amux chrome colors everywhere outside the agent output pane.
- Prefer compact, scannable UI over decorative copy.
- Loading states should communicate real work and avoid repeated noisy labels.
- History lists should show root histories, not background subagent sidechains.
- Missing provider CLIs should be handled in amux chrome before spawning a PTY.

## Provider Changes

Provider history formats are documented in [docs/PROVIDERS.md](docs/PROVIDERS.md).
When adding a provider, include discovery behavior, launch/resume commands, and
at least one parser test for the expected session shape.

When changing launch behavior, update [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
if the fix changes what users should check first.
