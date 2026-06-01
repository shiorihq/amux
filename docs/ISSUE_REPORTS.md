# Issue Reports

Good amux reports include enough local context to reproduce terminal, provider,
and history-discovery issues without guessing.

## Quick Checklist

- amux version: `amux --version`
- diagnostics: `amux --doctor --json`
- project path used to launch amux, or the exact `--cwd` value
- provider involved: Codex, Claude Code, Pi, or all providers
- terminal app and size in columns x rows
- what you expected to happen
- what happened instead

## Useful Details

The JSON diagnostics include provider health, current-project root history
counts, runtime health, store availability, and suggested next steps.

For history-list issues, include whether the missing session was created from
the same project directory or a child directory.

For terminal rendering issues, include whether the provider output looks correct
when the provider CLI is launched directly outside amux.

For launch issues, include whether `node`, `codex`, `claude`, or `pi` are
available from the same shell that runs amux.
