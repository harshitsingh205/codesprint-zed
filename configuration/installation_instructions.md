# CodeSprint

CodeSprint adds a Pomodoro focus timer, daily goal, streaks and statistics to Zed's Agent panel.

## Requirements

- Zed with the Agent panel enabled. Node.js is provided by Zed; nothing else to install.
- A model that supports tool calling, to drive the timer in natural language.
- Optional: `notify-send` (Linux) for desktop notifications. macOS and Windows need nothing extra.

## Use it

Open the Agent panel, make sure the CodeSprint tools are enabled in the tool picker, then ask:

- "Start a focus session"
- "How much time is left?"
- "Switch to a short break"
- "Show my streak and stats this week"

The `status` and `stats` prompts are also offered from the `/` menu in text threads.

## Configure

Edit the settings below. Durations are in minutes. Everything is stored locally on your machine; nothing is sent anywhere.
