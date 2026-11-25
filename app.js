'use strict';

// ============ helpers ============
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
// course colours, in the same earthy family as the theme (deep green, gold, olive)
const PALETTE = ['#0a6b4d', '#b8935a', '#3f6b8a', '#9a5236', '#6e5a86', '#7a765c', '#2f8a7a', '#a8743a'];
const OLD_PALETTE = ['#5157c9', '#e0702f', '#18a06b', '#c9488a', '#8f5bd0', '#1597a8', '#c99a0e', '#5f7f92'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav)$/i;

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayKey = () => dateKey(new Date());
function niceDate(k, withYear = false) {
  if (!k) return '—';
  if (k === todayKey()) return 'Today';
  if (k === dateKey(addDays(new Date(), 1))) return 'Tomorrow';
  const d = parseKey(k);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function fmt(sec) {
  const tm = Math.round(sec / 60);
  if (sec > 0 && tm === 0) return '<1m';
  const h = Math.floor(tm / 60), m = tm % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
const fmtClock = sec => {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};
const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
// an open dialog sits above the page, so messages move into it to stay visible
const topHost = () => document.querySelector('dialog[open]') || document.body;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  if (t.parentElement !== topHost()) topHost().append(t);
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// "1:02:33", "45:10", "1h 5m", "1.5 hours", "45 min", "30s" -> seconds + the text with the duration removed
function parseDuration(str) {
  let m = str.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (m) return { seconds: +m[1] * 3600 + +m[2] * 60 + +m[3], rest: str.replace(m[0], '') };
  m = str.match(/\b(\d{1,3}):(\d{2})\b/);
  if (m) return { seconds: +m[1] * 60 + +m[2], rest: str.replace(m[0], '') };
  let seconds = 0, rest = str, found = false;
  const units = [
    [/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i, 3600],
    [/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i, 60],
    [/(\d+)\s*(?:s|sec|secs|second|seconds)\b/i, 1],
  ];
  for (const [re, mult] of units) {
    const x = rest.match(re);
    if (x) { seconds += parseFloat(x[1]) * mult; rest = rest.replace(x[0], ''); found = true; }
  }
  return found ? { seconds: Math.round(seconds), rest } : { seconds: 0, rest: str };
}
const cleanTitle = s => s.replace(/[()\[\]]/g, ' ').replace(/^[\s\-–—:|•·*,.\d)]+(?=\D)/, '').replace(/[\s\-–—:|•·,]+$/, '').replace(/\s+/g, ' ').trim();
const isUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());
const WEEK_RE = /^\s*(week|wk|module|unit|lesson|session|chapter)\s*\d+/i;

function parsePasted(text) {
  const weeks = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const { seconds, rest } = parseDuration(line);
    if (WEEK_RE.test(line)) {
      current = { id: uid(), title: cleanTitle(seconds ? rest : line) || line, videos: [] };
      weeks.push(current);
      if (seconds) current.videos.push({ id: uid(), title: 'Week videos', seconds, watched: false });
      continue;
    }
    if (!seconds) continue;
    if (!current) { current = { id: uid(), title: 'Week 1', videos: [] }; weeks.push(current); }
    current.videos.push({ id: uid(), title: cleanTitle(rest) || `Video ${current.videos.length + 1}`, seconds, watched: false });
  }
  return weeks;
}

function readMediaDuration(file) {
  return new Promise(resolve => {
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = s => { if (settled) return; settled = true; URL.revokeObjectURL(url); el.removeAttribute('src'); resolve(s); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(isFinite(el.duration) ? Math.round(el.duration) : 0);
    el.onerror = () => done(0);
    setTimeout(() => done(0), 15000);
    el.src = url;
  });
}

async function weeksFromFiles(files, onProgress) {
  const vids = [...files].filter(f => VIDEO_EXT.test(f.name) || f.type.startsWith('video/'));
  const groups = new Map();
  for (const f of vids) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    const key = parts.length > 2 ? parts[parts.length - 2] : 'Week 1';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const weeks = [];
  let n = 0;
  for (const key of [...groups.keys()].sort(coll.compare)) {
    const week = { id: uid(), title: key, videos: [] };
    for (const f of groups.get(key).sort((a, b) => coll.compare(a.name, b.name))) {
      week.videos.push({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), seconds: await readMediaDuration(f), watched: false });
      onProgress(++n, vids.length);
    }
    weeks.push(week);
  }
  return weeks;
}

