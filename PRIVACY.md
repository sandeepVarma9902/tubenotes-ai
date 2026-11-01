# Privacy Policy — TubeNotes AI

**Last updated:** November 1, 2026

TubeNotes AI ("the extension") is a note-taking and study-guide tool for YouTube videos.
This policy explains what data the extension handles.

## What the extension does
- Lets you take timestamped notes on YouTube videos you watch.
- Optionally analyses a video's captions transcript with Google's Gemini API (using **your own
  API key**, which you enter in the extension's Settings page) to generate a Quick Guide and
  a Handbook for that video.

## Data stored
- **Notes** you type are stored only on your device, using Chrome's `chrome.storage` API.
  They are never sent to the developer or any third party.
- **Generated guides/handbooks** are cached on your device only, so reopening a video is instant.
- **Your Gemini API key** is stored only on your device. It is sent solely to
  `generativelanguage.googleapis.com` to fulfil your analysis requests — never to the developer.

## Data transmitted
- When analysis is enabled, the video's **captions transcript** (public subtitles of the video
  you are watching) is sent to Google's Gemini API together with your API key, so the guide
  and handbook can be generated. This is governed by Google's API terms and privacy policy.
- No browsing history, personal information, or notes are transmitted anywhere.

## What we do NOT do
- No analytics, no tracking, no advertising.
- No accounts, no sign-in, no servers operated by the developer.

## Contact
https://github.com/sandeepvarma9902/tubenotes-ai
