'use strict';
// Where each student's planner is kept: one row per student in Supabase (table "planner"),
// or, with no Supabase settings in config.js, this browser's storage (demo mode).
// Every save carries a revision number, so two devices can't silently overwrite each other.
const Store = (() => {
  const cfg = window.USUL_CONFIG || {};
  const demo = !(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const DEMO_KEY = 'usul-planner-demo';
  const appUrl = () => location.origin + location.pathname;
  let sb = null, user = null;

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function normalize(raw, rev) {
    const d = raw && typeof raw === 'object' ? raw : {};
    return {
      settings: { startDate: today(), minutesPerDay: 60, speed: 1, studyDays: [1, 2, 3, 4, 5], order: 'week',
        morningTime: '08:00', eveningTime: '20:00', ...(d.settings || {}) },
      courses: Array.isArray(d.courses) ? d.courses : [],
      activity: d.activity && typeof d.activity === 'object' ? d.activity : {},
      rev: rev || 0,
    };
  }
  const strip = d => { const o = { ...d }; delete o.rev; return o; };

  async function init() {
    if (demo) { user = { id: 'demo', email: '' }; return user; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    sb.auth.onAuthStateChange((event, session) => {
      const next = session?.user || null;
      if ((next?.id || null) !== (user?.id || null)) location.replace(appUrl());
    });
    return user;
  }

  return {
    demo,
    microsoft: !demo && !!cfg.microsoftSignIn,
    get user() { return user; },
    init,
    async emailLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl() } });
      if (error) throw error;
    },
    async microsoftSignIn() {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: appUrl() } });
      if (error) throw error;
    },
    async signOut() {
      if (demo) return;
      await sb.auth.signOut();
      location.replace(appUrl());
    },
    async getData() {
      if (demo) {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { /* blocked or empty */ }
        return normalize(saved?.data, saved?.rev);
      }
      const { data, error } = await sb.from('planner').select('data, rev').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return normalize(data?.data, data?.rev);
    },
    async getRev() {
      if (demo) { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || 'null')?.rev || 0; } catch { return 0; } }
      const { data, error } = await sb.from('planner').select('rev').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return data?.rev || 0;
    },
    // → {ok, rev} or {conflict, data} when another device saved first
    async putData(d) {
      const rev = d.rev || 0, body = strip(d);
      if (demo) {
        const cur = await this.getRev();
        if (cur !== rev) return { conflict: true, data: await this.getData() };
        try { localStorage.setItem(DEMO_KEY, JSON.stringify({ data: body, rev: rev + 1 })); } catch { throw new Error('This browser blocked saving.'); }
        return { ok: true, rev: rev + 1 };
      }
      if (rev === 0) {
        const { error } = await sb.from('planner').insert({ user_id: user.id, data: body, rev: 1 });
        if (!error) return { ok: true, rev: 1 };
        if (error.code !== '23505') throw error; // 23505: a row already exists (saved from another device)
      } else {
        const { data, error } = await sb.from('planner').update({ data: body, rev: rev + 1, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('rev', rev).select('rev');
        if (error) throw error;
        if (data.length) return { ok: true, rev: rev + 1 };
      }
      return { conflict: true, data: await this.getData() };
    },
  };
})();
