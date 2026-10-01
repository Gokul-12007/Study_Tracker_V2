const cfg = window.STUDY_TRACKER_CONFIG;
const configured = cfg?.supabaseUrl && cfg.supabasePublishableKey && !cfg.supabasePublishableKey.startsWith('PASTE_');
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
const $ = (s) => document.querySelector(s);
let user, data = { exams: [], subjects: [], chapters: [], todos: [], sessions: [], settings: null };
let timer = { seconds: 25 * 60, running: false, handle: null, chapterId: null };

function msg(text, bad = false) { const el = $('#authMessage'); el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--green)'; }
function clock() { const d = new Date(); $('#clockTime').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); $('#clockDate').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
function setupPet() { const pet = $('#studyPet'); if (!pet) return; const saved = JSON.parse(localStorage.getItem('study-tracker-pet') || 'null'); if (saved) { pet.style.left = `${saved.x}px`; pet.style.top = `${saved.y}px`; } let drag = null; pet.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, left: pet.offsetLeft, top: pet.offsetTop, moved: false }; pet.setPointerCapture(e.pointerId); }); pet.addEventListener('pointermove', e => { if (!drag) return; const x = Math.max(0, Math.min(window.innerWidth - pet.offsetWidth, drag.left + e.clientX - drag.x)); const y = Math.max(0, Math.min(window.innerHeight - pet.offsetHeight, drag.top + e.clientY - drag.y)); drag.moved = true; pet.style.left = `${x}px`; pet.style.top = `${y}px`; pet.style.right = 'auto'; pet.style.bottom = 'auto'; }); pet.addEventListener('pointerup', () => { if (!drag) return; localStorage.setItem('study-tracker-pet', JSON.stringify({ x: pet.offsetLeft, y: pet.offsetTop })); if (!drag.moved) { const lines = ['Quiet focus.', 'One task at a time.', 'You are doing well.', 'Small progress counts.']; $('#petMessage').textContent = lines[Math.floor(Math.random() * lines.length)]; } drag = null; }); }
function minutesLabel(m) { return m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`; }
function localDay(date) { return new Date(date).toLocaleDateString('en-CA'); }

async function loadData() {
  const tables = ['exams', 'subjects', 'chapters', 'todos', 'study_sessions', 'user_settings'];
  const result = await Promise.all(tables.map(async t => { let q = sb.from(t).select('*').eq('user_id', user.id); if (t !== 'user_settings') q = q.order(t === 'study_sessions' ? 'started_at' : 'created_at', { ascending: false }); return (await q).data || []; }));
  [data.exams, data.subjects, data.chapters, data.todos, data.sessions, data.settings] = result;
  data.settings = data.settings[0] || null;
  render();
}

function render() {
  const name = user.user_metadata?.display_name || user.email.split('@')[0];
  const hour = new Date().getHours(); $('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${name}`;
  renderStats(); renderChart(); renderTodos(); renderSubjects(); renderChapterSelect();
}

