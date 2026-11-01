# TubeNotes AI — YouTube Notes, Guides & Handbooks

A Chrome extension (Manifest V3) that turns every YouTube video into study material —
without interrupting your flow.

- ✎ **Timestamped notes** — floating button on every video; notes auto-save per video, click any timestamp to jump back, export to Markdown.
- ✦ **Quick Guide** — generated in the background when you open a video: one-line summary, key takeaways with timestamps, chapters, "worth your time?" verdict.
- 📖 **Handbook** — full structured reference: overview, concepts, step-by-step, examples, mistakes, FAQ, cheat sheet.
- 🔑 **Your key, your data** — analysis runs on Google's Gemini API with your own free API key. Everything stays in your browser.

## Setup (2 minutes, once)

1. Get a free Gemini API key at https://aistudio.google.com/apikey (no credit card).
2. Install the extension, open **Settings**, paste the key, save.

## Files

- `manifest.json` — MV3 manifest
- `content.js` / `panel.css` — YouTube page integration: FAB, side panel, notes, transcript extraction
- `background.js` — service worker: background Gemini analysis jobs
- `popup.html` / `popup.js` — toolbar popup
- `options.html` / `options.js` — settings (API key, model, auto-analyse)
- `icons/` — extension icons
- `store-assets/` — screenshots, promo tile, listing copy, demo page
- `PRIVACY.md` — privacy policy

## Privacy

See [PRIVACY.md](PRIVACY.md). Notes, guides and your API key live only in your browser.
Video captions are sent to Google's Gemini API solely to generate your guides.
