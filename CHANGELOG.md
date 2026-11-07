# Changelog

## 1.0.0

Initial Zed release, ported from CodeSprint 1.0.0 for VS Code.

- MCP server exposing timer control, statistics and data management as tools, plus `status` and `stats` prompts.
- Shared, unit-tested engine: timestamp-based timer, daily goal, streaks, weekly overview.
- File-backed local storage with atomic writes; multi-window safe.
- Desktop notifications on session completion.
- Settings through Zed `settings.json` with a JSON schema.