function renderStats() {
  const today = localDay(new Date());
  const focus = data.sessions.filter(s => s.session_type === 'focus');
  const todaySessions = focus.filter(s => localDay(s.started_at) === today);
  const todayMinutes = todaySessions.reduce((n, s) => n + s.duration_minutes, 0);
  const week = focus.filter(s => Date.now() - new Date(s.started_at).getTime() < 7 * 864e5);
  const weekMinutes = week.reduce((n, s) => n + s.duration_minutes, 0);
  const done = data.chapters.filter(c => c.is_completed).length;
  $('#todayMinutes').textContent = minutesLabel(todayMinutes); $('#todaySessions').textContent = `${todaySessions.length} focus session${todaySessions.length === 1 ? '' : 's'}`;
  $('#weekMinutes').textContent = minutesLabel(weekMinutes); $('#weeklyTotal').textContent = minutesLabel(weekMinutes);
  const goal = (data.settings?.daily_goal_minutes || 120) * 7; $('#weekGoal').textContent = `Goal: ${Math.min(100, Math.round(weekMinutes / goal * 100))}%`;
  $('#chapterProgress').textContent = data.chapters.length ? `${Math.round(done / data.chapters.length * 100)}%` : '0%'; $('#chapterCounts').textContent = `${done} of ${data.chapters.length} complete`;
  const days = new Set(focus.map(s => localDay(s.started_at))); let streak = 0, cursor = new Date(); while (days.has(localDay(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); } $('#streak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;
}

function renderChart() {
  const root = $('#weeklyChart'); root.innerHTML = ''; const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const values = days.map(d => data.sessions.filter(s => s.session_type === 'focus' && localDay(s.started_at) === localDay(d)).reduce((n, s) => n + s.duration_minutes, 0)); const max = Math.max(...values, 30);
  days.forEach((d, i) => { const b = document.createElement('div'); b.className = 'bar'; b.innerHTML = `<span>${values[i]}m</span><div style="height:${Math.max(3, values[i] / max * 190)}px"></div><span>${d.toLocaleDateString([], { weekday: 'short' }).slice(0, 1)}</span>`; root.append(b); });
}

function renderTodos() {
  const root = $('#todoList'); root.innerHTML = ''; const todos = [...data.todos].sort((a,b) => a.is_completed - b.is_completed || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  if (!todos.length) { root.className = 'list empty'; root.textContent = 'Add a task to make today intentional.'; return; } root.className = 'list';
  todos.forEach(todo => { const row = $('#todoTemplate').content.firstElementChild.cloneNode(true); const check = row.querySelector('input'); check.checked = todo.is_completed; check.onchange = async () => { await sb.from('todos').update({ is_completed: check.checked, completed_at: check.checked ? new Date().toISOString() : null }).eq('id', todo.id); await loadData(); }; row.querySelector('strong').textContent = todo.title; row.querySelector('small').textContent = `${todo.priority} priority${todo.due_date ? ` · due ${todo.due_date}` : ''}`; row.querySelector('.delete').onclick = async () => { await sb.from('todos').delete().eq('id', todo.id); await loadData(); }; root.append(row); });
}

function renderSubjects() {
  const root = $('#subjectList'); root.innerHTML = ''; if (!data.subjects.length) { root.className = 'list empty'; root.textContent = 'Create an exam, then add subjects and chapters.'; return; } root.className = 'list';
  data.subjects.forEach(s => { const ch = data.chapters.filter(c => c.subject_id === s.id); const done = ch.filter(c => c.is_completed).length; const ex = data.exams.find(e => e.id === s.exam_id); const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<div class="row-copy"><strong>${s.name}</strong><small>${ex?.name || 'No exam'} · ${done}/${ch.length} chapters</small><div class="subject-progress"><div style="width:${ch.length ? done / ch.length * 100 : 0}%"></div></div></div><button class="delete" aria-label="Add chapter">+</button>`; row.querySelector('button').onclick = () => openChapterModal(s.id); root.append(row); });
}

function renderChapterSelect() { const select = $('#chapterSelect'); const current = select.value; select.innerHTML = '<option value="">General study session</option>'; data.chapters.filter(c => !c.is_completed).forEach(c => { const s = data.subjects.find(x => x.id === c.subject_id); select.add(new Option(`${s?.name || 'Study'} · ${c.name}`, c.id)); }); select.value = current; }

function updateTimer() { const m = Math.floor(timer.seconds / 60), s = timer.seconds % 60; $('#timerDisplay').textContent = `${m}:${String(s).padStart(2, '0')}`; $('#startTimer').textContent = timer.running ? 'Pause' : timer.seconds < (data.settings?.pomodoro_work_minutes || 25) * 60 ? 'Resume focus' : 'Start focus'; }
async function finishTimer() { clearInterval(timer.handle); timer.running = false; const duration = data.settings?.pomodoro_work_minutes || 25; await sb.from('study_sessions').insert({ user_id: user.id, chapter_id: timer.chapterId, duration_minutes: duration, session_type: 'focus' }); if ('Notification' in window && Notification.permission === 'granted') new Notification('Focus session complete!', { body: `You just studied for ${duration} minutes. Great work.` }); timer.seconds = duration * 60; updateTimer(); await loadData(); }
function toggleTimer() { if (timer.running) { clearInterval(timer.handle); timer.running = false; } else { timer.chapterId = $('#chapterSelect').value || null; timer.running = true; timer.handle = setInterval(() => { timer.seconds--; updateTimer(); if (timer.seconds <= 0) finishTimer(); }, 1000); } updateTimer(); }

function modal(title, fields, save) { const content = $('#modalContent'); content.innerHTML = `<div class="modal-fields"><h2>${title}</h2>${fields}</div>`; const dialog = $('#modal'); dialog.showModal(); const form = $('#modalForm'); form.onsubmit = async e => { e.preventDefault(); await save(new FormData(form)); dialog.close(); await loadData(); }; }
function openTodoModal() { modal('Add a task', `<label>Task<input name="title" required maxlength="300" placeholder="e.g. Revise probability"></label><label>Due date<input name="due_date" type="date"></label><label>Priority<select name="priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></label>`, async f => sb.from('todos').insert({ user_id: user.id, title: f.get('title'), due_date: f.get('due_date') || null, priority: f.get('priority') })); }
function openExamModal() { modal('Create an exam', `<label>Exam name<input name="name" required maxlength="120" placeholder="e.g. CFA Level 1"></label><label>Exam date<input name="exam_date" type="date"></label><label>Accent color<input name="color" type="color" value="#8174ff"></label>`, async f => sb.from('exams').insert({ user_id: user.id, name: f.get('name'), exam_date: f.get('exam_date') || null, color: f.get('color') })); }
function openSubjectModal() { if (!data.exams.length) { alert('Create an exam first.'); return; } modal('Add a subject', `<label>Exam<select name="exam_id">${data.exams.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select></label><label>Subject name<input name="name" required maxlength="120" placeholder="e.g. Economics"></label>`, async f => sb.from('subjects').insert({ user_id: user.id, exam_id: f.get('exam_id'), name: f.get('name') })); }
function openChapterModal(subjectId) { modal('Add a chapter', `<label>Chapter name<input name="name" required maxlength="200" placeholder="e.g. Conditional probability"></label><label>Estimated study minutes<input name="estimated_minutes" type="number" min="1" placeholder="60"></label>`, async f => sb.from('chapters').insert({ user_id: user.id, subject_id: subjectId, name: f.get('name'), estimated_minutes: Number(f.get('estimated_minutes')) || null })); }

async function setup() {
  clock(); setInterval(clock, 1000); if (!configured) { $('#authForm').hidden = true; msg('Add your Supabase publishable key in config.js first.', true); return; }
  const { data: { session } } = await sb.auth.getSession(); if (session) await enterApp(session.user);
  $('#authForm').onsubmit = async e => { e.preventDefault(); const email = $('#email').value, password = $('#password').value; const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) msg(error.message, true); else msg('Signed in.'); };
  $('#signUp').onclick = async () => { const { error } = await sb.auth.signUp({ email: $('#email').value, password: $('#password').value, options: { data: { display_name: $('#email').value.split('@')[0] } } }); msg(error ? error.message : 'Check your email to confirm your account.', !!error); };
  sb.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN') enterApp(session.user); if (event === 'SIGNED_OUT') location.reload(); });
  $('#signOut').onclick = () => sb.auth.signOut(); $('#startTimer').onclick = toggleTimer; $('#resetTimer').onclick = () => { timer.seconds = (data.settings?.pomodoro_work_minutes || 25) * 60; timer.running = false; clearInterval(timer.handle); updateTimer(); }; $('#addTodoButton').onclick = openTodoModal; $('#addExamButton').onclick = openExamModal; $('#addSubjectButton').onclick = openSubjectModal; $('#settingsButton').onclick = () => modal('Timer settings', `<label>Focus minutes<input name="work" type="number" min="1" max="120" value="${data.settings?.pomodoro_work_minutes || 25}"></label><label>Daily goal minutes<input name="goal" type="number" min="1" max="1440" value="${data.settings?.daily_goal_minutes || 120}"></label>`, async f => sb.from('user_settings').upsert({ user_id: user.id, pomodoro_work_minutes: Number(f.get('work')), daily_goal_minutes: Number(f.get('goal')) }));
}
async function enterApp(u) { user = u; $('#authView').hidden = true; $('#appView').hidden = false; setupPet(); await sb.from('profiles').upsert({ id: user.id, display_name: user.user_metadata?.display_name || null }); await loadData(); timer.seconds = (data.settings?.pomodoro_work_minutes || 25) * 60; updateTimer(); }
setup();
