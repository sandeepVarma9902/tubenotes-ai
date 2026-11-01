// TubeNotes AI — content script for YouTube watch pages.
// Floating notes button + side panel. On video open it fetches the captions
// transcript and asks the service worker to build the Quick Guide + Handbook
// in the background, without touching the viewing experience.
(() => {
  'use strict';

  let videoId = null;
  let videoTitle = '';
  let status = 'idle'; // idle|analyzing|done|need-key|no-captions|error
  let statusText = '';
  let analysis = null;
  let notes = [];
  let uiBuilt = false;
  let lastUrl = location.href;
  let toastTimer = null;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }
  function parseTs(ts) {
    const p = ts.split(':').map(Number);
    let s = 0;
    for (const n of p) s = s * 60 + n;
    return s;
  }
  function getVideoId() {
    const m = location.href.match(/[?&]v=([\w-]{11})/);
    if (m) return m[1];
    const sh = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    return sh ? sh[1] : null;
  }
  function getTitle() {
    const t = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '').trim();
    return t || 'YouTube video';
  }
  function currentTime() {
    const v = $('video');
    return v ? v.currentTime : 0;
  }
  function seek(sec) {
    const v = $('video');
    if (v) { v.currentTime = sec; v.focus(); }
  }

  /* ---------------- transcript ---------------- */
  function extractPlayerResponse() {
    const html = document.documentElement.innerHTML;
    const key = 'ytInitialPlayerResponse = ';
    const i = html.indexOf(key);
    if (i < 0) return null;
    let j = i + key.length;
    while (j < html.length && /\s/.test(html[j])) j++;
    if (html[j] !== '{') return null;
    let depth = 0, inStr = false, strCh = '', escapeNext = false;
    for (let k = j; k < html.length; k++) {
      const ch = html[k];
      if (inStr) {
        if (escapeNext) escapeNext = false;
        else if (ch === '\\') escapeNext = true;
        else if (ch === strCh) inStr = false;
      } else {
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(html.slice(j, k + 1)); } catch (e) { return null; }
          }
        }
      }
    }
    return null;
  }

  function pickTrack(tracks) {
    if (!tracks || !tracks.length) return null;
    const manual = (arr) => arr.find((t) => !t.kind || t.kind !== 'asr');
    const en = tracks.filter((t) => t.languageCode === 'en');
    return manual(en) || en.find((t) => t.kind === 'asr') || manual(tracks) || tracks[0];
  }

  function vttTs(s) {
    let sec = 0;
    for (const part of s.split(':')) sec = sec * 60 + parseFloat(part);
    return sec;
  }

  function parseVTT(vtt) {
    const cues = [];
    for (const block of vtt.split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/).filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('WEBVTT') && !t.startsWith('Kind:') && !t.startsWith('Language:') && !/^\d+$/.test(t);
      });
      if (!lines.length) continue;
      const ti = lines.findIndex((l) => l.includes('-->'));
      if (ti < 0) continue;
      const start = vttTs(lines[ti].split('-->')[0].trim());
      const text = lines.slice(ti + 1).join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean) cues.push({ start, text: clean });
    }
    return cues;
  }

  async function fetchTranscript() {
    const pr = extractPlayerResponse();
    const tracks = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    const track = pickTrack(tracks);
    if (!track || !track.baseUrl) return null;
    const url = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=vtt';
    const res = await fetch(url);
    if (!res.ok) return null;
    const cues = parseVTT(await res.text());
    return cues.length ? cues : null;
  }

  function cuesToText(cues) {
    return cues.map((c) => '[' + fmt(c.start) + '] ' + c.text).join('\n');
  }

  /* ---------------- storage ---------------- */
  const notesKey = () => 'tn_notes_' + videoId;
  const analysisKey = () => 'tn_analysis_' + videoId;

  async function loadNotes() {
    const o = await chrome.storage.local.get(notesKey());
    notes = o[notesKey()] || [];
  }
  async function saveNotes() {
    await chrome.storage.local.set({ [notesKey()]: notes });
  }

  /* ---------------- tiny markdown ---------------- */
  function md(src) {
    let h = esc(src || '');
    h = h.replace(/^### (.*)$/gm, '<h4>$1</h4>')
         .replace(/^## (.*)$/gm, '<h3>$1</h3>')
         .replace(/^# (.*)$/gm, '<h2>$1</h2>')
         .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
         .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
         .replace(/^\s*\d+[.)] (.*)$/gm, '<li>$1</li>');
    h = h.replace(/(?:<li>.*<\/li>\s*)+/g, (m) => '<ul>' + m + '</ul>');
    h = h.split(/\n{2,}/).map((p) => (/^<(h\d|ul)/.test(p.trim()) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>')).join('');
    h = h.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (m, ts) => {
      return '<button class="tn-ts" data-s="' + parseTs(ts) + '" title="Jump to ' + ts + '">' + ts + '</button>';
    });
    return h;
  }

  /* ---------------- UI ---------------- */
  function ensureUI() {
    if (uiBuilt) return;
    uiBuilt = true;

    const fab = document.createElement('div');
    fab.id = 'tn-fab';
    fab.title = 'TubeNotes AI — notes & guides';
    fab.innerHTML = '<span id="tn-fab-dot"></span><span id="tn-fab-icon">✎</span>';
    document.body.appendChild(fab);
    makeDraggable(fab);
    fab.addEventListener('click', (e) => { if (!fab.dataset.moved) togglePanel(); fab.dataset.moved = ''; });

    const panel = document.createElement('div');
    panel.id = 'tn-panel';
    panel.innerHTML =
      '<div id="tn-head">' +
        '<div><div id="tn-title">TubeNotes AI</div><div id="tn-status"></div></div>' +
        '<button id="tn-close" title="Close">×</button>' +
      '</div>' +
      '<div id="tn-tabs">' +
        '<button data-tab="notes" class="on">Notes</button>' +
        '<button data-tab="guide">Quick Guide</button>' +
        '<button data-tab="handbook">Handbook</button>' +
      '</div>' +
      '<div id="tn-body">' +
        '<div id="tn-tab-notes">' +
          '<div id="tn-note-add">' +
            '<textarea id="tn-note-input" rows="2" placeholder="Type a note… (timestamp is added automatically)"></textarea>' +
            '<div id="tn-note-actions">' +
              '<button id="tn-note-ts" title="Insert current timestamp">🕒 <span id="tn-note-cur">0:00</span></button>' +
              '<button id="tn-note-save">Add note</button>' +
              '<button id="tn-note-export" title="Export notes as Markdown">⭳</button>' +
            '</div>' +
          '</div>' +
          '<div id="tn-note-list"></div>' +
        '</div>' +
        '<div id="tn-tab-guide" hidden><div class="tn-doc" id="tn-guide-doc"></div></div>' +
        '<div id="tn-tab-handbook" hidden><div class="tn-doc" id="tn-handbook-doc"></div></div>' +
      '</div>';
    document.body.appendChild(panel);

    $('#tn-close', panel).addEventListener('click', () => panel.classList.remove('open'));
    $$('#tn-tabs button', panel).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    panel.addEventListener('click', (e) => {
      const ts = e.target.closest('.tn-ts');
      if (ts) { seek(Number(ts.dataset.s)); return; }
      const del = e.target.closest('.tn-del');
      if (del) { deleteNote(del.dataset.id); }
    });

    $('#tn-note-save', panel).addEventListener('click', addNote);
    $('#tn-note-input', panel).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote();
    });
    $('#tn-note-ts', panel).addEventListener('click', () => {
      const inp = $('#tn-note-input', panel);
      inp.value += (inp.value && !inp.value.endsWith(' ') ? ' ' : '') + '[' + fmt(currentTime()) + '] ';
      inp.focus();
    });
    $('#tn-note-export', panel).addEventListener('click', exportNotes);
    setInterval(() => {
      const cur = $('#tn-note-cur');
      if (cur && panel.classList.contains('open')) cur.textContent = fmt(currentTime());
    }, 1000);
  }

  function makeDraggable(el) {
    let sx, sy, ox, oy, dragging = false;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; el.dataset.moved = '';
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) el.dataset.moved = '1';
      el.style.left = Math.min(Math.max(ox + e.clientX - sx, 8), innerWidth - 60) + 'px';
      el.style.top = Math.min(Math.max(oy + e.clientY - sy, 8), innerHeight - 60) + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    });
    el.addEventListener('pointerup', () => { dragging = false; });
  }

  function togglePanel(force) {
    const panel = $('#tn-panel');
    const open = force !== undefined ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
  }

  function switchTab(name) {
    $$('#tn-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    ['notes', 'guide', 'handbook'].forEach((t) => { $('#tn-tab-' + t).hidden = t !== name; });
    if (name === 'guide') renderGuide();
    if (name === 'handbook') renderHandbook();
  }

  function toast(msg, ms) {
    let t = $('#tn-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tn-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 4200);
  }

  function setStatus(s, text) {
    status = s; statusText = text || '';
    const dot = $('#tn-fab-dot');
    if (dot) dot.className = 'st-' + s;
    const st = $('#tn-status');
    if (st) {
      st.textContent = text || '';
      st.className = 'st-' + s;
    }
    if (s === 'analyzing') toast('TubeNotes AI is preparing your Quick Guide + Handbook in the background…');
  }

  /* ---------------- notes ---------------- */
  function renderNotes() {
    const list = $('#tn-note-list');
    if (!list) return;
    const sorted = notes.slice().sort((a, b) => a.t - b.t);
    list.innerHTML = sorted.length
      ? sorted.map((n) =>
          '<div class="tn-note"><button class="tn-ts" data-s="' + n.t + '">' + fmt(n.t) + '</button>' +
          '<span class="tn-note-text">' + esc(n.text) + '</span>' +
          '<button class="tn-del" data-id="' + n.id + '" title="Delete">×</button></div>'
        ).join('')
      : '<div class="tn-empty">No notes yet. They save automatically, per video.</div>';
  }

  async function addNote() {
    const inp = $('#tn-note-input');
    const text = inp.value.trim();
    if (!text) return;
    notes.push({ id: 'n' + Date.now().toString(36), t: Math.floor(currentTime()), text, created: Date.now() });
    await saveNotes();
    inp.value = '';
    renderNotes();
  }

  async function deleteNote(id) {
    notes = notes.filter((n) => n.id !== id);
    await saveNotes();
    renderNotes();
  }

  function exportNotes() {
    const sorted = notes.slice().sort((a, b) => a.t - b.t);
    const body = '# Notes — ' + videoTitle + '\n' + location.href + '\n\n' +
      (sorted.length ? sorted.map((n) => '- [' + fmt(n.t) + '](https://youtu.be/' + videoId + '?t=' + n.t + 's) ' + n.text).join('\n') : '_No notes yet._') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
    a.download = 'tubenotes-' + videoId + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- analysis docs ---------------- */
  function docShell(kind, inner) {
    return '<div class="tn-doc-head"><span>' + (kind === 'guide' ? 'Quick Guide' : 'Handbook') + '</span>' +
      '<button class="tn-mini" id="tn-reanalyze">↻ Re-analyse</button></div>' + inner;
  }

  function renderGuide() {
    const doc = $('#tn-guide-doc');
    if (!doc) return;
    if (analysis && analysis.guide) {
      doc.innerHTML = docShell('guide', md(analysis.guide));
    } else if (status === 'analyzing') {
      doc.innerHTML = '<div class="tn-working"><div class="tn-spinner"></div><p>' + esc(statusText || 'Analysing…') + '</p></div>';
    } else {
      doc.innerHTML = '<div class="tn-empty">' + esc(statusText || 'No guide yet.') +
        (status === 'need-key' ? ' <a href="#" id="tn-open-options">Add your free Gemini API key</a>.' : '') +
        ' <a href="#" id="tn-analyze-now">Analyse now</a>.</div>';
    }
    bindDocLinks(doc);
  }

  function renderHandbook() {
    const doc = $('#tn-handbook-doc');
    if (!doc) return;
    if (analysis && analysis.handbook) {
      doc.innerHTML = docShell('handbook', md(analysis.handbook));
    } else if (status === 'analyzing') {
      doc.innerHTML = '<div class="tn-working"><div class="tn-spinner"></div><p>' + esc(statusText || 'Analysing…') + '</p></div>';
    } else {
      doc.innerHTML = '<div class="tn-empty">' + esc(statusText || 'No handbook yet.') +
        ' <a href="#" id="tn-analyze-now">Analyse now</a>.</div>';
    }
    bindDocLinks(doc);
  }

  function bindDocLinks(doc) {
    const ra = $('#tn-reanalyze', doc);
    if (ra) ra.addEventListener('click', () => startAnalysis(true));
    const an = $('#tn-analyze-now', doc);
    if (an) an.addEventListener('click', (e) => { e.preventDefault(); startAnalysis(true); });
    const oo = $('#tn-open-options', doc);
    if (oo) oo.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'TN_OPEN_OPTIONS' }); });
  }

  /* ---------------- flow ---------------- */
  async function onVideo(id) {
    videoId = id;
    videoTitle = getTitle();
    analysis = null;
    ensureUI();
    $('#tn-panel').classList.remove('open');
    switchTab('notes');
    setStatus('idle', '');
    await loadNotes();
    renderNotes();

    const o = await chrome.storage.local.get([analysisKey(), 'tn_apiKey', 'tn_auto']);
    analysis = o[analysisKey()] || null;
    if (analysis && analysis.done) {
      setStatus('done', 'Guide + Handbook ready');
    } else if (analysis && analysis.error) {
      setStatus(analysis.error === 'NO_API_KEY' ? 'need-key' : 'error', analysis.error === 'NO_API_KEY' ? 'Add your free Gemini API key to analyse videos.' : 'Analysis failed — open the Guide tab to retry.');
    }

    const auto = o.tn_auto !== false;
    if (auto && !(analysis && analysis.done)) {
      startAnalysis(false);
    }
  }

  async function startAnalysis(force) {
    if (!videoId || status === 'analyzing') return;
    const o = await chrome.storage.local.get(['tn_apiKey', 'tn_model']);
    const apiKey = (o.tn_apiKey || '').trim();
    if (!apiKey) {
      setStatus('need-key', 'Add your free Gemini API key to analyse videos.');
      if (force) { togglePanel(true); switchTab('guide'); renderGuide(); }
      return;
    }
    if (force) {
      await chrome.runtime.sendMessage({ type: 'TN_CLEAR_ANALYSIS', videoId });
      analysis = null;
    } else if (analysis && analysis.done) return;

    setStatus('analyzing', 'Reading the video…');
    let cues = null;
    try { cues = await fetchTranscript(); } catch (e) { cues = null; }
    if (!cues) {
      setStatus('no-captions', 'This video has no captions to analyse. Notes still work.');
      return;
    }
    const transcript = cuesToText(cues);
    const res = await chrome.runtime.sendMessage({
      type: 'TN_ANALYZE',
      payload: { videoId, title: videoTitle, transcript },
    }).catch(() => ({ ok: false, error: 'background unreachable' }));
    if (!res || !res.ok) {
      const err = (res && res.error) || 'unknown error';
      setStatus(err === 'NO_API_KEY' ? 'need-key' : 'error', err === 'NO_API_KEY' ? 'Add your free Gemini API key to analyse videos.' : 'Analysis failed: ' + err);
    }
  }

  /* ---------------- messages ---------------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.videoId && msg.videoId !== videoId) return false;
    if (msg.type === 'TN_PROGRESS') {
      setStatus('analyzing', msg.text || 'Analysing…');
      if (!$('#tn-tab-guide').hidden) renderGuide();
      if (!$('#tn-tab-handbook').hidden) renderHandbook();
    } else if (msg.type === 'TN_DONE') {
      chrome.storage.local.get(analysisKey()).then((o) => {
        analysis = o[analysisKey()] || null;
        setStatus('done', 'Guide + Handbook ready');
        if (!$('#tn-tab-guide').hidden) renderGuide();
        if (!$('#tn-tab-handbook').hidden) renderHandbook();
      });
    } else if (msg.type === 'TN_ERROR') {
      setStatus(msg.error === 'NO_API_KEY' ? 'need-key' : 'error',
        msg.error === 'NO_API_KEY' ? 'Add your free Gemini API key to analyse videos.' : 'Analysis failed: ' + msg.error);
      if (!$('#tn-tab-guide').hidden) renderGuide();
    } else if (msg.type === 'TN_OPEN_PANEL') {
      ensureUI(); togglePanel(true);
    } else if (msg.type === 'TN_REANALYZE') {
      ensureUI(); togglePanel(true); switchTab('guide'); startAnalysis(true);
    } else if (msg.type === 'TN_POPUP_STATE') {
      sendResponse({ videoId, title: videoTitle, status, statusText, noteCount: notes.length });
      return true;
    }
    return false;
  });

  /* ---------------- boot ---------------- */
  function boot() {
    const id = getVideoId();
    if (id && id !== videoId) onVideo(id);
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        const nid = getVideoId();
        if (nid && nid !== videoId) onVideo(nid);
        else if (!nid) { videoId = null; const p = $('#tn-panel'); if (p) p.classList.remove('open'); const f = $('#tn-fab'); if (f) f.style.display = 'none'; }
      }
      const f = $('#tn-fab');
      if (f) f.style.display = videoId ? '' : 'none';
    }, 1000);
    document.addEventListener('yt-navigate-finish', () => {
      lastUrl = location.href;
      const nid = getVideoId();
      if (nid && nid !== videoId) onVideo(nid);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
