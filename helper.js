// Usul Lecture Planner helper. Runs as a bookmark on a team's SharePoint site, using your own browser
// sign-in. It reads only file *metadata* (team name, video names, dates and the length SharePoint
// stores for each video) and hands it straight to the Usul Lecture Planner window. Videos are never opened.
(async () => {
  const APP_URL = '__APP_URL__';
  const APP = new URL(APP_URL).origin;
  const ID = 'coursepace-helper';
  document.getElementById(ID)?.remove();
  const box = document.createElement('div');
  box.id = ID;
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:330px;background:#fff;color:#111418;' +
    'font:14px/1.5 -apple-system,Segoe UI,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);border-top:4px solid #014732';
  document.body.appendChild(box);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const say = html => {
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Usul Lecture Planner</b>' +
      `<button style="border:0;background:none;cursor:pointer;font-size:16px;color:#666">✕</button></div><div>${html}</div>`;
    box.querySelector('button').onclick = () => box.remove();
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const ctx = window._spPageContextInfo || {};
  const m = location.pathname.match(/^\/(sites|teams)\/[^/]+/i);
  const site = ctx.webAbsoluteUrl || (m ? location.origin + m[0] : '');
  if (!/\.sharepoint\.(com|us|de|cn)$/i.test(location.hostname) || !site) {
    say('Use this on the course\'s files page: in Teams, open the course team, go to <b>Files</b> and choose <b>Open in SharePoint</b>. Then click the bookmark again.');
    return;
  }

  // Find the Usul Lecture Planner window now, while we still have the click (pop-up blockers allow it only here).
  let target = null;
  try { if (window.opener && !window.opener.closed) target = window.opener; } catch { /* cross-origin */ }
  const openedApp = !target;
  if (!target) target = window.open(APP_URL + (window.name === 'usul-bridge' ? '#bridge' : /\/stream\.aspx$/i.test(location.pathname) ? '#watching' : '#from-teams'), 'coursepace');

  // ---- connection tab: the planner opened this tab to play lectures in its own player ----
  // For each lecture the planner asks for, get a short-lived link from SharePoint with your own sign-in.
  // Lectures Usul has blocked from downloading are refused by SharePoint, and the planner opens those here instead.
  if (window.name === 'usul-bridge') {
    const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const siteOf = u => (String(u).match(/^https:\/\/[^/]+\/(sites|teams)\/[^/?#]+/i) || [location.origin])[0];
    const linkFor = async d => {
      const site = siteOf(d.webUrl), sel = '?$select=id,name,parentReference,@content.downloadUrl';
      let raw = d.webUrl; try { raw = decodeURI(d.webUrl); } catch { /* keep as is */ }
      const urls = [];
      if (d.driveId && d.itemId) urls.push(`${site}/_api/v2.0/drives/${encodeURIComponent(d.driveId)}/items/${encodeURIComponent(d.itemId)}${sel}`);
      urls.push(`${site}/_api/v2.0/shares/u!${b64url(raw)}/driveItem${sel}`);
      let last = { error: 'SharePoint could not find this lecture.' };
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' });
          if (!r.ok) { last = { status: r.status === 403 ? 0 : r.status, error: `SharePoint returned ${r.status}.` }; continue; }
          const j = await r.json(), url = j['@content.downloadUrl'];
          if (!url) { last = { error: 'SharePoint gave no link for this lecture.' }; continue; }
          const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, credentials: 'omit' });
          if (probe.status === 401 || probe.status === 403) return { status: 403, error: 'Downloading is blocked for this lecture.' };
          return { url, driveId: j.parentReference?.driveId || '' };
        } catch (e) { last = { error: String(e?.message || e) }; }
      }
      return last;
    };
    let acked = false, served = 0;
    const status = () => say(acked
      ? `Connected to the planner.${served ? ` ${served} lecture${served === 1 ? '' : 's'} sent.` : ''}<br><span style="color:#666">Keep this tab open while you study, and go back to the planner tab.</span>`
      : 'Connecting to the planner…');
    window.addEventListener('message', async e => {
      const d = e.data;
      if (e.origin !== APP || d?.app !== 'coursepace') return;
      if (d.type === 'bridge-ack') { acked = true; return status(); }
      if (d.type !== 'get-link') return;
      acked = true;
      const res = await linkFor(d);
      if (res.url) served++;
      try { e.source.postMessage({ app: 'coursepace', type: 'link', id: d.id, ...res }, APP); } catch { /* planner closed */ }
      status();
    });
    status();
    for (let i = 0; i < 30 && !acked; i++) {
      try { target?.postMessage({ app: 'coursepace', type: 'bridge' }, APP); } catch { /* not ready */ }
      await sleep(1000);
    }
    if (!acked) say('Couldn\'t reach the planner. Go back to the planner tab, click <b>▶ Watch</b> on a lecture, then <b>Open SharePoint</b> there.');
    return;
  }

  // ---- on a video page: follow the player and report how far you've watched ----
  const findPlayer = (doc = document, depth = 0) => {
    const list = [...doc.querySelectorAll('video')];
    let v = list.find(x => x.duration > 0) || list[0];
    if (!v) for (const el of doc.querySelectorAll('*')) { const r = el.shadowRoot?.querySelector('video'); if (r) { v = r; break; } }
    if (!v && depth < 2) for (const f of doc.querySelectorAll('iframe')) { try { v = findPlayer(f.contentDocument, depth + 1); if (v) break; } catch { /* other site */ } }
    return v || null;
  };
  const qs = new URLSearchParams(location.search);
  const videoPath = qs.get('id') || qs.get('file') || decodeURIComponent(location.pathname);
  const onVideoPage = /\/stream\.aspx$/i.test(location.pathname) || /\.(mp4|m4v|mov|webm|mkv|avi|wmv)$/i.test(videoPath) || !!findPlayer();
  if (onVideoPage) {
    clearInterval(window.__cpTrack);
    const clock = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
    box.style.top = 'auto'; box.style.bottom = '16px'; box.style.width = '280px';
    let ack = null, ackAt = 0, startedAt = Date.now(), last = -1;
    window.addEventListener('message', e => { if (e.origin === APP && e.data?.type === 'coursepace-progress-ack') { ack = e.data; ackAt = Date.now(); } });
    const draw = p => {
      if (!document.getElementById(ID)) return; // closed by the user; keep tracking quietly
      let line;
      if (!p) line = '<span style="color:#666">Press play. Tracking starts when the video plays.</span>';
      else if (!ackAt && Date.now() - startedAt > 12000) line = '<span style="color:#9a6a1f">Can\'t reach Usul Lecture Planner. Open this lecture from the planner\'s ▶ Watch, then click the bookmark here again.</span>';
      else if (ack && !ack.title) line = '<span style="color:#9a6a1f">This video isn\'t in your planner. Sync the course, then try again.</span>';
      else if (ack?.done) line = `<span style="color:#0a6b4d">✓ Marked as watched</span>`;
      else line = `<span style="color:#666">${clock(p.currentTime)} of ${clock(p.duration)} · <b style="color:#272411">${Math.ceil(Math.max(0, p.duration - p.currentTime) / 60)} min left</b> · ${ack ? '<span style="color:#0a6b4d">saved</span>' : 'connecting…'}</span>`;
      say(`${ack?.title ? `<div style="font-weight:600;margin-bottom:2px">${esc(ack.title)}</div>` : ''}${line}`);
    };
    const send = force => {
      const p = findPlayer();
      if (!p || !(p.duration > 0)) return draw(null);
      if (force || Math.abs(p.currentTime - last) >= 1 || !ackAt) {
        last = p.currentTime;
        const msg = { app: 'coursepace', type: 'progress', version: 5, page: location.href.split('#')[0], path: videoPath,
          name: videoPath.split('/').pop(), title: document.title, position: p.currentTime, duration: p.duration, ended: p.ended };
        try { target?.postMessage(msg, APP); } catch { /* planner tab closed */ }
      }
      draw(p);
    };
    for (const ev of ['pause', 'seeked', 'ended']) document.addEventListener(ev, () => send(true), true);
    window.addEventListener('pagehide', () => send(true));
    window.__cpTrack = setInterval(() => send(false), 3000);
    send(true);
    return;
  }

  async function getJson(url) {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
      if (r.status === 429 || r.status === 503) { await sleep((+r.headers.get('Retry-After') || 2 ** i) * 1000); continue; }
      if (!r.ok) throw new Error(`SharePoint returned ${r.status}${r.status === 403 ? ' (no access)' : ''}`);
      return r.json();
    }
    throw new Error('SharePoint is busy. Try again in a minute.');
  }

  // ---- list every video in the team's files (metadata only) ----
  // Looks in: every document library of the team site, the separate sites that private and
  // shared channels get (…/sites/Team-ChannelName), and shortcut folders that point elsewhere.
  const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpg|mpeg|3gp|m2ts|ts)$/i;
  const SKIP_LIBS = /^(Site Assets|Style Library|Form Templates|Site Pages|Pages|Preservation Hold Library|Teams Wiki Data)$/i;
  const siteName = ctx.webTitle || decodeURIComponent(site.split('/').pop());
  const videos = [], seen = new Set(), places = [];
  let folders = 0, links = 0, skipped = 0;
  const progress = () => say(`Reading the course details…<br><span style="color:#666">${places.length} libraries · ${folders} folders · ${videos.length} videos found</span>`);

  async function scanDrive(siteUrl, driveId, startItem, label, place) {
    const api = `${siteUrl}/_api/v2.0`;
    const stack = [[startItem ? `${api}/drives/${driveId}/items/${startItem}/children?$top=200` : `${api}/drives/${driveId}/root/children?$top=200`, label]];
    while (stack.length) {
      let [url, folder] = stack.pop();
      while (url) {
        let page;
        try { page = await getJson(url); } catch { skipped++; break; } // a folder we can't open: skip it, keep going
        for (const it of page.value || []) {
          const name = it.name || '';
          const sub = folder ? `${folder}/${name}` : name;
          const remote = it.remoteItem;
          if (it.folder) {
            folders++;
            stack.push([`${api}/drives/${it.parentReference?.driveId || driveId}/items/${it.id}/children?$top=200`, sub]);
          } else if (remote?.folder) {
            // shortcut to a folder stored somewhere else
            const key = `${remote.parentReference?.driveId}:${remote.id}`;
            if (!seen.has(key)) { seen.add(key); folders++; stack.push([`${api}/drives/${remote.parentReference.driveId}/items/${remote.id}/children?$top=200`, sub]); }
          } else if (it.video || remote?.video || VIDEO.test(name) || /^video\//.test(it.file?.mimeType || remote?.file?.mimeType || '')) {
            const src = remote || it;
            const key = `${src.parentReference?.driveId || driveId}:${src.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const dur = it.video?.duration || remote?.video?.duration;
            videos.push({
              itemId: src.id, driveId: src.parentReference?.driveId || driveId, name, folder,
              seconds: dur ? Math.round(dur / 1000) : 0,
              created: it.fileSystemInfo?.createdDateTime || it.createdDateTime, webUrl: it.webUrl,
            });
            place.videos++;
          } else if (/\.url$/i.test(name)) links++;
        }
        progress();
        url = page['@odata.nextLink'];
      }
    }
  }

  async function scanSite(siteUrl, title, isMain) {
    let drives = [];
    try { drives = (await getJson(`${siteUrl}/_api/v2.0/drives`)).value || []; } catch { /* fall back below */ }
    if (!drives.length) {
      try { drives = [await getJson(`${siteUrl}/_api/v2.0/drive`)]; } catch { skipped++; return; }
    }
    for (const d of drives) {
      if (d.driveType && d.driveType !== 'documentLibrary') continue;
      if (SKIP_LIBS.test(d.name || '')) continue;
      const isDefault = /^(Documents|Shared Documents)$/i.test(d.name || '');
      // folder label used for grouping: channel name for channel sites, library name for extra libraries
      const label = [isMain ? '' : title, isDefault ? '' : d.name].filter(Boolean).join('/');
      const place = { site: title, library: d.name || 'Documents', videos: 0 };
      places.push(place);
      await scanDrive(siteUrl, d.id, null, label, place);
    }
  }

  // private / shared channel sites live next to the team site: …/sites/Team-ChannelName
  async function channelSites() {
    const found = [];
    try {
      const kql = `contentclass:STS_Site Path:"${site}-*"`;
      const r = await getJson(`${location.origin}/_api/search/query?querytext='${encodeURIComponent(kql)}'&selectproperties='Path,Title'&rowlimit=100&trimduplicates=false`);
      const rel = (r.d?.query || r).PrimaryQueryResult?.RelevantResults?.Table?.Rows;
      for (const row of (rel?.results || rel || [])) {
        const cells = row.Cells?.results || row.Cells || [];
        const get = k => cells.find(c => c.Key === k)?.Value;
        const path = (get('Path') || '').replace(/\/$/, '');
        if (path.toLowerCase().startsWith(site.toLowerCase() + '-') && !found.some(f => f.url === path)) {
          found.push({ url: path, title: get('Title') || decodeURIComponent(path.slice(site.length + 1)) });
        }
      }
    } catch { /* search unavailable: only the main site is scanned */ }
    return found;
  }

  say('Reading the course details…');
  await scanSite(site, siteName, true);
  for (const ch of await channelSites()) await scanSite(ch.url, ch.title.replace(new RegExp('^' + siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*', 'i'), ''), false);
  if (!places.length) {
    say('Couldn\'t read this team\'s files. Make sure you can open them in SharePoint.');
    return;
  }

  const payload = {
    app: 'coursepace', version: 5, site, siteName,
    groupId: ctx.groupId || ctx.siteGroupId || '', scannedAt: new Date().toISOString(), videos,
    scanInfo: { places, folders, links, skipped },
  };
  const total = videos.reduce((a, v) => a + v.seconds, 0);
  const summary = `<b>${esc(payload.siteName)}</b><br>${videos.length} videos · ${Math.floor(total / 3600)}h ${String(Math.round(total % 3600 / 60)).padStart(2, '0')}m`;

  // ---- hand it to Usul Lecture Planner ----
  let acked = false;
  window.addEventListener('message', e => { if (e.origin === APP && e.data?.type === 'coursepace-ack') acked = true; });
  say(`${summary}<br><span style="color:#666">Sending to Usul Lecture Planner…</span>`);
  for (let i = 0; i < 40 && !acked; i++) {
    try { target?.postMessage(payload, APP); } catch { /* window not ready yet */ }
    await sleep(500);
  }
  if (acked) {
    say(`${summary}<br><span style="color:#15803d">✓ Sent to Usul Lecture Planner</span>${openedApp ? '' : '<br><span style="color:#666">This tab will close.</span>'}`);
    if (!openedApp) setTimeout(() => window.close(), 1200);
    return;
  }
  // Fallback: Usul Lecture Planner isn't reachable from here, so save the details as a file instead.
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `coursepace-${payload.siteName.replace(/[^\w-]+/g, '_').slice(0, 60)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  say(`${summary}<br><br>Couldn't reach Usul Lecture Planner (is its tab still open?). The details were saved to your Downloads. In Usul Lecture Planner, use <b>Choose file</b> to load them.`);
})();
