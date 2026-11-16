// Task store. On the PC: one JSON file, written atomically. In the cloud: a JSON document the worker loads and saves to D1.

const COLORS = ['#7a7f87', '#e8743b', '#19a979', '#13447c', '#d6417e', '#1f8a3b', '#5c3fb4', '#e05a5a', '#2a8fbd', '#b38600'];

const DEFAULT = () => ({
  version: 1,
  projects: [{ id: 'inbox', name: 'Inbox', color: COLORS[0], order: 0, sections: [] }],
  tasks: [],
  settings: {
    workStart: '08:00', weekdayEnd: '21:00', weekendEnd: '18:00', bufferMin: 10,
    defaultLength: 30, hiddenCalendars: [], busyCalendars: null,
  },
  meta: { importedFromTodoist: null, createdAt: new Date().toISOString() },
});

const id = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

class Store {
  // new Store('path/to/tasks.json')  or  new Store({ data, onSave(data) {} })
  constructor(src) {
    if (typeof src === 'string') {
      this.file = src;
      const fs = require('fs'), path = require('path');
      fs.mkdirSync(path.dirname(src), { recursive: true });
      if (fs.existsSync(src)) this.data = JSON.parse(fs.readFileSync(src, 'utf8'));
      else { this.data = DEFAULT(); this.save(); }
    } else {
      this.onSave = src.onSave;
      this.data = src.data || DEFAULT();
    }
    this.data.meta = this.data.meta || {};
    this.data.settings = { ...DEFAULT().settings, ...(this.data.settings || {}) };
  }

  save() {
    this.data.meta.rev = (this.data.meta.rev || 0) + 1;
    if (!this.file) { if (this.onSave) this.onSave(this.data); return; }
    const fs = require('fs'), path = require('path');
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    // Rolling daily backup
    const day = new Date().toISOString().slice(0, 10);
    const bak = path.join(path.dirname(this.file), 'backups', `tasks-${day}.json`);
    if (!fs.existsSync(bak)) {
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(this.file, bak);
    }
  }

  get projects() { return this.data.projects; }
  get tasks() { return this.data.tasks; }
  get settings() { return this.data.settings; }

  projectByName(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    return this.projects.find((p) => p.name.toLowerCase() === n)
      || this.projects.find((p) => p.name.toLowerCase().startsWith(n)) || null;
  }

  addProject(name) {
    const p = { id: id(), name, color: COLORS[this.projects.length % COLORS.length], order: this.projects.length, sections: [] };
    this.projects.push(p);
    return p;
  }

  addSection(project, name) {
    const s = { id: id(), name, order: project.sections.length };
    project.sections.push(s);
    return s;
  }

  addTask(fields) {
    const t = {
      id: id(), content: '', description: '', projectId: 'inbox', sectionId: null, parentId: null,
      due: null, duration: null, priority: 4, now: false, recurring: null, event: null,
      createdAt: new Date().toISOString(), completedAt: null, source: 'dashboard', ...fields,
    };
    this.tasks.push(t);
    return t;
  }

  task(tid) { return this.tasks.find((t) => t.id === tid); }

  openNow() { return this.tasks.filter((t) => t.now && !t.completedAt); }
}

module.exports = { Store, COLORS, id };
