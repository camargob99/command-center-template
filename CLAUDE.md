# Command Center: instructions for Claude (Duet, Claude desktop, Claude Code)

This folder is my task list. It replaced Todoist. Never add, read or change tasks in Todoist; everything lives here.

## How to change tasks

If the Command Center connector is available (cloud version), use its tools; that copy is the live one once the owner has moved to the cloud.

Pick whichever way you have:

1. **MCP tools** (Claude desktop with the `command-center` server): `list_tasks`, `list_projects`, `add_task`, `update_task`, `complete_task`, `delete_task`, `schedule_task`, `unschedule_task`.
2. **Command line:** `node cc.js add "Call Sam fri 2pm for 30m #Work"`, `node cc.js list today`, `node cc.js done "Sam"`, `node cc.js move "Sam" mon`, or `node cc.js ops '<json array of ops>'`.
3. **Drop folder** (only file access, no commands): write a `.json` file into `claude-inbox/`, e.g. `claude-inbox/20261112-1400-sam.json`:
   ```json
   [{ "op": "add", "content": "Call Sam", "project": "Work", "due": "2026-11-14", "time": "14:00", "duration": 30 }]
   ```
   It runs within a few seconds while the app is open (or at its next start). The result appears in `claude-inbox/done/<same name>`.

To read without running anything, open `data/tasks.json` (read only; never edit it by hand).

## Ops

| op | fields |
|---|---|
| `add` | `text` (quick-add: `fri 2pm`, `for 30m`, `#Project`, `/Section`, `p1`, `@star`, `every mon`) or `content` plus `project`, `section`, `due` (YYYY-MM-DD), `time` (HH:MM), `duration` (min), `priority` (1-4), `description`, `star`, `someday` |
| `update` | `id` or `match` (part of the name, must hit one open task), then any `add` field; `due: ""` clears the date. A calendar block moves with it. `suggest: {content?, project, section?, due, time?}` leaves a suggestion on an Unsorted task (`null` clears it). |
| `complete`, `delete`, `unschedule` | `id` or `match` |
| `schedule` | `id` or `match`, `start` (ISO with offset, e.g. `2026-11-13T14:00:00-05:00`), `minutes` |
| `list` | `when` (`today`, `overdue` or `unsorted`), `project`, `match`, `done`, `limit` |
| `projects` | none |

## House rules

- Task names are next actions: a verb, usually with a date. Person tasks are titled `Name (Company)`.
- Star what matters most (`star`); there's no cap, starred tasks sit at the top.
- Unsorted = open tasks with no date (not starred, not `someday`). Only a date moves a task out. In the morning brief, give each Unsorted task a `suggest` (cleaner name, project, date) instead of filing it yourself; the owner accepts or dismisses it.
- Use existing projects and sections (`projects` op) before making new ones.

## WhatsApp events (cloud connector only)

To check for events: call `whatsapp_messages` with no arguments, then `save_whatsapp_events` with the real upcoming events you found (link, short verbatim quote, sender, deadline), any `replies` the owner owes (messages flagged `for_you` that @mention him or ask him something, unless a later message from "Me" in that group answers it), and its `until` value as `checked_through`. Empty lists are fine. `whatsapp_groups` lists or changes the watched groups. Never send anything on WhatsApp.
