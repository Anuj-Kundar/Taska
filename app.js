/* ============================================================
   TasKiro — task manager logic
   Vanilla JS, localStorage persistence, no dead buttons.
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'taskiro.tasks.v1';
  const PREF_KEY = 'taskiro.prefs.v1';

  const CATEGORIES = [
    { name: 'Work', icon: 'briefcase', color: 'text-blue-500' },
    { name: 'Personal', icon: 'user', color: 'text-purple-500' },
    { name: 'Shopping', icon: 'shopping-cart', color: 'text-pink-500' },
    { name: 'Health', icon: 'heart-pulse', color: 'text-emerald-500' },
    { name: 'Learning', icon: 'graduation-cap', color: 'text-amber-500' },
  ];

  const PRIORITY = {
    high: { label: 'High', rank: 3, dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', ring: 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' },
    medium: { label: 'Medium', rank: 2, dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    low: { label: 'Low', rank: 1, dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', ring: 'border-sky-500 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  };

  /* ---------------- State ---------------- */
  let tasks = load(STORE_KEY, []);
  let prefs = load(PREF_KEY, { theme: 'light', sort: 'created', view: 'all', priorityFilter: 'all' });
  let searchQuery = '';
  let pendingConfirm = null;

  /* ---------------- Helpers ---------------- */
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch { return fallback; }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(tasks));
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function icons() { if (window.lucide) window.lucide.createIcons(); }

  function todayStr() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); }
  function parseDate(s) { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
  function fmtDate(s) {
    const d = parseDate(s); if (!d) return '';
    const t = parseDate(todayStr());
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff <= 7) return `In ${diff} days`;
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function isOverdue(t) {
    if (!t.due || t.done) return false;
    return parseDate(t.due) < parseDate(todayStr());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Toasts ---------------- */
  function toast(message, type = 'info') {
    const wrap = $('#toastWrap');
    const colors = {
      info: 'border-slate-200 dark:border-slate-700',
      success: 'border-emerald-200 dark:border-emerald-800',
      error: 'border-red-200 dark:border-red-800',
    };
    const iconMap = { info: 'info', success: 'check-circle-2', error: 'alert-circle' };
    const iconColor = { info: 'text-brand-500', success: 'text-emerald-500', error: 'text-red-500' };
    const el = document.createElement('div');
    el.className = `toast-in pointer-events-auto flex items-center gap-3 rounded-xl border ${colors[type]} bg-white dark:bg-slate-800 px-4 py-3 shadow-lg min-w-[240px] max-w-sm`;
    el.innerHTML = `<i data-lucide="${iconMap[type]}" class="h-5 w-5 ${iconColor[type]} shrink-0"></i>
      <span class="text-sm font-medium flex-1">${escapeHtml(message)}</span>
      <button class="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700"><i data-lucide="x" class="h-4 w-4"></i></button>`;
    wrap.appendChild(el);
    icons();
    const remove = () => { el.style.transition = 'opacity .2s, transform .2s'; el.style.opacity = '0'; el.style.transform = 'translateX(24px)'; setTimeout(() => el.remove(), 200); };
    el.querySelector('button').addEventListener('click', remove);
    setTimeout(remove, 3200);
  }

  /* ---------------- Overlay open/close (hard show/hide) ---------------- */
  function openOverlay(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
  function closeOverlay(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
  function anyModalOpen() { return !$('#taskModal').hidden || !$('#confirmModal').hidden; }
  function closeAllMenus() { $$('.dropdown-menu').forEach(m => m.hidden = true); syncMenuAria(); }

  // Menus that use fixed positioning: id -> trigger id
  const MENUS = [
    { menu: 'moreMenu', trigger: 'btnMore', align: 'right' },
    { menu: 'sortMenu', trigger: 'btnSort', align: 'right' },
  ];
  // task row action menus are created dynamically; we track open one
  let openRowMenu = null;

  function positionMenu(menuEl, triggerEl, align) {
    const r = triggerEl.getBoundingClientRect();
    const mw = menuEl.offsetWidth || 200;
    const gap = 6;
    let left = align === 'right' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + gap;
    const mh = menuEl.offsetHeight || 200;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - gap);
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
  }

  function toggleMenu(menuId, triggerId, align) {
    const menuEl = document.getElementById(menuId);
    const wasOpen = !menuEl.hidden;
    closeAllMenus();
    if (openRowMenu) { openRowMenu.remove(); openRowMenu = null; }
    if (!wasOpen) {
      menuEl.hidden = false;
      positionMenu(menuEl, document.getElementById(triggerId), align);
      const t = document.getElementById(triggerId);
      if (t) t.setAttribute('aria-expanded', 'true');
    }
    syncMenuAria();
  }
  function syncMenuAria() {
    MENUS.forEach(({ menu, trigger }) => {
      const t = document.getElementById(trigger);
      if (t) t.setAttribute('aria-expanded', String(!document.getElementById(menu).hidden));
    });
  }

  /* ---------------- Rendering ---------------- */
  function currentList() {
    let list = tasks.slice();

    // View filter
    switch (prefs.view) {
      case 'today': list = list.filter(t => t.due === todayStr() && !t.done); break;
      case 'upcoming': list = list.filter(t => t.due && parseDate(t.due) > parseDate(todayStr()) && !t.done); break;
      case 'starred': list = list.filter(t => t.starred && !t.done); break;
      case 'completed': list = list.filter(t => t.done); break;
      case 'all': list = list.filter(t => !t.done); break;
      default:
        if (prefs.view.startsWith('cat:')) {
          const c = prefs.view.slice(4);
          list = list.filter(t => t.category === c && !t.done);
        }
    }

    // Priority filter
    if (prefs.priorityFilter !== 'all') list = list.filter(t => t.priority === prefs.priorityFilter);

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));
    }

    // Sort
    switch (prefs.sort) {
      case 'due': list.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')); break;
      case 'priority': list.sort((a, b) => PRIORITY[b.priority].rank - PRIORITY[a.priority].rank); break;
      case 'alpha': list.sort((a, b) => a.title.localeCompare(b.title)); break;
      default: list.sort((a, b) => b.created - a.created);
    }
    return list;
  }

  const VIEW_META = {
    all: { title: 'All tasks', sub: 'Everything on your plate' },
    today: { title: 'Today', sub: 'Due today and needing attention' },
    upcoming: { title: 'Upcoming', sub: 'Scheduled for later' },
    starred: { title: 'Starred', sub: 'Your important tasks' },
    completed: { title: 'Completed', sub: 'Nicely done' },
  };

  function taskCard(t) {
    const p = PRIORITY[t.priority] || PRIORITY.medium;
    const cat = CATEGORIES.find(c => c.name === t.category);
    const overdue = isOverdue(t);
    const dueBadge = t.due ? `
      <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${overdue ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}">
        <i data-lucide="${overdue ? 'alarm-clock' : 'calendar'}" class="h-3 w-3"></i>${fmtDate(t.due)}
      </span>` : '';
    const catBadge = cat ? `
      <span class="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <i data-lucide="${cat.icon}" class="h-3 w-3 ${cat.color}"></i>${escapeHtml(t.category)}
      </span>` : '';
    const notes = t.notes ? `<p class="mt-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2 ${t.done ? 'line-through' : ''}">${escapeHtml(t.notes)}</p>` : '';

    return `
    <div class="task-card group relative flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition" data-id="${t.id}" draggable="true">
      <button class="btn-toggle mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition ${t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'}" title="${t.done ? 'Mark as not done' : 'Mark as done'}" aria-label="Toggle done">
        ${t.done ? '<i data-lucide="check" class="h-3.5 w-3.5"></i>' : ''}
      </button>

      <div class="min-w-0 flex-1 cursor-pointer btn-edit">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full ${p.dot} shrink-0" title="${p.label} priority"></span>
          <h3 class="font-semibold truncate ${t.done ? 'line-through text-slate-400 dark:text-slate-500' : ''}">${escapeHtml(t.title)}</h3>
        </div>
        ${notes}
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${p.text} bg-slate-100 dark:bg-slate-800">${p.label}</span>
          ${catBadge}${dueBadge}
        </div>
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        <button class="btn-star h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition ${t.starred ? 'text-amber-500' : 'text-slate-400'}" title="${t.starred ? 'Unstar' : 'Star'}" aria-label="Star">
          <i data-lucide="star" class="h-4 w-4 ${t.starred ? 'fill-amber-500' : ''}"></i>
        </button>
        <button class="btn-edit h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400" title="Edit" aria-label="Edit">
          <i data-lucide="pencil" class="h-4 w-4"></i>
        </button>
        <button class="btn-delete h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 transition text-slate-400" title="Delete" aria-label="Delete">
          <i data-lucide="trash-2" class="h-4 w-4"></i>
        </button>
      </div>
    </div>`;
  }

  function render() {
    // Theme
    document.documentElement.classList.toggle('dark', prefs.theme === 'dark');

    // Nav active state
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === prefs.view));
    $$('#categoryList .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === prefs.view));

    // Chips
    $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.priorityFilter === prefs.priorityFilter));
    styleChips();

    // Sort checks
    $$('.sort-item').forEach(b => {
      const on = b.dataset.sort === prefs.sort;
      const chk = $('.check', b); if (chk) chk.hidden = !on;
    });

    // Titles
    const meta = VIEW_META[prefs.view] || (prefs.view.startsWith('cat:') ? { title: prefs.view.slice(4), sub: 'Category' } : VIEW_META.all);
    $('#viewTitle').textContent = meta.title;
    $('#viewSubtitle').textContent = meta.sub;

    // Counts
    $('[data-count="all"]').textContent = tasks.filter(t => !t.done).length;
    $('[data-count="today"]').textContent = tasks.filter(t => t.due === todayStr() && !t.done).length;
    $('[data-count="upcoming"]').textContent = tasks.filter(t => t.due && parseDate(t.due) > parseDate(todayStr()) && !t.done).length;
    $('[data-count="starred"]').textContent = tasks.filter(t => t.starred && !t.done).length;
    $('[data-count="completed"]').textContent = tasks.filter(t => t.done).length;

    // Category counts
    $$('#categoryList .nav-item').forEach(b => {
      const c = b.dataset.view.slice(4);
      const badge = $('[data-catcount]', b);
      if (badge) badge.textContent = tasks.filter(t => t.category === c && !t.done).length;
    });

    // Progress
    const total = tasks.length;
    const done = tasks.filter(t => t.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#progressBar').style.width = pct + '%';
    $('#progressPct').textContent = pct + '%';
    $('#progressLabel').textContent = `${done} of ${total} done`;

    // List
    const list = currentList();
    const listEl = $('#taskList');
    const empty = $('#emptyState');
    if (list.length === 0) {
      listEl.innerHTML = '';
      empty.hidden = false;
      $('#emptyText').textContent = searchQuery
        ? 'No tasks match your search.'
        : (prefs.view === 'completed' ? 'No completed tasks yet.' : 'Create your first task to get started.');
    } else {
      empty.hidden = true;
      listEl.innerHTML = list.map(taskCard).join('');
    }

    icons();
    save();
  }

  function styleChips() {
    $$('.chip').forEach(c => {
      if (c.classList.contains('active')) {
        c.className = 'chip active rounded-full border px-3 py-1.5 text-xs font-semibold transition border-brand-500 bg-brand-600 text-white';
      } else {
        c.className = 'chip rounded-full border px-3 py-1.5 text-xs font-semibold transition border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-brand-400';
      }
    });
  }

  /* ---------------- Categories sidebar ---------------- */
  function renderCategories() {
    const el = $('#categoryList');
    el.innerHTML = CATEGORIES.map(c => `
      <button data-view="cat:${c.name}" class="nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition">
        <i data-lucide="${c.icon}" class="h-4.5 w-4.5 ${c.color}"></i> <span>${c.name}</span>
        <span data-catcount class="ml-auto text-xs font-semibold rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800">0</span>
      </button>`).join('');
  }

  // nav-item active styling via CSS-in-JS toggle
  function applyNavStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .nav-item { color: rgb(71 85 105); }
      .dark .nav-item { color: rgb(203 213 225); }
      .nav-item:hover { background: rgb(241 245 249); }
      .dark .nav-item:hover { background: rgb(30 41 59); }
      .nav-item.active { background: rgb(238 242 255); color: rgb(79 70 229); }
      .dark .nav-item.active { background: rgba(99,102,241,.12); color: rgb(165 180 252); }
      .nav-item.active [data-count], .nav-item.active [data-catcount] { background: rgb(199 210 254); color: rgb(67 56 202); }
      .prio-opt { border-color: rgb(226 232 240); }
      .dark .prio-opt { border-color: rgb(51 65 85); }
    `;
    document.head.appendChild(style);
  }

  /* ---------------- Task modal ---------------- */
  function openTaskModal(task) {
    const form = $('#taskForm');
    form.reset();
    $('#taskId').value = task ? task.id : '';
    $('#modalTitle').textContent = task ? 'Edit task' : 'New task';
    $('#saveBtnText').textContent = task ? 'Save changes' : 'Create task';
    $('#fTitle').value = task ? task.title : '';
    $('#fNotes').value = task ? (task.notes || '') : '';
    $('#fDue').value = task ? (task.due || '') : '';
    $('#fCategory').value = task ? task.category : 'Work';
    const prio = task ? task.priority : 'medium';
    const radio = form.querySelector(`input[name="priority"][value="${prio}"]`);
    if (radio) radio.checked = true;
    stylePriorityPicker();
    openOverlay('taskModal');
    setTimeout(() => $('#fTitle').focus(), 50);
  }

  function stylePriorityPicker() {
    $$('.prio-opt').forEach(opt => {
      const input = opt.querySelector('input');
      const prio = opt.dataset.prio;
      const base = 'prio-opt cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition';
      opt.className = input.checked ? `${base} ${PRIORITY[prio].ring}` : `${base} border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600`;
    });
  }

  function submitTask(e) {
    e.preventDefault();
    const id = $('#taskId').value;
    const title = $('#fTitle').value.trim();
    if (!title) { toast('Please enter a title', 'error'); return; }
    const data = {
      title,
      notes: $('#fNotes').value.trim(),
      due: $('#fDue').value || '',
      category: $('#fCategory').value,
      priority: (document.querySelector('input[name="priority"]:checked') || {}).value || 'medium',
    };
    if (id) {
      const t = tasks.find(x => x.id === id);
      if (t) Object.assign(t, data);
      toast('Task updated', 'success');
    } else {
      tasks.unshift({ id: uid(), done: false, starred: false, created: Date.now(), ...data });
      toast('Task created', 'success');
    }
    closeOverlay('taskModal');
    render();
  }

  /* ---------------- Confirm modal ---------------- */
  function askConfirm({ title, text, okLabel, onOk }) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').querySelector('span, i')?.remove?.();
    $('#confirmOk').innerHTML = `<i data-lucide="trash-2" class="h-4 w-4"></i> ${escapeHtml(okLabel || 'Delete')}`;
    pendingConfirm = onOk;
    openOverlay('confirmModal');
    icons();
  }

  /* ---------------- Task actions ---------------- */
  function toggleDone(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    t.done = !t.done;
    toast(t.done ? 'Task completed' : 'Marked as active', 'success');
    render();
  }
  function toggleStar(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    t.starred = !t.starred;
    render();
  }
  function deleteTask(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    askConfirm({
      title: 'Delete this task?',
      text: `"${t.title}" will be permanently removed.`,
      okLabel: 'Delete',
      onOk: () => { tasks = tasks.filter(x => x.id !== id); toast('Task deleted', 'success'); render(); }
    });
  }

  /* ---------------- Row action menu (kebab) handled via inline buttons ---------------- */

  /* ---------------- Drag & drop reorder ---------------- */
  let dragId = null;
  function bindDrag() {
    const listEl = $('#taskList');
    listEl.addEventListener('dragstart', e => {
      const card = e.target.closest('.task-card'); if (!card) return;
      dragId = card.dataset.id; card.classList.add('dragging');
    });
    listEl.addEventListener('dragend', e => {
      const card = e.target.closest('.task-card'); if (card) card.classList.remove('dragging');
      $$('.drop-target').forEach(c => c.classList.remove('drop-target'));
      dragId = null;
    });
    listEl.addEventListener('dragover', e => {
      e.preventDefault();
      const card = e.target.closest('.task-card');
      $$('.drop-target').forEach(c => c.classList.remove('drop-target'));
      if (card && card.dataset.id !== dragId) card.classList.add('drop-target');
    });
    listEl.addEventListener('drop', e => {
      e.preventDefault();
      const card = e.target.closest('.task-card');
      if (!card || !dragId || card.dataset.id === dragId) return;
      const from = tasks.findIndex(t => t.id === dragId);
      const to = tasks.findIndex(t => t.id === card.dataset.id);
      if (from < 0 || to < 0) return;
      const [moved] = tasks.splice(from, 1);
      tasks.splice(to, 0, moved);
      // reordering only meaningful in "Newest" sort; switch to manual by using created order
      prefs.sort = 'created';
      // reassign created to preserve manual order
      const now = Date.now();
      tasks.forEach((t, i) => { t.created = now - i; });
      render();
    });
  }

  /* ---------------- Sample data ---------------- */
  function seed() {
    const t = todayStr();
    const plus = n => { const d = parseDate(t); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    tasks = [
      { id: uid(), title: 'Finalize Q3 product roadmap', notes: 'Align with design and eng leads before the review.', due: plus(1), category: 'Work', priority: 'high', done: false, starred: true, created: Date.now() },
      { id: uid(), title: 'Design review: onboarding flow', notes: 'Collect feedback on the new empty states.', due: t, category: 'Work', priority: 'medium', done: false, starred: false, created: Date.now() - 1 },
      { id: uid(), title: 'Grocery run', notes: 'Coffee, oats, olive oil, veggies.', due: t, category: 'Shopping', priority: 'low', done: false, starred: false, created: Date.now() - 2 },
      { id: uid(), title: 'Morning workout', notes: '', due: t, category: 'Health', priority: 'medium', done: true, starred: false, created: Date.now() - 3 },
      { id: uid(), title: 'Read "Refactoring UI" chapter 4', notes: 'Take notes on spacing systems.', due: plus(3), category: 'Learning', priority: 'low', done: false, starred: true, created: Date.now() - 4 },
      { id: uid(), title: 'Call the dentist', notes: 'Schedule 6-month cleanup.', due: plus(-1), category: 'Personal', priority: 'high', done: false, starred: false, created: Date.now() - 5 },
    ];
    toast('Sample data loaded', 'success');
    render();
  }

  /* ---------------- More menu actions ---------------- */
  function clearCompleted() {
    const n = tasks.filter(t => t.done).length;
    if (!n) { toast('No completed tasks to clear', 'info'); return; }
    askConfirm({
      title: 'Clear completed tasks?',
      text: `${n} completed task${n > 1 ? 's' : ''} will be removed.`,
      okLabel: 'Clear',
      onOk: () => { tasks = tasks.filter(t => !t.done); toast('Completed tasks cleared', 'success'); render(); }
    });
  }
  function exportTasks() {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'taskiro-tasks.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Tasks exported', 'success');
  }
  function resetAll() {
    if (!tasks.length) { toast('There are no tasks to delete', 'info'); return; }
    askConfirm({
      title: 'Delete all tasks?',
      text: 'Every task will be permanently removed. This cannot be undone.',
      okLabel: 'Delete all',
      onOk: () => { tasks = []; toast('All tasks deleted', 'success'); render(); }
    });
  }

  /* ---------------- Sidebar (mobile) ---------------- */
  function openSidebar() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebarBackdrop').hidden = false; }
  function closeSidebar() { $('#sidebar').classList.add('-translate-x-full'); $('#sidebarBackdrop').hidden = true; }

  /* ---------------- Event wiring ---------------- */
  function bind() {
    // Add task buttons
    ['btnAddTask', 'btnAddTaskTop', 'btnFab', 'btnEmptyAdd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => openTaskModal(null));
    });

    // Theme
    $('#btnTheme').addEventListener('click', () => {
      prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
      render();
    });

    // More & Sort menus
    $('#btnMore').addEventListener('click', e => { e.stopPropagation(); toggleMenu('moreMenu', 'btnMore', 'right'); });
    $('#btnSort').addEventListener('click', e => { e.stopPropagation(); toggleMenu('sortMenu', 'btnSort', 'right'); });

    $('#moreMenu').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      closeAllMenus();
      const a = btn.dataset.action;
      if (a === 'clear-completed') clearCompleted();
      else if (a === 'export') exportTasks();
      else if (a === 'seed') seed();
      else if (a === 'reset') resetAll();
    });
    $('#sortMenu').addEventListener('click', e => {
      const btn = e.target.closest('[data-sort]'); if (!btn) return;
      prefs.sort = btn.dataset.sort;
      closeAllMenus();
      render();
    });

    // Sidebar nav
    $('#sidebar').addEventListener('click', e => {
      const nav = e.target.closest('.nav-item'); if (!nav) return;
      prefs.view = nav.dataset.view;
      prefs.priorityFilter = 'all';
      if (window.innerWidth < 1024) closeSidebar();
      render();
    });

    // Sidebar toggle (mobile)
    $('#btnSidebarToggle').addEventListener('click', openSidebar);
    $('#sidebarBackdrop').addEventListener('click', closeSidebar);

    // Priority chips
    $$('.chip').forEach(chip => chip.addEventListener('click', () => {
      prefs.priorityFilter = chip.dataset.priorityFilter;
      render();
    }));

    // Search
    const search = $('#searchInput');
    search.addEventListener('input', () => {
      searchQuery = search.value.trim();
      $('#btnClearSearch').hidden = !searchQuery;
      render();
    });
    $('#btnClearSearch').addEventListener('click', () => {
      search.value = ''; searchQuery = ''; $('#btnClearSearch').hidden = true; render(); search.focus();
    });

    // Task list delegation
    $('#taskList').addEventListener('click', e => {
      const card = e.target.closest('.task-card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.btn-toggle')) return toggleDone(id);
      if (e.target.closest('.btn-star')) return toggleStar(id);
      if (e.target.closest('.btn-delete')) return deleteTask(id);
      if (e.target.closest('.btn-edit')) { const t = tasks.find(x => x.id === id); if (t) openTaskModal(t); return; }
    });

    // Task form
    $('#taskForm').addEventListener('submit', submitTask);
    $('#priorityPicker').addEventListener('change', stylePriorityPicker);
    $('#priorityPicker').addEventListener('click', e => {
      const opt = e.target.closest('.prio-opt'); if (!opt) return;
      opt.querySelector('input').checked = true;
      stylePriorityPicker();
    });

    // Generic close buttons (data-close) + backdrop clicks
    document.addEventListener('click', e => {
      const closer = e.target.closest('[data-close]');
      if (closer) { closeOverlay(closer.dataset.close); return; }
      if (e.target.classList.contains('modal-backdrop')) {
        closeOverlay('taskModal'); closeOverlay('confirmModal');
      }
    });

    // Confirm OK
    $('#confirmOk').addEventListener('click', () => {
      const fn = pendingConfirm; pendingConfirm = null;
      closeOverlay('confirmModal');
      if (typeof fn === 'function') fn();
    });

    // Close menus on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('#moreMenu, #btnMore, #sortMenu, #btnSort')) closeAllMenus();
    });

    // Reposition fixed menus on scroll/resize so they stay anchored
    const reposition = () => {
      MENUS.forEach(({ menu, trigger, align }) => {
        const m = document.getElementById(menu);
        if (m && !m.hidden) positionMenu(m, document.getElementById(trigger), align);
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', () => { reposition(); if (window.innerWidth >= 1024) $('#sidebarBackdrop').hidden = true; });

    // Keyboard: Esc closes overlays/menus, "n" opens new task
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeAllMenus();
        closeOverlay('taskModal'); closeOverlay('confirmModal'); closeSidebar();
      }
      if (e.key === 'n' && !anyModalOpen() && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); openTaskModal(null);
      }
    });

    bindDrag();
  }

  /* ---------------- Init ---------------- */
  function init() {
    applyNavStyles();
    renderCategories();
    bind();
    // First-run: give the user something to see
    if (!tasks.length && !localStorage.getItem(STORE_KEY)) seed();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
