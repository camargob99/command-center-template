# Command Center

Your tasks, your Google Calendar week, and your starred email on one screen. It runs only on your PC
(http://localhost:4321). Your tasks live in `data\tasks.json` and never leave your computer.

## Setup (about 15 minutes, once)

### 1. Install Node.js
Download the **LTS** installer from https://nodejs.org and run it with the default options.

### 2. Try it
Double-click **`demo.bat`**. Your browser opens on a demo with sample tasks and a fake calendar.
Close the black window when you're done.

Then double-click **`start.bat`**. On the first run it imports your Todoist tasks from
`todoist-import.json` (optional; a snapshot Claude can export for you). After that the dashboard is your task list.

### 3. Connect Google Calendar and Gmail
Google needs you to register the app once, so it can ask you to sign in.

1. Go to https://console.cloud.google.com and sign in with your Google account.
2. At the top, click the project picker › **New project**. Name it `Command Center`. Click **Create**, then select it.
3. Search for **Google Calendar API** and click **Enable**. Do the same for **Gmail API**.
4. Open **Google Auth Platform** (search for "OAuth consent screen"). Click **Get started**:
   - App name: `Command Center`, support email: your Gmail. Audience: **External**. Contact email: your Gmail. Agree and **Create**.
   - In **Audience**, under Test users, click **Add users** and add your Gmail.
   - Still in **Audience**, click **Publish app** and confirm. This keeps you signed in. Without it, Google signs you out every 7 days.
5. Open **Clients** › **Create client**. Application type: **Desktop app**. Name: `Command Center`. Click **Create**.
6. Copy the **Client ID** and **Client secret**.
7. In this folder, copy `config.example.json` to `config.json`, open it in Notepad, and paste the two values in.
8. Close the black window and run `start.bat` again. Click **Connect Google** in the blue bar.
   Google warns that the app isn't verified. That's expected because you made it yourself: click **Advanced** › **Go to Command Center**, then **Continue**.

### 4. Start it automatically (optional)
Press **Win + R**, type `shell:startup`, press Enter, and put a shortcut to `start.bat` in that folder.

## Using it

Two tabs along the top: **Tasks** (press 1) and **Calendar** (2). Press 3 for the Inbox.

| Do this | How |
| --- | --- |
| Add a task | Type in the bar at the top and press Enter. On the Inbox it's the big bar over the list. Press **Q** to jump to it, click **?** for the format. |
| Inbox | One list: Starred, Today, Tomorrow and This week on the left; Unsorted and Later on the right. Anything with no date sits in **Unsorted** until it gets one. Claude leaves a suggestion on each (✓ accepts, ✕ dismisses), or pick Today, Tomorrow, Next week or **Someday**. |
| Day list | Tasks with a date but no time share one 15-minute block at 8:30am that day, titled `Tasks (N) [See Notes]`, with the list in its notes. It updates as the tasks change. |
| Pick a project | Type **#** and choose from the list (arrows + Enter, or click). Typing a new name offers to create it. |
| Pick a section | Type **/** after a project to see its sections. **/** on its own lists every section and fills in the project for you. A new name offers "Create section". **Esc** closes the list and keeps what you typed. |
| Projects | Click a project on the left. **Board** shows a column per section (drag cards between them; **Wrap rows** or **Scroll sideways**); **List** groups by section. **Stats** shows open, overdue and completed counts. |
| Organize | Drag a project in the sidebar, or a section by its header, to reorder. The **⋯** menu on a project or section renames, moves, archives or deletes it. Right-click a project in the sidebar for the same menu. |
| Block time | Drag a task onto the Calendar tab, or click **Schedule** on any task to see only your free times. |
| Move a block | Drag it to a new time, or click its time on the task to change the start or length. Editing a scheduled task's date, time or minutes moves its block. Blocks show in Google Calendar in yellow. |
| Star | Click the star on a task, or type `@star`. Starred tasks are highlighted and sit at the top. Drag to rank them on Today. |
| Search and jump | **Ctrl K**: find any task, project or section, or run a command like "dark mode". |
| Dark mode | The moon icon at the top right. |
| Edit or delete | Click a task's name. Double-click a block on the calendar. |
| Email needing a reply | Star an email in Gmail. Each morning the Today page takes a fresh batch: starred emails from the last 15 days that you haven't answered yet. |

Blocks you create go on your **main Google Calendar** in your project's color, with a 5-minute popup reminder.
Free times come from all your visible calendars, with a 10-minute buffer around meetings,
8am–9pm on weekdays and 8am–6pm on weekends.

## Claude and Duet
Claude can add, read, change and schedule tasks here three ways (details in `CLAUDE.md`):
- **Claude desktop:** Settings > Developer > Edit config, and add under `"mcpServers"`:
  `"command-center": { "command": "node", "args": ["C:\\path\\to\\command-center\\mcp.js"] }`, then restart Claude.
- **Any Claude with this folder:** a `.json` file of ops in `claude-inbox\` runs within seconds; results land in `claude-inbox\done\`.
- **Command line:** `node cc.js add "Call Sam fri 2pm #Work"`, `node cc.js list today`.

The dashboard refreshes by itself when Claude changes something. If the app is closed, changes wait and run at the next start.

## In the cloud (Cloudflare)
The same app can run on Cloudflare's free tier, so Claude on your phone (Duet, the Claude app) can reach your tasks with your PC off.
1. Put your Google **Web application** client file at `cloud\google-web-client.json` (redirect URI `https://command-center.<subdomain>.workers.dev/oauth/callback`).
2. Double-click **setup-cloud.bat**. It logs in to Cloudflare (click Allow), creates the database, copies `data\tasks.json` up, stores the secrets and deploys. Safe to run again; `setup-cloud.bat --reimport` overwrites the cloud tasks with this PC's copy.
3. Open the dashboard link in `cloud\your-links.txt` and sign in with Google. Only the email in `cloud\wrangler.toml` (ALLOWED_EMAIL) can get in.
4. In claude.ai: Settings > Connectors > Add custom connector, and paste the connector URL from `cloud\your-links.txt`. Keep that URL private.

To ship a change later: `cd cloud` then `npx wrangler@4 deploy`.

## Your data
- Tasks: `data\tasks.json`. A copy is saved each day in `data\backups\`.
- To back up somewhere else, copy the `data` folder (for example into OneDrive).
- Google sign-in is stored in `data\google-token.json`. Delete it to sign out.
- The app only listens on your own PC. Nobody on your Wi-Fi can open it.

## Coming next (v1.1)
- Chat box on the dashboard (through Claude Code, no API key).
- Morning brief reads from the dashboard instead of Todoist.

## For developers
`npm test` runs the parser and free-slot tests. No dependencies; Node 18+.
Fonts (Instrument Serif, Geist, Geist Mono) are bundled in `public/fonts` under the SIL Open Font License, so the app works offline.

## WhatsApp event reminders
Events from the WhatsApp groups you pick show on the Today page (WhatsApp panel under Starred), with "Waiting on you" for messages that need a reply. An event already on your calendar is marked registered by itself.
1. Run **setup-cloud.bat** once more. It deploys the update and adds a private "WhatsApp sync URL" to `cloud\your-links.txt`.
2. Double-click **whatsapp\start-whatsapp.bat**. On your phone: WhatsApp › Settings › Linked devices › Link a device, and scan the QR code in the black window. Once it's linked, close the window and run start-whatsapp.bat again: from then on the sync runs hidden in the background, restarts itself if it stops, and starts when you sign in to Windows.
3. On the dashboard, click **groups** in the WhatsApp panel and tick the groups to watch.

How it works: `whatsapp-bridge.exe` (built from github.com/verygoodplugins/whatsapp-mcp, commit a1af56c) is a read-only linked device that stores messages in `whatsapp\store\` on this PC. Every 10 minutes `whatsapp\sync.js` sends the cloud your group names, plus messages from ticked groups only. Direct chats never leave the PC, and nothing is ever sent on WhatsApp. A free keyword matcher in the cloud (`cloud/wa-match.js`, no AI) turns messages with a clear date and an event word into cards right away. The weekday morning brief has Claude read them with `whatsapp_messages` and save events with `save_whatsapp_events`, which replaces the matcher's rough cards.
The ↻ button in the WhatsApp panel asks your PC to sync now (it checks once a minute); the one in Needs a reply asks Gmail again. Neither uses Claude. The header turns red ("PC sync off since …") when the PC hasn't synced for 30 minutes; it's off or asleep, or run start-whatsapp.bat. Its output is in `whatsapp\sync.log`.
This uses an unofficial WhatsApp client, which is against WhatsApp's terms; read-only use is low risk but not zero. To stop: run `whatsapp\stop-whatsapp.bat`, delete "WhatsApp sync" from `shell:startup`, and remove the device in WhatsApp › Linked devices. `whatsapp\store\whatsapp.db` holds the link credentials; keep it private.

## Email: daily batch and Dismiss
The email list is built once a day (first load after midnight NY time): starred emails from the last 15 days where the newest message in the thread isn't yours. Dismissing one takes it out of today's batch, and nothing refills it until tomorrow, so the list can reach 0.

Dismiss unstars the email in Gmail. That needs one extra Google permission: after updating, open `/auth/google?reconnect=1` on your Command Center link once and approve. Until then, Dismiss just hides the email on the dashboard.
