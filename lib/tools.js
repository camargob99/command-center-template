// Claude's tools for Command Center, shared by the PC MCP server (mcp.js) and the cloud connector (cloud/worker.js).
const target = { id: { type: 'string', description: 'Task id (12 hex chars)' }, match: { type: 'string', description: 'Or part of the task name, if it matches one open task' } };
const fields = {
  project: { type: 'string', description: 'Project name, e.g. "Work"' },
  section: { type: 'string', description: 'Section name inside the project' },
  due: { type: 'string', description: 'Due date YYYY-MM-DD (empty string clears it)' },
  time: { type: 'string', description: 'Due time HH:MM, 24h' },
  duration: { type: 'number', description: 'Minutes' },
  priority: { type: 'number', description: '1 (highest) to 4 (none)' },
  description: { type: 'string', description: 'Notes' },
  star: { type: 'boolean', description: 'Star (highlight) the task so it sits at the top of the list' },
  someday: { type: 'boolean', description: 'Park an undated task as Someday, out of Unsorted' },
};
const TOOLS = [
  { name: 'list_tasks', op: 'list', description: 'List open tasks in Command Center (the owner\'s task list). Filter by when (today | overdue | unsorted; unsorted = no date, not starred, not someday), project, or match.', inputSchema: { type: 'object', properties: { when: { type: 'string', enum: ['today', 'overdue', 'unsorted'] }, project: { type: 'string' }, match: { type: 'string' }, done: { type: 'boolean', description: 'List completed tasks instead' }, limit: { type: 'number' } } } },
  { name: 'list_projects', op: 'projects', description: 'List projects and their sections.', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_task', op: 'add', description: 'Add a task. Easiest: text in quick-add form, e.g. "Call Sam fri 2pm for 30m #Work /Clients @star". Or give content plus fields.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, content: { type: 'string' }, ...fields } } },
  { name: 'update_task', op: 'update', description: 'Change a task: name (content), project, section, due, time, duration, priority, notes, star, someday, or a suggestion for an unsorted task. If it is on the calendar, the block moves too.', inputSchema: { type: 'object', properties: { ...target, content: { type: 'string' }, ...fields, suggest: { type: 'object', description: 'For unsorted tasks: your suggested cleanup, shown to the owner to accept or dismiss. {content?, project, section?, due (YYYY-MM-DD), time?}. Pass null to clear.', properties: { content: { type: 'string' }, project: { type: 'string' }, section: { type: 'string' }, due: { type: 'string' }, time: { type: 'string' } } } } } },
  { name: 'complete_task', op: 'complete', description: 'Check off a task.', inputSchema: { type: 'object', properties: target } },
  { name: 'delete_task', op: 'delete', description: 'Delete a task (and its calendar block).', inputSchema: { type: 'object', properties: target } },
  { name: 'schedule_task', op: 'schedule', description: 'Block time for a task on Google Calendar.', inputSchema: { type: 'object', properties: { ...target, start: { type: 'string', description: 'ISO date-time with offset, e.g. 2026-11-13T14:00:00-05:00' }, minutes: { type: 'number' } }, required: ['start'] } },
  { name: 'unschedule_task', op: 'unschedule', description: 'Take a task off the calendar (keeps the task).', inputSchema: { type: 'object', properties: target } },
];

const INSTRUCTIONS = "Command Center is the owner's task list. Task names are next actions (a verb, usually with a date); person tasks are titled 'Name (Company)'. Star what matters most today (starred tasks sit at the top). Unsorted = tasks with no date: in the morning brief, give each one a suggestion (update_task suggest) rather than filing it yourself. Use list_projects before inventing a project or section. Times are America/New_York.";

module.exports = { TOOLS, INSTRUCTIONS };
