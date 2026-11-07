# codesprint-mcp-server

The engine behind the [CodeSprint extension for Zed](https://github.com/harshitsingh205/codesprint-zed): a zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) server over stdio that provides a Pomodoro timer, daily goal, streaks and statistics.

It works with any MCP client:

```
npx codesprint-mcp-server
```

| Tool | Purpose |
| --- | --- |
| `codesprint_status` | Timer state, time left, daily goal progress (read-only) |
| `codesprint_start` / `pause` / `resume` / `reset` | Control the timer |
| `codesprint_switch_mode` | `focus`, `shortBreak` or `longBreak` |
| `codesprint_stats` | Today, week, streaks, 7-day chart (read-only) |
| `codesprint_clear_data` | Delete all data; requires `confirm: true` |

Prompts: `status`, `stats`.

## Configuration

Settings are JSON in the `CODESPRINT_SETTINGS` environment variable (the Zed extension fills this from `settings.json`). Invalid or missing values fall back to defaults. `CODESPRINT_DATA_DIR` overrides where `data.json` is stored.

## Development

```
npm install
npm test        # compile + 58 unit tests
npm run build   # emits dist/
```