// ============ state ============
const state = { data: null, open: new Set(), collapsed: new Set() };
const S = () => state.data.settings;
const speed = () => +S().speed || 1;
// Saving. Every save carries a revision number, so a phone and a laptop can't overwrite each other:
// if another device saved first, its changes are merged into this page's copy and the save is retried.
let saveTimer = null, saving = false, saveAgain = false, base = null; // base = last copy known to match the saved one
const clone = o => JSON.parse(JSON.stringify(o));
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}
async function flushSave() {
  saveTimer = null;
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    const sent = clone(state.data);
    const r = await Store.putData(sent);
    if (r.conflict) { mergeServer(r.data); saveAgain = true; }
    else { base = sent; base.rev = state.data.rev = r.rev; }
  } catch (e) { console.error(e); toast('Could not save. Check your internet connection.'); }
  finally {
    saving = false;
    if (saveAgain) { saveAgain = false; flushSave(); }
  }
}
const progKey = v => v ? [v.watched ? 1 : 0, v.watchedSec || 0, v.seconds || 0, v.watchedAt || ''].join('|') : '';
const videoMap = d => new Map((d?.courses || []).flatMap(c => c.weeks.flatMap(w => w.videos)).map(v => [v.id, v]));
// bring in what another device saved, without undoing changes made on this page
function mergeServer(server) {
  const sv = videoMap(server), bv = videoMap(base);
  for (const v of allVideos()) {
    const o = sv.get(v.id);
    if (!o || progKey(v) !== progKey(bv.get(v.id))) continue; // changed here: keep this page's version
    for (const k of ['watched', 'watchedSec', 'seconds', 'watchedAt']) { if (o[k] === undefined) delete v[k]; else v[k] = o[k]; }
  }
  const a = state.data.activity ||= {}, sa = server.activity || {}, ba = base?.activity || {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(ba)])) {
    const d = (sa[k] || 0) - (ba[k] || 0);
    if (d) a[k] = Math.max(0, (a[k] || 0) + d);
  }
  const changed = JSON.stringify(base) !== JSON.stringify(server);
  base = clone(server);
  state.data.rev = server.rev;
  if (changed) renderSoon();
}
// pick up changes saved from another device
async function pollServer() {
  if (saveTimer || saving || !state.data) return;
  try {
    const rev = await Store.getRev();
    if (rev === state.data.rev || saveTimer || saving) return;
    const server = await Store.getData();
    if (saveTimer || saving) return;
    mergeServer(server);
  } catch { /* offline; try again later */ }
}
setInterval(() => { if (!document.hidden) pollServer(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollServer(); });
function commit() { save(); render(); }
const findCourse = id => state.data.courses.find(c => c.id === id);
function findWeek(id) { for (const c of state.data.courses) { const w = c.weeks.find(w => w.id === id); if (w) return { c, w }; } return {}; }
function findVideo(id) { for (const c of state.data.courses) for (const w of c.weeks) { const v = w.videos.find(v => v.id === id); if (v) return { c, w, v }; } return {}; }
const courseVideos = c => c.weeks.flatMap(w => w.videos);
const allVideos = () => state.data.courses.flatMap(courseVideos);

// ---- watched time (supports partly-watched videos) ----
const watchedOf = v => v.watched ? (v.seconds || 0) : Math.min(v.watchedSec || 0, v.seconds || 0);
function logActivity(deltaSec) {
  const a = state.data.activity, k = todayKey();
  a[k] = Math.max(0, (a[k] || 0) + deltaSec);
}
function setWatchedSec(v, sec) {
  const total = v.seconds || 0;
  sec = Math.max(0, total ? Math.min(sec, total) : sec);
  const before = watchedOf(v);
  v.watched = total > 0 ? sec >= total - 1 : sec > 0;
  v.watchedSec = v.watched ? total : sec;
  if (v.watched) v.watchedAt = v.watchedAt || todayKey(); else delete v.watchedAt;
  logActivity(watchedOf(v) - before);
}
const markFull = (v, on) => setWatchedSec(v, on ? (v.seconds || 1) : 0);

function stats(videos) {
  let total = 0, watched = 0, count = 0, done = 0;
  for (const v of videos) { total += v.seconds || 0; watched += watchedOf(v); count++; if (v.watched) done++; }
  return { total, watched, left: Math.max(0, total - watched), count, done, p: pct(watched, total) };
}

// ============ schedule ============
function orderedQueue() {
  const { courses } = state.data, q = [], sp = speed();
  const push = (c, w) => w.videos.forEach(v => {
    if (v.watched || !(v.seconds > 0)) return;
    const left = (v.seconds - watchedOf(v)) / sp;
    if (left > 1) q.push({ c, w, v, left, started: watchedOf(v) > 0 });
  });
  if (S().order === 'course') courses.forEach(c => c.weeks.forEach(w => push(c, w)));
  else {
    const max = Math.max(0, ...courses.map(c => c.weeks.length));
    for (let i = 0; i < max; i++) courses.forEach(c => c.weeks[i] && push(c, c.weeks[i]));
  }
  return q;
}
const watchedTodaySec = () => (state.data.activity[todayKey()] || 0) / speed();

function buildPlan(minutesPerDay = +S().minutesPerDay) {
  const budget = minutesPerDay * 60, studyDays = S().studyDays;
  const q = orderedQueue();
  const res = { days: [], weekDone: {}, courseDone: {}, remaining: q.reduce((a, x) => a + x.left, 0), finishKey: null };
  if (!q.length) return res;
  if (budget <= 0 || !studyDays.length) { res.impossible = true; return res; }
  const tk = todayKey(), watchedToday = watchedTodaySec();
  let d = parseKey(S().startDate > tk ? S().startDate : tk);
  let i = 0;
  for (let guard = 0; i < q.length && guard < 3660; guard++, d = addDays(d, 1)) {
    if (!studyDays.includes(d.getDay())) continue;
    const k = dateKey(d);
    let cap = budget - (k === tk ? watchedToday : 0);
    const day = { key: k, items: [], total: 0 };
    while (cap > 1 && i < q.length) {
      const x = q[i];
      const take = Math.min(cap, x.left);
      day.items.push({ c: x.c, w: x.w, v: x.v, sec: take, part: take < x.left - 1 || x.started });
      x.left -= take; cap -= take; day.total += take; x.started = true;
      if (x.left <= 1) { res.weekDone[x.w.id] = k; res.courseDone[x.c.id] = k; i++; }
    }
    if (day.items.length) res.days.push(day);
  }
  res.finishKey = i >= q.length ? res.days.at(-1)?.key : null;
  return res;
}

// ============ render ============
const CHEV = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MINUTE_OPTS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
const DAY_PRESETS = { weekdays: [1, 2, 3, 4, 5], everyday: [0, 1, 2, 3, 4, 5, 6], monsat: [1, 2, 3, 4, 5, 6], weekends: [0, 6] };
const PRESET_LABEL = { weekdays: 'Mon–Fri', everyday: 'Every day', monsat: 'Mon–Sat', weekends: 'Weekends', custom: 'Custom days…' };
function presetOf(days) {
  const k = [...days].sort().join();
  return Object.keys(DAY_PRESETS).find(p => DAY_PRESETS[p].join() === k) || 'custom';
}
const daysLabel = days => presetOf(days) === 'custom' ? [...days].sort().map(i => DAYS[i]).join(', ') : PRESET_LABEL[presetOf(days)];

// ---- theme ----
const THEME_ICON = {
  light: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const getTheme = () => document.documentElement.dataset.theme || 'light';
const effectiveTheme = () => getTheme() === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : getTheme();
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('cp-theme', t); } catch { /* ignore */ }
  updateThemeBtn();
}
function updateThemeBtn() {
  const b = $('#themeBtn');
  if (!b) return;
  const eff = effectiveTheme();
  b.innerHTML = THEME_ICON[eff];
  b.title = eff === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

// ---- progress ring ("pie") ----
function ring(p, size = 40, { label = true, color } = {}) {
  const sw = Math.max(3, Math.round(size / 8.5));
  const r = (size - sw) / 2, cx = size / 2, C = 2 * Math.PI * r;
  const done = p >= 100;
  const off = C * (1 - Math.min(100, p) / 100);
  return `<span class="ring ${done ? 'complete' : ''}" style="width:${size}px;height:${size}px;${color ? `--c:${color}` : ''}" role="img" aria-label="${p}% watched">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="ring-track" cx="${cx}" cy="${cx}" r="${r}" stroke-width="${sw}"/>
      ${p > 0 ? `<circle class="ring-fill" cx="${cx}" cy="${cx}" r="${r}" stroke-width="${sw}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>` : ''}
    </svg>
    ${label ? `<span class="ring-label" style="font-size:${Math.max(10, Math.round(size * (done ? 0.36 : 0.26)))}px">${done ? '✓' : `${p}<small>%</small>`}</span>` : ''}
  </span>`;
}
const kpi = (k, v, s = '', cls = '') => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const summary = (p, kpis, color) => `<div class="summary">${ring(p, 104, { color })}<div class="kpis">${kpis.join('')}</div></div>`;

function getSel() {
  if (state.sel === undefined) { try { state.sel = localStorage.getItem('cp-sel') || 'all'; } catch { state.sel = 'all'; } }
  if (state.sel !== 'all' && !findCourse(state.sel)) state.sel = 'all';
  return state.sel;
}
function select(id) {
  state.sel = id;
  try { localStorage.setItem('cp-sel', id); } catch { /* ignore */ }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  const plan = buildPlan();
  getSel();
  updateThemeBtn();
  renderPace(plan);
  renderPicker(plan);
  renderMain(plan);
  $$('input[data-partial]').forEach(i => { i.indeterminate = true; });
  if (setDlg.open) renderSettings();
  checkCompletions();
}

// ---- after a lecture or a week is finished: remind to send salawat and make du'a ----
let doneSnap = null, weekSnap = null;
const weekComplete = w => w.videos.length > 0 && w.videos.every(v => v.watched);
function checkCompletions() {
  const done = new Set(allVideos().filter(v => v.watched).map(v => v.id));
  const weeks = new Map();
  for (const c of state.data.courses) for (const w of c.weeks) if (weekComplete(w)) weeks.set(w.id, { c, w });
  const firstRun = !doneSnap;
  const newVideos = firstRun ? [] : [...done].filter(id => !doneSnap.has(id));
  const newWeeks = firstRun ? [] : [...weeks.keys()].filter(id => !weekSnap.has(id)).map(id => weeks.get(id));
  doneSnap = done; weekSnap = new Set(weeks.keys());
  if (newWeeks.length) showDua('week', newWeeks[0]);
  else if (newVideos.length) showDua('lecture', { v: findVideo(newVideos[0])?.v, n: newVideos.length });
}
function showDua(kind, info) {
  let card = $('#duaCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'duaCard'; card.className = 'dua-card'; card.setAttribute('role', 'status');
    document.body.append(card);
    card.addEventListener('click', e => { if (e.target.closest('[data-dua=close]')) card.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') card.classList.remove('show'); });
  }
  if (card.parentElement !== topHost()) topHost().append(card);
  const head = kind === 'week'
    ? `${esc(info.w.title)} complete${state.data.courses.length > 1 ? ` · ${esc(info.c.name)}` : ''} — alhamdulillah`
    : info.n > 1 ? `${info.n} lectures complete — alhamdulillah` : `${esc(info.v?.title || 'Lecture')} complete — alhamdulillah`;
  const secs = kind === 'week' ? 60 : 25;
  card.innerHTML = `<div class="dua-inner">
      <div class="dua-head">${head}</div>
      <div class="dua-cols">
        <div><p>Send salawat on the Prophet ﷺ</p>
          <p class="ar" lang="ar" dir="rtl">اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ</p></div>
        <div><p>Ask Allah to make this ilm beneficial</p>
          <p class="ar" lang="ar" dir="rtl">اللَّهُمَّ انْفَعْنِي بِمَا عَلَّمْتَنِي، وَعَلِّمْنِي مَا يَنْفَعُنِي، وَزِدْنِي عِلْمًا</p>
          <p class="dua-tr">“O Allah, benefit me with what You have taught me, teach me what will benefit me, and increase me in knowledge.”</p></div>
      </div>
    </div>
    <button class="dua-x" data-dua="close" aria-label="Close" style="--secs:${secs}s">
      <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="ring" cx="22" cy="22" r="20"/><path d="M15 15l14 14M29 15L15 29"/></svg>
    </button>`;
  card.style.top = Math.max(0, $('.topbar')?.getBoundingClientRect().bottom || 0) + 'px';  // sit right under the header
  card.classList.toggle('week', kind === 'week');
  card.classList.remove('show'); void card.offsetWidth;  // restart the animations
  card.classList.add('show');
  clearTimeout(showDua.t);
  showDua.t = setTimeout(() => card.classList.remove('show'), secs * 1000);
}

// ---- the one-line pace bar ----
function renderPace(plan) {
  const s = S(), cur = +s.minutesPerDay;
  const mins = [...new Set([...MINUTE_OPTS, cur])].sort((a, b) => a - b);
  const preset = presetOf(s.studyDays);
  const sel = state.sel !== 'all' ? findCourse(state.sel) : null;
  const selSt = sel ? stats(courseVideos(sel)) : null;
  let result;
  if (!allVideos().length) result = '<span class="sub">Add a course to see your finish date</span>';
  else if (!plan.remaining) result = '<span class="ok">All lectures watched 🎉</span>';
  else if (plan.impossible) result = '<span class="sub">Choose at least one study day</span>';
  else if (sel && selSt.count && !selSt.left) result = `<span class="ok">${esc(sel.name)} is complete ✓</span> <span class="sep">|</span> <span class="sub">all courses by ${niceDate(plan.finishKey, true)}</span>`;
  else {
    const fin = sel ? plan.courseDone[sel.id] : plan.finishKey;
    result = fin
      ? `Finish ${sel ? `<b>${esc(sel.name)}</b>` : 'all courses'} by <b class="date">${niceDate(fin, true)}</b>
         <span class="sep">|</span><span class="sub">${sel ? `${fmt(selSt.left / speed())} left` : `${plan.days.length} study days · ${fmt(plan.remaining)} left`}${speed() !== 1 ? ` at ${speed()}×` : ''}${sel ? ` · all courses by ${niceDate(plan.finishKey, true)}` : ''}</span>`
      : `<span class="sub">${sel ? 'Add videos with lengths to this course to see its finish date' : '—'}</span>`;
  }
  $('#pace').innerHTML = `<div class="pace-inner">
    <span class="pace-label">Pace</span>
    <select class="pill-select" data-set="minutesPerDay" aria-label="Time per day">
      ${mins.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${fmt(m * 60)} a day</option>`).join('')}</select>
    <select class="pill-select" data-act="days-preset" aria-label="Study days">
      ${Object.keys(PRESET_LABEL).map(k => `<option value="${k}" ${preset === k ? 'selected' : ''}>${k === 'custom' && preset === 'custom' ? esc(daysLabel(s.studyDays)) : PRESET_LABEL[k]}</option>`).join('')}</select>
    <span class="arrow">→</span>
    <span class="pace-result">${result}</span>
  </div>`;
}

// ---- course selector ----
function renderPicker(plan) {
  const el = $('#picker');
  if (!state.data.courses.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const all = stats(allVideos());
  const tile = (id, name, color, st, sub) => `<button class="tile ${state.sel === id ? 'active' : ''}" data-act="select" data-id="${id}" style="--c:${color}" aria-pressed="${state.sel === id}">
      ${ring(st.p, 42)}
      <span class="tile-text"><span class="tile-name">${esc(name)}</span><span class="tile-sub">${sub}</span></span></button>`;
  el.innerHTML = tile('all', 'All courses', 'var(--accent)', all, `${state.data.courses.length} course${state.data.courses.length === 1 ? '' : 's'} · ${fmt(all.left)} left`) +
    state.data.courses.map(c => {
      const st = stats(courseVideos(c));
      const sub = !st.count ? 'No videos yet' : !st.left ? 'Completed' : `${fmt(st.left)} left${plan.courseDone[c.id] ? ' · ' + niceDate(plan.courseDone[c.id]) : ''}`;
      return tile(c.id, c.name, c.color, st, sub);
    }).join('') +
    '<button class="tile add" data-act="open-teams">+ Add course</button>';
}

// ---- main area ----
function renderMain(plan) {
  const el = $('#main');
  if (!state.data.courses.length) {
    el.innerHTML = `<div class="empty"><h2>Add your first course</h2>
      <p>Bring in a course from Teams and Usul Lecture Planner works out how many hours each week takes and when you'll finish.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="open-teams">+ Add from Teams</button>
      <button class="btn" data-act="open-add">Add manually</button></div></div>`;
    return;
  }
  const c = state.sel === 'all' ? null : findCourse(state.sel);
  el.innerHTML = (c ? focusHtml(plan, c) : todaysFocusCards(plan)) + (c ? courseHtml(c, plan) : overviewHtml(plan));
}

// ---- "Which week are you watching today?" ----
// Each course remembers which week you're watching today.
const focusOf = c => (S().focusBy ||= {})[c.id];
function todaysFocus(c) {
  const f = focusOf(c);
  const w = f?.date === todayKey() && c.weeks.find(w => w.id === f.weekId);
  return w ? { c, w } : null;
}
function setFocus(weekId) {
  const { c } = findWeek(weekId);
  if (!c) return;
  S().focusBy[c.id] = { date: todayKey(), weekId };
  delete state.focusPick[c.id];
}
state.focusPick = {}; // week picked in the dropdown but not started yet, so redraws keep it
function suggestedWeek(plan, c) {
  const last = focusOf(c) && c.weeks.find(w => w.id === focusOf(c).weekId);
  if (last && stats(last.videos).left > 0) return last.id;
  for (const d of plan.days) for (const it of d.items) if (it.c === c) return it.w.id;
  return c.weeks.find(w => stats(w.videos).left > 0)?.id || null;
}
// all-courses view: show the weeks being watched today, without asking
function todaysFocusCards(plan) {
  return state.data.courses.map(c => todaysFocus(c) ? focusHtml(plan, c) : '').join('');
}
// Date you'd finish `leftSec` of video at your daily commitment. Today counts only for what's left of
// today's minutes after what you've already watched.
function finishDateFor(leftSec) {
  const s = S(), budget = +s.minutesPerDay * 60, tk = todayKey();
  if (budget <= 0) return null;
  let rem = leftSec / speed(), d = parseKey(tk);
  for (let g = 0; g < 3660; g++, d = addDays(d, 1)) {
    const k = dateKey(d);
    if (k !== tk && !s.studyDays.includes(d.getDay())) continue;
    const cap = budget - (k === tk ? watchedTodaySec() : 0);
    if (cap <= 0) continue;
    rem -= cap;
    if (rem <= 1) return k;
  }
  return null;
}
function clockAfter(sec) {
  const t = new Date(Date.now() + sec * 1000);
  const time = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return dateKey(t) === todayKey() ? `${time} today` : `${time}, ${niceDate(dateKey(t))}`;
}

function focusHtml(plan, course) {
  const weeks = course.weeks.filter(w => w.videos.length);
  if (!weeks.length) return '';
  const f = todaysFocus(course);
  const daily = +S().minutesPerDay * 60, watchedToday = watchedTodaySec();
  if (!f) {
    const picked = weeks.some(w => w.id === state.focusPick[course.id]) ? state.focusPick[course.id] : suggestedWeek(plan, course);
    const opts = weeks.map(w => { const st = stats(w.videos); return `<option value="${w.id}" ${w.id === picked ? 'selected' : ''}>${esc(w.title)} · ${st.left ? `${fmt(st.left)} left` : 'done ✓'}</option>`; }).join('');
    return `<section class="panel panel-pad focus-ask">
      <div class="eyebrow">Today · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <h2>Which week are you watching today?</h2>
      <div class="row"><select id="focusSel" class="pill-select" data-act="focus-pick" data-id="${course.id}" aria-label="Week of ${esc(course.name)} you're watching today">${opts}</select>
      <button class="btn primary" data-act="focus-start">Start</button></div>
    </section>`;
  }
  const { c, w } = f;
  const st = stats(w.videos), complete = st.count && !st.left;
  const leftAtSpeed = st.left / speed();
  const fin = complete ? null : finishDateFor(st.left);
  let nextWeek = null;
  if (complete) { const i = c.weeks.indexOf(w); nextWeek = c.weeks.slice(i + 1).find(x => stats(x.videos).left > 0) || null; }
  const note = complete
    ? `🎉 <b>${esc(w.title)} is done.</b> ${nextWeek ? `Up next: <b>${esc(nextWeek.title)}</b> (${fmt(stats(nextWeek.videos).left)}).` : `That was the last unfinished week of ${esc(c.name)}.`}`
    : '';
  return `<section class="panel panel-pad focus" style="--c:${c.color}">
    <div class="detail-head">
      <div style="min-width:0">
        <div class="eyebrow"><span class="dot"></span>Watching today · ${esc(c.name)}</div>
        <h1>${esc(w.title)}</h1>
        <div class="meta">${fmt(watchedToday)} of today's ${fmt(daily)} watched</div>
      </div>
      <div class="row">
        ${complete && nextWeek ? `<button class="btn primary" data-act="focus-set" data-id="${nextWeek.id}">Watch ${esc(nextWeek.title)}</button>` : ''}
        <button class="btn ghost" data-act="focus-change" data-id="${c.id}">Change week</button>
      </div>
    </div>
    ${summary(st.p, [
      kpi('Watched', fmt(st.watched), `${st.done} of ${st.count} videos`),
      kpi(`Left${speed() !== 1 ? ` at ${speed()}×` : ''}`, complete ? '—' : fmt(leftAtSpeed), `of ${fmt(st.total)}`),
      kpi('Done if you keep going', complete ? 'Done ✓' : clockAfter(leftAtSpeed)),
      kpi('Done at your pace', complete ? 'Done ✓' : niceDate(fin), complete ? '' : `${fmt(daily)} a day`, 'accent'),
    ], c.color)}
    ${note ? `<p class="focus-note">${note}</p>` : ''}
    <div class="vtable"><div class="vhead"><span></span><span>Video</span><span>Minutes watched</span><span></span></div>
      ${w.videos.map(renderVideo).join('')}</div>
  </section>`;
}

function overviewHtml(plan) {
  const rows = state.data.courses.map(c => {
    const st = stats(courseVideos(c));
    return `<tr data-act="select" data-id="${c.id}" style="--c:${c.color}">
      <td><div class="cname">${ring(st.p, 34)}<span>${esc(c.name)}<small>${st.done} of ${st.count} videos</small></span></div></td>
      <td class="hide-md">${fmt(st.watched)}</td>
      <td>${st.count && st.left ? fmt(st.left) : '—'}</td>
      <td class="r">${!st.count ? '<span class="muted">No videos</span>' : !st.left ? '<span class="badge done">Done</span>' : `<b>${niceDate(plan.courseDone[c.id])}</b>`}</td>
    </tr>`;
  }).join('');
  return `<div class="stack">
    <section class="panel panel-pad">${todayHtml(plan)}</section>
    <section class="panel">
      <div class="panel-title"><h2>Courses</h2><span class="muted">Select a course to see its weeks</span></div>
      <table class="ctable"><thead><tr><th>Course</th><th class="hide-md">Watched</th><th>Left</th><th class="r">Finish by</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>
  </div>`;
}

function todayHtml(plan) {
  const tk = todayKey();
  const watched = watchedTodaySec(), daily = +S().minutesPerDay * 60;
  const today = plan.days[0]?.key === tk ? plan.days[0] : null;
  const p = pct(watched, daily), left = Math.max(0, daily - watched);
  let list;
  if (!plan.remaining) list = `<p class="muted">${allVideos().length ? 'Everything is watched. 🎉' : 'Add videos to get a daily plan.'}</p>`;
  else if (plan.impossible) list = '<p class="muted">Choose at least one study day in the pace bar.</p>';
  else if (!today) {
    const next = plan.days[0];
    list = `<p class="muted">${S().startDate > tk ? `Your plan starts <b>${niceDate(S().startDate)}</b>.` : watched >= daily - 1 ? 'Today\'s target is done ✅' : 'No study planned today.'}
      Next session: <b>${niceDate(next.key)}</b>, ${fmt(next.total)}.</p>`;
  } else {
    const groups = [];
    for (const x of today.items) {
      let g = groups.find(g => g.c === x.c); if (!g) groups.push(g = { c: x.c, weeks: [] });
      let w = g.weeks.find(w => w.w === x.w); if (!w) g.weeks.push(w = { w: x.w, items: [] });
      w.items.push(x);
    }
    list = `<div class="today-list">${groups.map(g => `<div class="today-course" style="--c:${g.c.color}">
      <div class="cname"><span class="dot"></span>${esc(g.c.name)}</div>
      ${g.weeks.map(w => `<div class="today-week"><div class="wname">${esc(w.w.title)}</div>
        ${w.items.map(x => `<div class="plan-item"><span class="t">${esc(x.v.title)}${x.part ? ' <span class="badge">continue</span>' : ''}</span><span class="d">${fmt(x.sec)}</span></div>`).join('')}
      </div>`).join('')}</div>`).join('')}</div>`;
  }
  return `<div class="today-grid">
    <div class="today-ring">
      ${ring(p, 84)}
      <div>
        <div class="eyebrow">Today's target</div>
        <div class="today-big">${fmt(watched)}<small>of ${fmt(daily)}</small></div>
        <div class="muted" style="font-size:13px">${left > 1 ? `${fmt(left)} to go` : '<span style="color:var(--good);font-weight:600">Done ✓</span>'}</div>
      </div>
    </div>
    <div><div class="eyebrow" style="margin-bottom:8px">Planned for today</div>${list}</div>
  </div>`;
}

function courseHtml(c, plan) {
  const st = stats(courseVideos(c));
  const complete = st.count && !st.left;
  const canSync = !!(c.source || teamsLinkIds(c.teamsUrl));
  state.autoOpened ??= new Set();
  if (!state.autoOpened.has(c.id)) {
    state.autoOpened.add(c.id);
    const w = c.weeks.find(w => stats(w.videos).left > 0);
    if (w) state.open.add(w.id);
  }
  const weeksLeft = c.weeks.filter(w => stats(w.videos).left > 0).length;
  const meta = [`${c.weeks.length} week${c.weeks.length === 1 ? '' : 's'}`,
    c.source?.syncedAt ? `synced ${new Date(c.source.syncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''].filter(Boolean).join(' · ');
  const head = `<section class="panel panel-pad" style="--c:${c.color}">
    <div class="detail-head">
      <div style="min-width:0">
        <div class="eyebrow"><span class="dot"></span>Course</div>
        <h1>${esc(c.name)}</h1>
        <div class="meta">${meta}</div>
      </div>
      <div class="row">
        ${canSync && st.count ? `<button class="btn" data-act="sync" data-id="${c.id}">⟳ Sync from Teams</button>` : ''}
        ${c.teamsUrl ? `<a class="btn ghost" href="${esc(c.teamsUrl)}" target="_blank" rel="noopener">Open in Teams ↗</a>` : ''}
        <details class="menu"><summary aria-label="Course options">⋯</summary><div class="menu-list">
          <button data-act="sync" data-id="${c.id}">⟳ ${c.source ? 'Sync from Teams' : 'Get videos from Teams'}</button>
          <button data-act="import" data-id="${c.id}">Add videos by hand</button>
          <button data-act="add-week" data-id="${c.id}">Add a week</button>
          <hr>
          <button data-act="rename-course" data-id="${c.id}">Rename course</button>
          <button data-act="edit-link" data-id="${c.id}">${c.teamsUrl ? 'Edit Teams link' : 'Add Teams link'}</button>
          <hr>
          <button class="danger" data-act="del-course" data-id="${c.id}">Delete course</button>
        </div></details>
      </div>
    </div>
    ${st.count ? summary(st.p, [
      kpi('Watched', fmt(st.watched), `${st.done} of ${st.count} videos`),
      kpi(`Left${speed() !== 1 ? ` at ${speed()}×` : ''}`, complete ? '—' : fmt(st.left / speed()), `of ${fmt(st.total)}`),
      kpi('Weeks left', `${weeksLeft}`, `of ${c.weeks.length}`),
      kpi('Finish by', complete ? 'Done ✓' : niceDate(plan.courseDone[c.id]), '', 'accent'),
    ], c.color) : ''}
  </section>`;

  if (!st.count) {
    return `<div class="stack">${head}<section class="panel setup">
      <h3>This course has no videos yet</h3>
      <p>Get the lecture videos and their lengths from Teams automatically, or add them by hand.</p>
      <div class="row"><button class="btn primary" data-act="sync" data-id="${c.id}">⟳ Get videos from Teams</button>
      <button class="btn" data-act="import" data-id="${c.id}">Add by hand</button></div></section></div>`;
  }
  return `<div class="stack">${head}
    <section class="panel" style="--c:${c.color}">
      <div class="panel-title"><h2>Weeks</h2><span class="muted">Open a week to log the minutes you've watched</span></div>
      ${c.weeks.map(w => renderWeek(c, w, plan)).join('')}
    </section></div>`;
}

function renderWeek(c, w, plan) {
  const st = stats(w.videos);
  const complete = st.count && !st.left;
  const missing = w.videos.filter(v => !v.seconds).length;
  const due = !complete && plan.weekDone[w.id];
  return `<details class="week" data-wid="${w.id}" ${state.open.has(w.id) ? 'open' : ''}>
    <summary>
      <span class="chev">${CHEV}</span>
      ${ring(st.p, 40)}
      <div class="week-main">
        <div class="week-top"><span class="week-name">${esc(w.title)}</span>
          ${missing ? `<span class="badge warn">${missing} need length</span>` : ''}</div>
        <div class="week-meta">${st.done} of ${st.count} videos · ${fmt(st.watched)} of ${fmt(st.total)}</div>
      </div>
      <div class="week-right">${complete ? '<b class="ok">Done</b>' : `<b>${fmt(st.left)} left</b>${due ? `<span>by ${niceDate(due)}</span>` : ''}`}</div>
    </summary>
    <div class="week-body">
      ${w.videos.length ? `<div class="vtable"><div class="vhead">
          <input type="checkbox" class="check" id="all-${w.id}" data-act="week-check" data-id="${w.id}" ${complete ? 'checked' : ''} ${!complete && st.done ? 'data-partial' : ''} aria-label="Mark all videos in ${esc(w.title)} as watched">
          <label for="all-${w.id}" class="select-all">${complete ? 'All watched' : 'Select all'}</label><span>Minutes watched</span><span></span></div>
        ${w.videos.map(renderVideo).join('')}</div>` : '<p class="note">No videos in this week yet. Add one below.</p>'}
      <div class="week-foot">
        <form class="addvideo" data-wid="${w.id}">
          <input name="title" placeholder="Add a video: title" aria-label="New video title">
          <input name="dur" placeholder="Length, e.g. 58:40" aria-label="New video length">
          <button class="btn small">Add</button>
        </form>
        <details class="menu compact"><summary aria-label="Week options">⋯</summary><div class="menu-list">
          <button data-act="rename-week" data-id="${w.id}">Rename week</button>
          <button class="danger" data-act="del-week" data-id="${w.id}">Delete week</button>
        </div></details>
      </div>
    </div>
  </details>`;
}

function renderVideo(v) {
  const watched = watchedOf(v), total = v.seconds || 0;
  const lenMin = Math.ceil(total / 60), wMin = v.watched ? lenMin : Math.floor(watched / 60);
  return `<div class="video ${v.watched ? 'watched' : ''}">
    <input type="checkbox" class="check" data-act="watch" data-id="${v.id}" ${v.watched ? 'checked' : ''} aria-label="Fully watched">
    <div class="vtitle"><span class="t" title="${esc(v.title)}">${esc(v.title)}</span>
      ${v.webUrl ? `<a href="${esc(v.webUrl)}" target="_blank" data-act="play" data-id="${v.id}" title="${v.noPlay ? 'Opens in SharePoint (downloading is blocked for this lecture)' : 'Watch in the planner. Your minutes update as you watch'}">▶ Watch${v.noPlay ? ' ↗' : ''}</a>` : ''}</div>
    <div class="wmin">${total
      ? `<input type="number" min="0" max="${lenMin}" step="1" inputmode="numeric" value="${wMin}" data-act="minutes" data-id="${v.id}" aria-label="Minutes watched of ${esc(v.title)}"><span>of ${fmt(total)}</span>`
      : `<button class="missing" data-act="edit-video" data-id="${v.id}">Set length</button>`}</div>
    <details class="menu compact"><summary aria-label="Video options">⋯</summary><div class="menu-list">
      <button data-act="edit-video" data-id="${v.id}">Edit title or length</button>
      ${watched ? `<button data-act="reset-video" data-id="${v.id}">Reset progress</button>` : ''}
      <button class="danger" data-act="del-video" data-id="${v.id}">Remove video</button>
    </div></details>
  </div>`;
}

// ---- settings dialog ----
const setDlg = $('#settingsDialog');
function renderSettings() {
  const s = S();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const who = Store.demo ? 'Demo mode: your planner is saved only in this browser.'
    : `Signed in as <b>${esc(Store.user?.email || 'you')}</b>. Your planner is saved to your account and follows you to any device.`;
  $('#setBody').innerHTML = `
    <div class="set-section">
      <h3>Account</h3>
      <p class="hint" style="margin:0 0 8px">${who}</p>
      <div class="row">
        ${Store.demo ? '' : '<button class="btn small" data-act="sign-out">Sign out</button>'}
        <button class="btn small" data-act="export-data">Download a backup</button>
        <label class="btn small">Bring in a backup or Mac planner file<input type="file" id="importData" accept=".json,application/json" hidden></label>
      </div>
    </div>
    <div class="set-section">
      <h3>Appearance</h3>
      <label class="field">Theme
        <select data-act="theme-select">
          ${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match my device']].map(([v, l]) => `<option value="${v}" ${getTheme() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
    </div>
    <div class="set-section">
      <h3>Lectures</h3>
      <label class="field">When I click ▶ Watch
        <select data-set="watchMode">
          ${[['', 'Play in the planner when possible'], ['sharepoint', 'Always open in SharePoint']].map(([v, l]) => `<option value="${v}" ${(s.watchMode === 'sharepoint' ? 'sharepoint' : '') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <p class="hint" style="margin:6px 0 0">Playing in the planner tracks exactly where you are. It needs a SharePoint tab connected with your bookmark, once per study session. Lectures Usul has blocked from downloading always open in SharePoint.</p>
    </div>
    <div class="set-section">
      <h3>Schedule</h3>
      <div class="grid2">
        <label class="field">Start date<input type="date" data-set="startDate" value="${s.startDate}"></label>
        <label class="field">Minutes per day<input type="number" min="5" step="5" data-set="minutesPerDay" value="${s.minutesPerDay}"></label>
        <label class="field">Playback speed
          <select data-set="speed">${[1, 1.25, 1.5, 1.75, 2].map(v => `<option value="${v}" ${+s.speed === v ? 'selected' : ''}>${v}×</option>`).join('')}</select></label>
        <label class="field">Order
          <select data-set="order">
            <option value="week" ${s.order === 'week' ? 'selected' : ''}>Week by week, across courses</option>
            <option value="course" ${s.order === 'course' ? 'selected' : ''}>One course at a time</option>
          </select></label>
      </div>
      <div class="field">Study days
        <div class="days">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button type="button" class="day ${s.studyDays.includes(i) ? 'on' : ''}" data-act="day" data-i="${i}" aria-pressed="${s.studyDays.includes(i)}">${DAYS[i]}</button>`).join('')}</div>
      </div>
    </div>
    <div class="set-section">
      <h3>Daily reminders</h3>
      <div class="grid2">
        <label class="field">Morning<input type="time" data-set="morningTime" value="${s.morningTime}"></label>
        <label class="field">Evening<input type="time" data-set="eveningTime" value="${s.eveningTime}"></label>
      </div>
      <div class="row">
        ${perm === 'granted' ? '<span class="badge done">Browser alerts on</span>' : '<button class="btn small" data-act="notif">Enable browser alerts</button>'}
        <button class="btn small" data-act="test-notif">Send a test</button>
      </div>
      <p class="note">Reminders appear while the planner is open in a browser tab.</p>
    </div>`;
}
setDlg.addEventListener('click', e => { if (e.target.closest('[data-set-close]')) setDlg.close(); });

// ============ reminders (in-browser) ============
function reminderText(kind) {
  const plan = buildPlan();
  const watched = watchedTodaySec(), left = Math.max(0, +S().minutesPerDay * 60 - watched);
  const today = plan.days[0]?.key === todayKey() ? plan.days[0] : null;
  const first = today?.items[0];
  const next = first ? `${first.c.name} · ${first.w.title}: ${first.v.title}` : '';
  if (!plan.remaining) return ['Usul Lecture Planner 🎉', 'Every video is watched!'];
  if (kind === 'morning') return ['Good morning! Today\'s study plan', today ? `${fmt(today.total)} to watch. Start with ${next}.` : 'No study session planned today.'];
  return left <= 1 ? ['Today\'s target done ✅', `You watched ${fmt(watched)} today.`]
    : ['Evening check-in', `${fmt(left)} left of today's target.${next ? ' Next: ' + next : ''}`];
}
function notify(kind) {
  const [title, body] = reminderText(kind);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  else toast(`${title}: ${body}`);
}
function checkReminders() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const kind of ['morning', 'evening']) {
    if (hm !== S()[kind + 'Time']) continue;
    const key = `cp-notified-${kind}-${todayKey()}`;
    try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { /* ignore */ }
    notify(kind);
  }
}

// ============ add-by-hand dialog ============
const dlg = $('#addDialog'), form = $('#addForm');
let pending = { weeks: [], tab: 'paste', target: null };

function openAdd(targetId = null) {
  form.reset();
  pending = { weeks: [], tab: 'paste', target: targetId };
  $('#addTitle').textContent = targetId ? `Add videos to ${findCourse(targetId).name}` : 'Add a course';
  $('#nameField').classList.toggle('hidden', !!targetId);
  $('#linkField').classList.toggle('hidden', !!targetId);
  $('.tab[data-tab="empty"]').classList.toggle('hidden', !!targetId);
  $('#readStatus').textContent = '';
  switchTab('paste');
  dlg.showModal();
  (targetId ? form.paste : form.courseName).focus();
}
function switchTab(tab) {
  pending.tab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tabpane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
  if (tab === 'paste') pending.weeks = parsePasted(form.paste.value);
  if (tab === 'empty') pending.weeks = [];
  renderPreview();
}
function renderPreview() {
  const el = $('#preview');
  if (pending.tab === 'empty') {
    el.innerHTML = `<p class="hint">${Math.max(0, Math.min(52, +form.weekCount.value || 0))} empty weeks will be created.</p>`;
    return;
  }
  const w = pending.weeks;
  if (!w.length) { el.innerHTML = ''; return; }
  const sum = x => x.videos.reduce((a, v) => a + v.seconds, 0);
  el.innerHTML = `<p class="hint"><b>Found ${w.length} weeks · ${w.reduce((a, x) => a + x.videos.length, 0)} videos · ${fmt(w.reduce((a, x) => a + sum(x), 0))}</b></p>` +
    w.map(x => `<div class="pw"><span>${esc(x.title)} <span style="color:var(--muted)">(${x.videos.length} videos)</span></span><b>${fmt(sum(x))}</b></div>`).join('');
}
form.addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab); });
form.courseName.addEventListener('input', () => {
  const v = form.courseName.value.trim();
  if (!isUrl(v)) return;
  form.teamsUrl.value = v;
  form.courseName.value = '';
  toast('Link moved to the Teams link field. Now type the course name.');
});
form.paste.addEventListener('input', () => { pending.weeks = parsePasted(form.paste.value); renderPreview(); });
form.weekCount.addEventListener('input', renderPreview);
for (const input of [form.folder, form.files]) {
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    $('#saveCourse').disabled = true;
    const status = $('#readStatus');
    pending.weeks = await weeksFromFiles(input.files, (n, t) => { status.textContent = `Reading video lengths… ${n}/${t}`; });
    const missing = pending.weeks.flatMap(w => w.videos).filter(v => !v.seconds).length;
    status.textContent = pending.weeks.length ? `Done.${missing ? ` ${missing} file(s) couldn't be read; set their length after saving.` : ''}` : 'No video files found.';
    if (!form.courseName.value && input === form.folder && input.files[0]?.webkitRelativePath) form.courseName.value = input.files[0].webkitRelativePath.split('/')[0];
    $('#saveCourse').disabled = false;
    renderPreview();
  });
}
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  let weeks = pending.weeks;
  if (pending.tab === 'empty') {
    const n = Math.max(0, Math.min(52, +form.weekCount.value || 0));
    weeks = Array.from({ length: n }, (_, i) => ({ id: uid(), title: `Week ${i + 1}`, videos: [] }));
  }
  if (pending.target) {
    const c = findCourse(pending.target);
    if (!weeks.length) return;
    for (const w of weeks) {
      const same = c.weeks.find(x => x.title.toLowerCase() === w.title.toLowerCase());
      same ? same.videos.push(...w.videos) : c.weeks.push(w);
    }
    toast(`Added ${weeks.length} week(s) to ${c.name}`);
  } else {
    let name = form.courseName.value.trim(), teamsUrl = form.teamsUrl.value.trim();
    if (isUrl(name)) { teamsUrl = teamsUrl || name; name = ''; }
    name = name || (teamsUrl ? 'Teams course' : `Course ${state.data.courses.length + 1}`);
    state.data.courses.push({ id: uid(), name, color: PALETTE[state.data.courses.length % PALETTE.length], weeks, teamsUrl: isUrl(teamsUrl) ? teamsUrl : '' });
    toast(`Added ${name}`);
  }
  commit();
});

