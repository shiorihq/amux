# Changelog

All notable changes to amux will be documented in this file.

## 0.1.0

- Added the first polished TUI for browsing and launching local agent histories.
- Added Codex, Claude Code, and Pi provider discovery.
- Added live PTY panes rendered through an xterm headless buffer.
- Preserved native agent ANSI/RGB output colors in the agent view.
- Added branded onboarding, provider health, loading states, and Ora-backed spinners.
- Quieted the sidebar loading state and added a provider-store count to the scan summary.
- Simplified sidebar history rows to a single compact line to avoid text overlap.
- Added Shift+N to open a picker for fresh Codex, Claude Code, or Pi sessions.
- Added Shift+P to open an action palette for provider launches, pane controls, refresh, help, and quit.
- Filtered Claude subagent sidechains from the root history list.
- Added preflight handling for missing provider CLIs.
- Added `--doctor --json` diagnostics and explicit errors for unknown CLI flags.
- Improved live pane status labels for clean exits and non-zero exits.
- Added Node.js runtime preflight to onboarding, launch, and doctor diagnostics.
- Added a troubleshooting guide for first-run and runtime issues.
- Ensured the packaged `amux` bin is executable and covered by a packaging test.
- Added spinner-backed launch feedback for panes while agent PTYs are starting.
- Simplified header chrome to avoid provider-health redraw noise.
- Clarified current-project history scope in doctor output, CLI help, and docs.
- Labeled live pane strip cards so they are not confused with history tabs.
- Reused existing live panes when launching the same saved history again.
- Preserved the selected history when refreshing provider and history state.
- Kept Backspace/Delete from moving selection when the filter is already empty.
- Declared the Node.js runtime requirement in package metadata and docs.
- Added a release smoke check for the CLI help entrypoint and documented global install.
- Added a release smoke check for the doctor diagnostics entrypoint.
- Added a release smoke check for the version entrypoint.
- Let active filters receive printable shortcut letters instead of treating them as commands.
- Aligned the sidebar Tab hint with visible-provider cycling behavior.
- Clarified that `j/k` navigate only while the filter is empty.
- Hid unavailable navigation shortcuts from the footer while typing in the filter.
- Made the help overlay stop printable keys from editing the hidden filter behind it.
- Constrained onboarding card widths so first-run copy stays inside its panels.
- Fitted onboarding notices and metric details to the welcome panel width.
- Closed the help overlay when a help-mode app command changes panes or app state.
- Clarified active-filter footer and README copy so `?` help remains discoverable.
- Constrained help panel card widths so key hints stay inside their panels.
- Fitted live pane strip card labels and status lines to their actual card widths.
- Closed overlays before showing the running-pane quit confirmation.
- Fitted active terminal headers so command, status, and scrollback text stay on one row.
- Fitted active workspace border titles for long session names.
- Consolidated terminal command fitting around the active header layout helper.
- Made active terminal headers degrade cleanly in very narrow panes.
- Kept Tab from being appended to active filters so provider cycling remains available.
- Added issue-reporting guidance for first OSS users.
- Added a release smoke check for JSON doctor diagnostics.
- Included next-step hints in JSON doctor diagnostics.
