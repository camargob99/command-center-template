// One-time Todoist import from todoist-import.json (a snapshot Claude exports for you).
// Format: { projects: [{ name, sections: [name] }], tasks: [{ content, description, project, section,
//           due: { date, time }, recurring, priority (1 = highest), duration, now }] }
function importTodoist(store, snap) {
  let projects = 0, tasks = 0;
  for (const p of snap.projects || []) {
    let proj = store.projectByName(p.name);
    if (!proj) { proj = p.name === 'Inbox' ? store.projects.find((x) => x.id === 'inbox') : store.addProject(p.name); projects++; }
    for (const s of p.sections || []) if (!proj.sections.find((x) => x.name === s)) store.addSection(proj, s);
  }
  const seen = new Set(store.tasks.map((t) => `${t.projectId}|${t.content}`));
  for (const t of snap.tasks || []) {
    const proj = store.projectByName(t.project) || store.projects.find((x) => x.id === 'inbox');
    if (seen.has(`${proj.id}|${t.content}`)) continue;
    const sec = t.section ? proj.sections.find((s) => s.name === t.section) : null;
    store.addTask({
      content: t.content, description: t.description || '', projectId: proj.id, sectionId: sec ? sec.id : null,
      due: t.due || null, recurring: t.recurring || null, priority: t.priority || 4, duration: t.duration || null,
      now: Boolean(t.now), source: 'todoist',
    });
    tasks++;
  }
  store.data.meta.importedFromTodoist = new Date().toISOString();
  store.save();
  return { projects, tasks };
}

module.exports = { importTodoist };