// ============ Teams sync ============
function teamsLinkIds(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const g = u.searchParams.get('groupId');
    return g ? { groupId: g, tenantId: u.searchParams.get('tenantId') || '' } : null;
  } catch { return null; }
}
const niceTitle = name => name.replace(/\.[^.]+$/, '').replace(/[-_ ]*Meeting Recording$/i, '').replace(/_+/g, ' ').trim() || name;
const weekFolder = folder => (folder || '').split('/').reverse().find(s => WEEK_RE.test(s));

function groupVideos(videos, mode) {
  if (mode === 'auto') mode = videos.some(v => weekFolder(v.folder)) ? 'folder' : 'date';
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const groups = new Map();
  const add = (title, v, order) => { if (!groups.has(title)) groups.set(title, { title, order, videos: [] }); groups.get(title).videos.push(v); };
  if (mode === 'date') {
    const monday = s => { const x = new Date(s); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
    const dates = videos.map(v => v.created).filter(Boolean).sort();
    const first = dates.length ? monday(dates[0]) : null;
    for (const v of videos) {
      if (!v.created) { add('Undated', v, 1e9); continue; }
      const m = monday(v.created), n = Math.round((m - first) / 6048e5) + 1;
      add(`Week ${n} · ${m.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, v, n);
    }
  } else if (mode === 'channel') {
    for (const v of videos) add((v.folder || '').split('/')[0] || 'General', v, 0);
  } else {
    for (const v of videos) { const w = weekFolder(v.folder); add(w || v.folder || 'Other', v, w ? 0 : 1); }
  }
  const byDate = (a, b) => (a.created || '').localeCompare(b.created || '') || coll.compare(a.name, b.name);
  const list = [...groups.values()].sort((a, b) => a.order - b.order || coll.compare(a.title, b.title));
  list.forEach(g => g.videos.sort(byDate));
  return list;
}

// Build course weeks from a scan, keeping progress, edited titles and hand-added videos.
function weeksFromScan(groups, excluded, oldCourse) {
  const old = new Map();
  oldCourse?.weeks.forEach(w => w.videos.forEach(v => v.itemId && old.set(v.itemId, v)));
  const weeks = groups.filter(g => !excluded.has(g.title)).map(g => {
    const ow = oldCourse?.weeks.find(w => w.title === g.title);
    return {
      id: ow?.id || uid(), title: g.title,
      videos: g.videos.map(sv => {
        const o = old.get(sv.itemId);
        const v = { id: o?.id || uid(), title: o?.title || niceTitle(sv.name), seconds: sv.seconds || o?.seconds || 0,
          watched: !!o?.watched, itemId: sv.itemId, driveId: sv.driveId || o?.driveId || '', webUrl: sv.webUrl, created: sv.created };
        if (o?.noPlay && !sv.driveId) v.noPlay = true;
        if (o?.watchedSec) v.watchedSec = o.watchedSec;
        if (o?.watchedAt) v.watchedAt = o.watchedAt;
        return v;
      }),
    };
  });
  for (const w of oldCourse?.weeks || []) {
    const manual = w.videos.filter(v => !v.itemId);
    if (!manual.length) continue;
    const t = weeks.find(x => x.title === w.title);
    t ? t.videos.push(...manual) : weeks.push({ id: w.id, title: w.title, videos: manual });
  }
  return weeks;
}

let BOOKMARKLET = '';
const APP_URL = location.origin + location.pathname;
fetch('helper.js').then(r => r.ok ? r.text() : '').then(code => {
  if (code) BOOKMARKLET = 'javascript:' + encodeURIComponent(code.replace('__APP_URL__', APP_URL) + '\n;void 0');
  if (['quick', 'waiting', 'first'].includes(td?.step)) renderTd();
}).catch(() => {});

// Open the team's files in SharePoint in a new tab. The bookmark clicked there sends the details back here.
let pendingCourseId = null;
function openSharePoint() {
  pendingCourseId = td.courseId;
  const url = `${S().spHost}/_layouts/15/groupstatus.aspx?id=${encodeURIComponent(td.groupId)}&target=documents`;
  const w = window.open(url, 'coursepace-sharepoint');
  td.step = 'waiting'; td.blocked = !w;
  renderTd();
}

// Course details arriving from the bookmark (or from a saved file).
function receiveScan(d, origin) {
  if (origin) { S().spHost = origin; }
  S().helperUsed = true;
  save();
  const byGroup = c => d.groupId && (c.source?.groupId === d.groupId || teamsLinkIds(c.teamsUrl)?.groupId === d.groupId);
  const c = (td?.courseId && tdDlg.open && findCourse(td.courseId)) || (pendingCourseId && findCourse(pendingCourseId))
    || state.data.courses.find(c => byGroup(c) || (c.source?.siteUrl && c.source.siteUrl === d.site)) || null;
  pendingCourseId = null;
  td = { courseId: c?.id || null, method: 'helper', step: 'preview', videos: d.videos, teamName: d.siteName, siteUrl: d.site,
    groupId: d.groupId || td?.groupId || '', tenantId: '', teamsUrl: c?.teamsUrl || td?.teamsUrl || '',
    name: c && !/^Teams course/.test(c.name) ? c.name : d.siteName, groupBy: c?.source?.groupBy || 'auto',
    excluded: new Set(c?.source?.excluded || []), teams: null, scanInfo: d.scanInfo || null };
  $('#tdTitle').textContent = c ? `Update ${td.name}` : 'Add course';
  td.oldBookmark = !d.scanInfo;
  renderTd();
  if (!tdDlg.open) tdDlg.showModal();
  window.focus();
}
// ---- watching: the bookmark reports the player's position from the video tab ----
const END_GRACE = 40; // this close to the end (seconds) counts as fully watched
let watching = null; // { id, at } the video last opened from here
const progressPages = new Map(); // video page → video id, once matched

function openVideoTab(v) {
  watching = { id: v.id, at: Date.now() };
  const w = window.open(v.webUrl, '_blank'); // keep window.opener so the bookmark can report back
  if (!w) toast('Your browser blocked the new tab. Allow pop-ups for this page.');
  return w;
}
// ▶ Watch. Lectures that SharePoint lets students download play right here, so the planner sees exactly
// where you are. Lectures Usul has blocked from downloading open in SharePoint's own player instead.
function playVideo(id) {
  const { v } = findVideo(id);
  if (!v?.webUrl) return;
  if (v.noPlay || S().watchMode === 'sharepoint') return openVideoTab(v);
  openPlayer(v);
}

// The same rule everywhere: keep the furthest point; the last END_GRACE seconds count as watched.
function applyPosition(v, pos, dur, ended) {
  if (!(v.seconds > 0) && dur) v.seconds = Math.round(dur);
  if (v.watched) return false;
  const total = v.seconds || 0;
  if (ended || (total && total - pos <= END_GRACE) || (dur && dur - pos <= END_GRACE)) { markFull(v, true); return 'done'; }
  if (pos > watchedOf(v) + 1) { setWatchedSec(v, pos); return true; }
  return false;
}

// ---- the SharePoint connection ----
// The bookmark, clicked in a SharePoint tab the planner opened, asks SharePoint (with the student's own
// sign-in) for a short-lived link to each lecture and hands it to the player. Nothing goes through our servers.
let bridge = null, bridgeOrigin = '';
const linkWaits = new Map(); // video id → resolve
const siteOf = url => (String(url).match(/^https:\/\/[^/]+\/(sites|teams)\/[^/?#]+/i) || [String(url).replace(/^(https:\/\/[^/]+).*$/, '$1')])[0];
function connectSharePoint() {
  const v = playing?.v;
  if (!v) return;
  const w = window.open(siteOf(v.webUrl), 'usul-bridge');
  if (!w) toast('Your browser blocked the new tab. Allow pop-ups for this page.');
}
function bridgeConnected(e) {
  const fresh = !bridge;
  bridge = e.source; bridgeOrigin = e.origin;
  try { bridge.postMessage({ app: 'coursepace', type: 'bridge-ack' }, bridgeOrigin); } catch { /* closed */ }
  S().bridgeUsed || (S().bridgeUsed = true, save());
  if (fresh) toast('Connected to SharePoint');
  if (playing && playing.status === 'connect') loadPlayer();
  window.focus();
}
function askLink(v) {
  return new Promise(resolve => {
    const done = r => { if (linkWaits.get(v.id) === done) { linkWaits.delete(v.id); resolve(r); } };
    linkWaits.set(v.id, done);
    try { bridge.postMessage({ app: 'coursepace', type: 'get-link', id: v.id, webUrl: v.webUrl, itemId: v.itemId || '', driveId: v.driveId || '' }, bridgeOrigin); }
    catch { return done({ error: 'disconnected' }); }
    setTimeout(() => done({ error: 'timeout' }), 20000);
  });
}
function receiveLink(d) { linkWaits.get(d.id)?.(d); }

// ---- the player ----
const playDlg = $('#playerDialog'), vid = $('#playerVideo');
let playing = null; // { v, status, retries, lastSaved }
function openPlayer(v) {
  playing = { v, status: '', retries: 0, lastSaved: Date.now() };
  $('#playerTitle').textContent = v.title;
  $('#playerInfo').textContent = '';
  vid.removeAttribute('src'); vid.load();
  playDlg.showModal();
  loadPlayer();
}
async function loadPlayer(at) {
  const p = playing;
  if (!p) return;
  if (!bridge) return playerStatus('connect');
  playerStatus('loading');
  const r = await askLink(p.v);
  if (playing !== p) return;
  if (r.error === 'disconnected' || r.error === 'timeout') { bridge = null; return playerStatus('connect'); }
  if (r.status === 401 || r.status === 403) { p.v.noPlay = true; save(); render(); return playerStatus('blocked'); }
  if (!r.url) return playerStatus('error', r.error);
  if (r.driveId && !p.v.driveId) { p.v.driveId = r.driveId; save(); }
  const start = at ?? (p.v.watched ? 0 : watchedOf(p.v));
  vid.addEventListener('loadedmetadata', () => {
    if (start > 5 && start < vid.duration - 5) vid.currentTime = start;
    vid.playbackRate = speed();
  }, { once: true });
  vid.src = r.url;
  vid.play().catch(() => { /* the person presses play */ });
  playerStatus('ready');
}
function playerStatus(kind, msg = '') {
  if (!playing) return;
  playing.status = kind;
  const box = $('#playerMsg'), v = playing.v;
  vid.hidden = kind !== 'ready';
  box.hidden = kind === 'ready';
  const sp = `<button class="btn" data-p="sharepoint">Open in SharePoint instead</button>`;
  if (kind === 'connect') box.innerHTML = `
    <p><b>Connect to SharePoint</b> (once per study session) so the lecture can play here:</p>
    <ol class="steps">
      <li><button class="btn primary small" data-p="connect">Open SharePoint</button></li>
      <li>In that tab, click your <b>Usul Lecture Planner</b> bookmark.</li>
      <li>Come back here. The lecture starts by itself. Keep the SharePoint tab open while you study.</li>
    </ol>
    ${S().helperUsed || S().bridgeUsed ? '' : `<div class="callout">No bookmark yet? Drag this onto your bookmarks bar first (press ⌘ ⇧ B or Ctrl ⇧ B if the bar is hidden):<div style="margin-top:8px">${bookmarkBtn()}</div></div>`}
    <div class="row end" style="margin-top:12px">${sp}</div>`;
  else if (kind === 'loading') box.innerHTML = '<div class="spinner"></div><p style="text-align:center">Getting the lecture from SharePoint…</p>';
  else if (kind === 'blocked') box.innerHTML = `
    <p><b>This lecture can only play in SharePoint.</b> Usul has turned off downloading for it, so the planner can't play it here.</p>
    <p class="hint">In SharePoint, click your bookmark on the video page to track your minutes, or type them in the planner afterwards.</p>
    <div class="row end"><button class="btn primary" data-p="sharepoint">Open in SharePoint</button></div>`;
  else if (kind === 'error') box.innerHTML = `
    <p><b>The lecture didn't load.</b></p><p class="hint">${esc(String(msg).slice(0, 200))}</p>
    <div class="row end"><button class="btn" data-p="retry">Try again</button>${sp}</div>`;
}
function trackPlayer(force) {
  const p = playing;
  if (!p || !(vid.duration > 0)) return;
  const pos = vid.currentTime, dur = vid.duration, left = Math.max(0, dur - pos);
  $('#playerInfo').textContent = `${fmtClock(pos)} of ${fmtClock(dur)} · ${Math.ceil(left / 60)} min left${vid.paused ? ' · paused' : ''}`;
  const r = applyPosition(p.v, pos, dur, vid.ended);
  if (r === 'done') { toast(`✓ “${p.v.title}” marked as watched`); force = true; }
  if (r || force) {
    if (force || Date.now() - p.lastSaved > 20000) { p.lastSaved = Date.now(); save(); renderSoon(); }
  }
}
let trackTick = 0;
vid?.addEventListener('timeupdate', () => { if (Date.now() - trackTick > 4000) { trackTick = Date.now(); trackPlayer(false); } });
for (const ev of ['pause', 'seeked', 'ended']) vid?.addEventListener(ev, () => trackPlayer(true));
vid?.addEventListener('playing', () => { if (playing) playing.retries = 0; });
// SharePoint's links expire after a while: fetch a fresh one and carry on from the same point
vid?.addEventListener('error', () => {
  const p = playing;
  if (!p || p.status !== 'ready') return;
  if (p.retries++ < 2) return loadPlayer(vid.currentTime || watchedOf(p.v));
  playerStatus('error', 'The browser could not play this file.');
});
function closePlayer() {
  if (playing) { trackPlayer(true); }
  vid.pause(); vid.removeAttribute('src'); vid.load();
  playing = null;
  render();
}
playDlg?.addEventListener('close', closePlayer);
playDlg?.addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const act = b.dataset.p;
  if (act === 'close') playDlg.close();
  else if (act === 'connect') connectSharePoint();
  else if (act === 'retry') loadPlayer();
  else if (act === 'sharepoint') { const v = playing?.v; playDlg.close(); if (v) openVideoTab(v); }
});
$('#playerSpeed')?.addEventListener('change', e => { vid.playbackRate = +e.target.value || 1; });
vid?.addEventListener('ratechange', () => { const sel = $('#playerSpeed'); if (sel) sel.value = String(vid.playbackRate); });

// ---- account: sign-in screen, backups ----
function showSignIn() {
  document.body.classList.add('signed-out');
  const box = $('#signin');
  box.hidden = false;
  $('#msBtn').hidden = !Store.microsoft;
  $('#msOr').hidden = !Store.microsoft;
  $('#msBtn').onclick = async () => {
    try { await Store.microsoftSignIn(); } catch (e) { $('#signinMsg').textContent = e.message || 'Microsoft sign-in did not start.'; }
  };
  $('#emailForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#signinEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $('#signinMsg').textContent = 'Type your email address.'; return; }
    const btn = $('#emailBtn'); btn.disabled = true;
    $('#signinMsg').textContent = 'Sending…';
    try { await Store.emailLink(email); $('#signinMsg').innerHTML = `Check your inbox at <b>${esc(email)}</b> and click the link to sign in. You can close this tab.`; }
    catch (err) { $('#signinMsg').textContent = err.message || 'Could not send the email. Try again in a minute.'; btn.disabled = false; }
  };
}
function fatal(msg) {
  document.body.classList.add('signed-out');
  const box = $('#signin');
  box.hidden = false;
  box.querySelector('.signin-card').innerHTML = `<p>${esc(msg)}</p>`;
}
function exportData() {
  const d = clone(state.data); delete d.rev;
  const blob = new Blob([JSON.stringify({ app: 'usul-lecture-planner', version: 1, savedAt: new Date().toISOString(), ...d }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `usul-planner-backup-${todayKey()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { return toast('That file isn\'t a planner backup.'); }
  if (!Array.isArray(j?.courses)) return toast('That file isn\'t a planner backup.');
  const n = j.courses.length;
  if (state.data.courses.length && !confirm(`Replace your planner with the ${n} course${n === 1 ? '' : 's'} in this file?`)) return;
  state.data.courses = j.courses;
  state.data.settings = { ...state.data.settings, ...(j.settings || {}) };
  for (const k of ['trackerUsed', 'trackerSeen', 'trackIds', 'safariOk', 'helperUsed', 'bridgeUsed']) delete state.data.settings[k]; // the website needs its own bookmark
  if (state.data.settings.watchMode && state.data.settings.watchMode !== 'sharepoint') delete state.data.settings.watchMode;
  state.data.activity = j.activity || {};
  state.sel = 'all';
  setDlg.close();
  toast(`Brought in ${n} course${n === 1 ? '' : 's'}`);
  commit();
}
setDlg.addEventListener('change', e => { if (e.target.id === 'importData' && e.target.files[0]) importData(e.target.files[0]); });

const normPath = s => { s = String(s || ''); try { s = decodeURI(s); } catch { /* keep */ } return s.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase(); };
const fileOf = s => normPath(s).split('/').pop();
function matchProgress(d) {
  const known = progressPages.get(d.page);
  if (known) { const { v } = findVideo(known); if (v) return v; }
  const vids = allVideos().filter(v => v.webUrl);
  const path = normPath(d.path), file = fileOf(d.path || d.name);
  const near = v => !(v.seconds > 0) || !(d.duration > 0) || Math.abs(v.seconds - d.duration) <= Math.max(30, d.duration * .05);
  let v = path && vids.find(v => normPath(v.webUrl) === path);
  if (!v && file) {
    const same = vids.filter(v => fileOf(v.webUrl) === file);
    v = same.length === 1 ? same[0] : same.find(near);
  }
  // fall back to the video just opened from here, if its length fits
  if (!v && watching && Date.now() - watching.at < 12 * 3600e3) { const o = findVideo(watching.id).v; if (o && near(o)) v = o; }
  if (v) progressPages.set(d.page, v.id);
  return v || null;
}
let renderPending = false;
function renderSoon() {
  if (document.activeElement?.matches?.('input, select, textarea') && !document.hidden) { renderPending = true; return; }
  render();
}
document.addEventListener('focusout', () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });
function receiveProgress(d, e) {
  const v = matchProgress(d);
  if (v) {
    const dur = d.duration > 0 && isFinite(d.duration) ? d.duration : 0;
    const r = applyPosition(v, Math.max(0, +d.position || 0), dur, d.ended);
    if (r) { save(); renderSoon(); }
    if (r === 'done') toast(`✓ “${v.title}” marked as watched`);
  }
  try {
    e.source?.postMessage({ type: 'coursepace-progress-ack', title: v?.title || '', watched: v ? watchedOf(v) : 0,
      total: v?.seconds || 0, done: !!v?.watched, grace: END_GRACE }, e.origin);
  } catch { /* tab gone */ }
}

let lastScanAt = null;
function listenForHelper() {
  window.name = 'coursepace';
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || d.app !== 'coursepace') return;
    if (!/^https:\/\/[\w.-]+\.sharepoint\.(com|us|de|cn)$/i.test(e.origin)) return;
    if (d.type === 'progress') return receiveProgress(d, e);
    if (d.type === 'bridge') return bridgeConnected(e);
    if (d.type === 'link') return receiveLink(d);
    if (!Array.isArray(d.videos)) return;
    try { e.source?.postMessage({ type: 'coursepace-ack' }, e.origin); } catch { /* ignore */ }
    if (d.scannedAt === lastScanAt) return;
    lastScanAt = d.scannedAt;
    receiveScan(d, e.origin);
  });
  if (/^#(from-teams|watching|bridge)$/.test(location.hash)) history.replaceState(null, '', location.pathname);
  window.addEventListener('hashchange', () => { if (/^#(from-teams|watching|bridge)$/.test(location.hash)) history.replaceState(null, '', location.pathname); });
}

const tdDlg = $('#teamsDialog');
let td = null, tdPoll = null;

async function openTeams(courseId = null) {
  const c = courseId ? findCourse(courseId) : null;
  const ids = c ? (c.source?.groupId ? c.source : teamsLinkIds(c.teamsUrl)) : null;
  td = { courseId, step: 'loading', groupId: ids?.groupId || '', tenantId: ids?.tenantId || '', teamsUrl: c?.teamsUrl || '',
    name: c?.name || '', groupBy: c?.source?.groupBy || 'auto', excluded: new Set(c?.source?.excluded || []), videos: [], teams: null,
    method: 'helper' };
  $('#tdTitle').textContent = c ? (c.source ? `Sync ${c.name}` : `Get details for ${c.name}`) : 'Add a course from Teams';
  tdDlg.showModal();
  // known team + known school SharePoint address: go straight there (one click)
  if (td.groupId && S().spHost) return openSharePoint();
  td.step = 'quick';
  renderTd();
}
async function loadHelperFile(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { return toast('That isn\'t a Usul Lecture Planner file.'); }
  if (j?.app !== 'coursepace' || !Array.isArray(j.videos)) return toast('That isn\'t a Usul Lecture Planner file. Use the coursepace-….json file the helper saved.');
  let origin = null;
  try { origin = new URL(j.site).origin; } catch { /* ignore */ }
  receiveScan(j, origin);
}

function saveTd() {
  const groups = groupVideos(td.videos, td.groupBy);
  const common = { groupBy: td.groupBy, excluded: [...td.excluded], syncedAt: new Date().toISOString() };
  const source = td.method === 'helper'
    ? { type: 'helper', siteUrl: td.siteUrl, groupId: td.groupId, ...common }
    : { type: 'teams', groupId: td.groupId, tenantId: td.tenantId, ...common };
  const name = (td.name || '').trim();
  if (td.courseId) {
    const c = findCourse(td.courseId);
    c.weeks = weeksFromScan(groups, td.excluded, c);
    c.source = source;
    if (name) c.name = name;
    if (!c.teamsUrl && td.teamsUrl) c.teamsUrl = td.teamsUrl;
    toast(`Updated ${c.name}`);
  } else {
    const n = name || td.teamName || 'Teams course';
    state.data.courses.push({ id: uid(), name: n, color: PALETTE[state.data.courses.length % PALETTE.length],
      teamsUrl: td.teamsUrl, source, weeks: weeksFromScan(groups, td.excluded, null) });
    toast(`Added ${n}`);
  }
  tdDlg.close();
  commit();
}

const bookmarkBtn = () => `<a class="btn primary small bookmarklet" href="${BOOKMARKLET || '#'}" data-bm title="Drag me to your bookmarks bar">
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/></svg>Usul Lecture Planner</a>`;

function renderTd() {
  const t = td;
  let h = '';
  if (t.step === 'quick') {
    h = `<p>Paste the course's Teams link. Usul Lecture Planner fetches the course name and each lecture's name and length, then sorts them into weeks. It reads details only, never the videos themselves.</p>
      <label class="field">Teams link<input id="tdLink" placeholder="https://teams.microsoft.com/l/team/…" value="${esc(t.teamsUrl)}" autocomplete="off"></label>
      <p class="hint">In Teams, click <b>⋯</b> next to the team's name, then <b>Get link to team</b>.</p>
      <div class="row end"><button class="btn primary" data-td="quick-go">Get course details</button></div>`;
  } else if (t.step === 'first') {
    h = `<p><b>One-time setup, about 30 seconds.</b> After this, getting a course is one click.</p>
      <ol class="steps">
        <li>Drag this button onto your bookmarks bar (press ⌘ ⇧ B if the bar is hidden):<div style="margin-top:6px">${bookmarkBtn()}</div></li>
        <li>In Teams, open this course's team, go to the <b>Files</b> tab, and choose <b>Open in SharePoint</b>.</li>
        <li>Click the <b>Usul Lecture Planner</b> bookmark on that page. The course details appear here by themselves.</li>
      </ol>
      <p class="hint">Got a saved coursepace file instead? <label style="color:var(--accent);cursor:pointer">Choose file<input type="file" id="tdFile" accept=".json,application/json" hidden></label></p>`;
  } else if (t.step === 'waiting') {
    h = `<div class="spinner"></div>
      <p style="text-align:center">${t.blocked ? 'Your browser blocked the new tab. <a href="#" data-td="reopen">Open the course files</a>, then click' : 'The course files opened in a new tab. Click'} your <b>Usul Lecture Planner</b> bookmark there.<br>
      <span class="muted">The details will appear here automatically.</span></p>
      ${S().helperUsed && !t.showBm ? `<p class="hint" style="text-align:center">Tab didn't open? <a href="#" data-td="reopen">Open it again</a> · No bookmark? <a href="#" data-td="show-bm">Get it</a></p>`
        : `<div class="callout">Don't have the bookmark yet? Drag this onto your bookmarks bar first, then click it in the other tab:<div style="margin-top:8px">${bookmarkBtn()}</div></div>
           <p class="hint" style="text-align:center;margin-top:12px">Tab didn't open? <a href="#" data-td="reopen">Open it again</a></p>`}`;
  } else if (t.step === 'preview' && !t.videos.length) {
    h = `<p><b>No video files were found in this team's files.</b></p>
      <p class="hint">Recordings of meetings that weren't held in a channel are saved in the organiser's own OneDrive, which Usul Lecture Planner can't see. Ask your teacher where the recordings are posted, or add them by hand.</p>
      <div class="row end"><button class="btn" data-td="back">Back</button></div>`;
  } else if (t.step === 'preview') {
    const groups = groupVideos(t.videos, t.groupBy);
    const kept = groups.filter(g => !t.excluded.has(g.title));
    const sum = vs => vs.reduce((a, v) => a + v.seconds, 0);
    const total = kept.reduce((a, g) => a + sum(g.videos), 0);
    const count = kept.reduce((a, g) => a + g.videos.length, 0);
    const missing = kept.reduce((a, g) => a + g.videos.filter(v => !v.seconds).length, 0);
    h = `
      <div class="grid2">
        <label class="field">Course name<input id="tdName" value="${esc(t.name)}"></label>
        <label class="field">Group into weeks by<select id="tdGroup">
          ${[['auto', 'Automatic'], ['folder', 'Folder (Week 1, Week 2…)'], ['date', 'Recording date'], ['channel', 'Channel']]
            .map(([v, l]) => `<option value="${v}" ${t.groupBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${t.oldBookmark ? `<div class="callout" style="margin:0 0 12px"><b>Your Usul Lecture Planner bookmark is out of date</b> and may miss videos in channels and other folders.
        Delete the old bookmark, drag this new one onto your bookmarks bar, then click it again on the SharePoint page:<div style="margin-top:8px">${bookmarkBtn()}</div></div>` : ''}
      <p class="hint"><b>${kept.length} weeks · ${count} videos · ${fmt(total)}</b>${missing ? ` · ${missing} without a length (set them after saving)` : ''}. Untick anything that isn't a lecture.</p>
      ${t.scanInfo ? `<details class="hint" style="margin:0 0 10px"><summary style="cursor:pointer">Where Usul Lecture Planner looked (${t.scanInfo.places.length} ${t.scanInfo.places.length === 1 ? 'library' : 'libraries'}, ${t.scanInfo.folders} folders)</summary>
        <ul style="margin:6px 0 0;padding-left:18px">${t.scanInfo.places.map(p => `<li>${esc(p.site)} · ${esc(p.library)}: <b>${p.videos}</b> video${p.videos === 1 ? '' : 's'}</li>`).join('')}</ul>
        ${t.scanInfo.links ? `<p class="hint" style="margin:6px 0 0">${t.scanInfo.links} web link${t.scanInfo.links === 1 ? '' : 's'} (.url) were found too. Videos posted as links instead of files can't be read; add them by hand.</p>` : ''}
        ${t.scanInfo.skipped ? `<p class="hint" style="margin:6px 0 0">${t.scanInfo.skipped} place${t.scanInfo.skipped === 1 ? '' : 's'} couldn't be opened with your access and ${t.scanInfo.skipped === 1 ? 'was' : 'were'} skipped.</p>` : ''}
      </details>` : ''}
      <div class="preview">${groups.map(g => `<label class="pw" style="cursor:pointer">
        <span><input type="checkbox" data-td-week="${esc(g.title)}" ${t.excluded.has(g.title) ? '' : 'checked'}> ${esc(g.title)}
        <span style="color:var(--muted)">(${g.videos.length} videos)</span></span><b>${fmt(sum(g.videos))}</b></label>`).join('')}</div>
      <div class="row end"><button class="btn" data-td="close">Cancel</button>
        <button class="btn primary" data-td="save">${t.courseId ? 'Update course' : 'Add course'}</button></div>`;
  }
  $('#tdBody').innerHTML = h;
}

tdDlg.addEventListener('click', async e => {
  if (e.target.closest('[data-bm]')) { e.preventDefault(); return toast('Drag this button onto your bookmarks bar. Don\'t click it here.'); }
  const b = e.target.closest('[data-td]');
  if (!b) return;
  if (b.tagName === 'A') e.preventDefault();
  switch (b.dataset.td) {
    case 'close': return tdDlg.close();
    case 'save': return saveTd();
    case 'quick-go': {
      const link = $('#tdLink').value.trim();
      const ids = teamsLinkIds(link);
      if (!ids) return toast('Paste the team link from Teams (⋯ next to the team name → Get link to team).');
      td.teamsUrl = link; td.groupId = ids.groupId; td.tenantId = ids.tenantId;
      if (!td.courseId) {
        const ex = state.data.courses.find(c => (c.source?.groupId || teamsLinkIds(c.teamsUrl)?.groupId) === ids.groupId);
        if (ex) { td.courseId = ex.id; toast(`${ex.name} is already added, so it will be updated`); }
      }
      if (S().spHost) return openSharePoint();
      pendingCourseId = td.courseId;
      td.step = 'first'; return renderTd();
    }
    case 'reopen': return td.groupId && S().spHost ? openSharePoint() : (td.step = 'first', renderTd());
    case 'show-bm': td.showBm = true; return renderTd();
    case 'back': td.step = 'quick'; return renderTd();
  }
});
tdDlg.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'tdFile' && el.files[0]) loadHelperFile(el.files[0]);
  else if (el.id === 'tdGroup') { td.groupBy = el.value; td.excluded.clear(); renderTd(); }
  else if (el.dataset.tdWeek !== undefined) { el.checked ? td.excluded.delete(el.dataset.tdWeek) : td.excluded.add(el.dataset.tdWeek); renderTd(); }
});
tdDlg.addEventListener('input', e => { if (e.target.id === 'tdName') td.name = e.target.value; });
tdDlg.addEventListener('close', () => clearInterval(tdPoll));

// ============ page events ============
document.addEventListener('click', e => {
  // close any open ⋯ menu when clicking elsewhere
  for (const m of $$('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
  const a = e.target.closest('[data-act]');
  if (!a || ['watch', 'minutes', 'week-check'].includes(a.dataset.act)) return;
  a.closest('details.menu')?.removeAttribute('open');
  const act = a.dataset.act, id = a.dataset.id;
  switch (act) {
    case 'open-add': return openAdd();
    case 'open-teams': return openTeams();
    case 'sync': return openTeams(id);
    case 'import': return openAdd(id);
    case 'select': return select(id);
    case 'play': e.preventDefault(); return playVideo(id, a);
    case 'sign-out': return Store.signOut();
    case 'export-data': return exportData();
    case 'theme': setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); if (setDlg.open) renderSettings(); return;
    case 'focus-start': { const v = $('#focusSel')?.value; if (!v) return; setFocus(v); return commit(); }
    case 'focus-set': setFocus(id); return commit();
    case 'focus-change': { const f = S().focusBy?.[id]; if (f) { state.focusPick[id] = f.weekId; f.date = ''; } return commit(); }
    case 'open-settings': renderSettings(); return setDlg.showModal();
    case 'edit-link': {
      const c = findCourse(id);
      const n = prompt('Teams link for this course (leave empty to remove)', c.teamsUrl || '');
      if (n === null) return;
      if (n.trim() && !isUrl(n.trim())) return toast('That doesn\'t look like a link');
      c.teamsUrl = n.trim(); return commit();
    }
    case 'rename-course': { const c = findCourse(id); const n = prompt('Course name', c.name); if (n?.trim()) { c.name = n.trim(); commit(); } return; }
    case 'del-course': { const c = findCourse(id); if (confirm(`Delete "${c.name}" and all its progress?`)) { state.data.courses = state.data.courses.filter(x => x !== c); state.sel = 'all'; commit(); } return; }
    case 'add-week': { const c = findCourse(id); const w = { id: uid(), title: `Week ${c.weeks.length + 1}`, videos: [] }; c.weeks.push(w); state.open.add(w.id); return commit(); }
    case 'rename-week': { const { w } = findWeek(id); const n = prompt('Week name', w.title); if (n?.trim()) { w.title = n.trim(); commit(); } return; }
    case 'del-week': { const { c, w } = findWeek(id); if (confirm(`Delete "${w.title}"?`)) { c.weeks = c.weeks.filter(x => x !== w); commit(); } return; }
    case 'week-all': { const { w } = findWeek(id); const all = w.videos.every(v => v.watched); w.videos.forEach(v => markFull(v, !all)); return commit(); }
    case 'edit-video': {
      const { v } = findVideo(id);
      const t = prompt('Video title', v.title); if (t === null) return;
      const d = prompt('Length (e.g. 1:05:30, 45:00, 50 min)', v.seconds ? fmtClock(v.seconds) : ''); if (d === null) return;
      if (t.trim()) v.title = t.trim();
      const p = parseDuration(d);
      if (p.seconds) { v.seconds = p.seconds; if (v.watched) v.watchedSec = p.seconds; } else if (d.trim()) toast('Could not read that length');
      return commit();
    }
    case 'reset-video': { const { v } = findVideo(id); setWatchedSec(v, 0); return commit(); }
    case 'del-video': { const { w, v } = findVideo(id); w.videos = w.videos.filter(x => x !== v); return commit(); }
    case 'day': {
      const i = +a.dataset.i, d = S().studyDays;
      S().studyDays = d.includes(i) ? d.filter(x => x !== i) : [...d, i].sort();
      S().studyDaysChosen = true;
      return commit();
    }
    case 'notif': Notification.requestPermission().then(render); return;
    case 'test-notif': return notify(new Date().getHours() < 15 ? 'morning' : 'evening');
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'focus-pick') { state.focusPick[t.dataset.id] = t.value; return; }
  if (t.dataset.act === 'watch') { markFull(findVideo(t.dataset.id).v, t.checked); return commit(); }
  if (t.dataset.act === 'week-check') {
    const { w } = findWeek(t.dataset.id);
    w.videos.forEach(v => markFull(v, t.checked));
    toast(t.checked ? `All of ${w.title} marked as watched` : `${w.title} cleared`);
    return commit();
  }
  if (t.dataset.act === 'minutes') {
    const { v } = findVideo(t.dataset.id);
    const min = Math.max(0, parseFloat(t.value) || 0);
    setWatchedSec(v, min >= Math.ceil(v.seconds / 60) ? v.seconds : min * 60);
    return commit();
  }
  if (t.dataset.act === 'theme-select') return setTheme(t.value);
  if (t.dataset.act === 'days-preset') {
    if (t.value === 'custom') { renderPace(buildPlan()); renderSettings(); return setDlg.showModal(); }
    S().studyDays = [...DAY_PRESETS[t.value]];
    S().studyDaysChosen = true;
    return commit();
  }
  if (t.dataset.set) {
    const key = t.dataset.set;
    let val = t.value;
    if (key === 'minutesPerDay') val = Math.max(5, Math.round(+val || 60));
    if (key === 'speed') val = +val;
    if (key === 'startDate' && !val) val = todayKey();
    if ((key === 'morningTime' || key === 'eveningTime') && !val) return render();
    S()[key] = val;
    commit();
  }
});
// Enter in a "minutes watched" box saves it right away
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.act === 'minutes') e.target.blur(); });

document.addEventListener('submit', e => {
  const f = e.target.closest('.addvideo');
  if (!f) return;
  e.preventDefault();
  const { w } = findWeek(f.dataset.wid);
  const d = parseDuration(f.dur.value);
  if (!f.title.value.trim() && !d.seconds) return;
  if (f.dur.value.trim() && !d.seconds) return toast('Could not read that length. Try 45:00 or 45 min');
  w.videos.push({ id: uid(), title: f.title.value.trim() || `Video ${w.videos.length + 1}`, seconds: d.seconds, watched: false });
  commit();
  $(`.addvideo[data-wid="${w.id}"] input[name=title]`)?.focus();
});

document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d.classList?.contains('week')) return;
  d.open ? state.open.add(d.dataset.wid) : state.open.delete(d.dataset.wid);
}, true);

