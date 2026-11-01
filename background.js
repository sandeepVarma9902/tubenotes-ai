// TubeNotes AI — service worker.
// Runs the background analysis jobs: sends the video transcript to the
// user's own Gemini API key and builds the Quick Guide + Handbook.

const DEFAULT_MODEL = 'gemini-2.0-flash';
const MAX_TRANSCRIPT_CHARS = 100000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TN_ANALYZE') {
    runAnalysis(msg.payload, sender && sender.tab && sender.tab.id).then(
      (r) => sendResponse({ ok: true, result: r }),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true;
  }
  if (msg.type === 'TN_GET_ANALYSIS') {
    const key = 'tn_analysis_' + msg.videoId;
    chrome.storage.local.get(key).then((o) => {
      sendResponse({ ok: true, analysis: o[key] || null });
    });
    return true;
  }
  if (msg.type === 'TN_CLEAR_ANALYSIS') {
    chrome.storage.local.remove('tn_analysis_' + msg.videoId).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function getSettings() {
  const o = await chrome.storage.local.get(['tn_apiKey', 'tn_model', 'tn_auto']);
  return {
    apiKey: (o.tn_apiKey || '').trim(),
    model: o.tn_model || DEFAULT_MODEL,
    auto: o.tn_auto !== false,
  };
}

function notify(tabId, payload) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}

async function gemini(apiKey, model, prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || ('Gemini API error ' + res.status));
  }
  const text = ((data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
    .map((p) => p.text || '')
    .join('');
  if (!text.trim()) throw new Error('Empty response from Gemini');
  return text.trim();
}

function guidePrompt(title, transcript) {
  return (
    'You are TubeNotes AI, a sharp study assistant. Analyse this YouTube video transcript ' +
    'and produce a QUICK GUIDE in Markdown.\n\n' +
    'Video title: ' + title + '\n\n' +
    'Transcript (lines look like [mm:ss] spoken text):\n' + transcript + '\n\n' +
    'Use exactly this format:\n' +
    '# Quick Guide\n' +
    '## In one line\n(one sentence: what this video teaches)\n' +
    '## Key takeaways\n' +
    '(5 to 8 bullets, each ending with its [mm:ss] timestamp)\n' +
    '## Chapters\n' +
    '([mm:ss] — section name, one per line, covering the whole video)\n' +
    '## Worth your time?\n' +
    '(2-3 lines: who should watch fully, who can skim, what to skip)\n\n' +
    'Keep it tight and skimmable. Base everything on the transcript, never invent facts.'
  );
}

function handbookPrompt(title, transcript) {
  return (
    'You are TubeNotes AI, a technical writer. Turn this YouTube video transcript into a ' +
    'structured HANDBOOK in Markdown — a reference the viewer can use without rewatching.\n\n' +
    'Video title: ' + title + '\n\n' +
    'Transcript (lines look like [mm:ss] spoken text):\n' + transcript + '\n\n' +
    'Use this format, skipping sections that do not apply:\n' +
    '# Handbook\n' +
    '## Overview\n' +
    '## Prerequisites\n' +
    '## Core concepts\n' +
    '## Step-by-step walkthrough\n' +
    '## Worked examples\n' +
    '## Common mistakes & gotchas\n' +
    '## FAQ\n' +
    '## Cheat sheet\n\n' +
    'Reference [mm:ss] timestamps where they help. Be concrete and practical, no filler. ' +
    'Base everything on the transcript, never invent facts.'
  );
}

async function runAnalysis(payload, tabId) {
  const { videoId, title, transcript } = payload;
  const key = 'tn_analysis_' + videoId;
  const { apiKey, model } = await getSettings();
  if (!apiKey) throw new Error('NO_API_KEY');

  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && cached.done && cached.model === model && !cached.error) {
    notify(tabId, { type: 'TN_DONE', videoId, cached: true });
    return cached;
  }

  const analysis = { videoId, title, model, done: false, at: Date.now() };
  await chrome.storage.local.set({ [key]: analysis });

  const t =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[…transcript truncated…]'
      : transcript;

  try {
    notify(tabId, { type: 'TN_PROGRESS', videoId, stage: 'guide', text: 'Reading the video…' });
    analysis.guide = await gemini(apiKey, model, guidePrompt(title, t));
    analysis.at = Date.now();
    await chrome.storage.local.set({ [key]: analysis });

    notify(tabId, { type: 'TN_PROGRESS', videoId, stage: 'handbook', text: 'Writing your handbook…' });
    analysis.handbook = await gemini(apiKey, model, handbookPrompt(title, t));
    analysis.done = true;
    analysis.error = null;
    analysis.at = Date.now();
    await chrome.storage.local.set({ [key]: analysis });

    notify(tabId, { type: 'TN_DONE', videoId });
    return analysis;
  } catch (e) {
    analysis.error = String((e && e.message) || e);
    analysis.at = Date.now();
    await chrome.storage.local.set({ [key]: analysis });
    notify(tabId, { type: 'TN_ERROR', videoId, error: analysis.error });
    throw e;
  }
}