// ============ boot ============
(async function boot() {
  let user = null;
  try { user = await Store.init(); } catch (e) { console.error(e); return fatal('Could not reach the sign-in service. Check your internet connection, then reload the page.'); }
  if (!user) return showSignIn();
  try { state.data = await Store.getData(); base = clone(state.data); }
  catch (e) { console.error(e); return fatal('Could not load your planner. Check your internet connection, then reload the page.'); }
  document.body.classList.remove('signed-out');
  if (Store.demo) $('#demoNote').hidden = false;
  let fixed = false;
  for (const c of state.data.courses) {
    if (isUrl(c.name)) { c.teamsUrl = c.teamsUrl || c.name; c.name = 'Teams course (click ⋯ → Rename)'; fixed = true; }
  }
  if (!state.data.activity) {
    // older versions only stored which day a video was finished; turn that into daily watched time
    state.data.activity = {};
    for (const v of allVideos()) if (v.watched && v.watchedAt) state.data.activity[v.watchedAt] = (state.data.activity[v.watchedAt] || 0) + (v.seconds || 0);
    fixed = true;
  }
  // lectures are assumed to be watched Monday–Friday unless the user picks other days
  if (!S().studyDaysChosen && S().studyDays.join() !== '1,2,3,4,5') { S().studyDays = [1, 2, 3, 4, 5]; fixed = true; }
  // "watching today" used to be one week across all courses; now each course has its own
  if (S().focus) {
    const { c } = findWeek(S().focus.weekId || '');
    if (c) (S().focusBy ||= {})[c.id] = S().focus;
    delete S().focus; fixed = true;
  }
  // move courses from the old bright colours to the theme's palette
  for (const c of state.data.courses) {
    const i = OLD_PALETTE.indexOf((c.color || '').toLowerCase());
    if (i >= 0) { c.color = PALETTE[i]; fixed = true; }
  }
  if (fixed) save();
  render();
  listenForHelper();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeBtn);
  setInterval(checkReminders, 20000);
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); render(); } }, 60000);
})();
