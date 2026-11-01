// TubeNotes AI — toolbar popup.
document.addEventListener('DOMContentLoaded', async () => {
  const main = document.getElementById('main');
  const hint = document.getElementById('hint');
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) { tab = null; }
  const onVideo = tab && tab.url && (/youtube\.com\/(watch|shorts)/.test(tab.url));

  if (!onVideo) {
    main.hidden = true;
    hint.hidden = false;
    return;
  }

  const send = (type) => chrome.tabs.sendMessage(tab.id, { type }).catch(() => null);

  try {
    const st = await send('TN_POPUP_STATE');
    if (st && st.videoId) {
      document.getElementById('vtitle').textContent = st.title || '';
      const ps = document.getElementById('pstatus');
      ps.textContent = st.statusText || (st.status === 'done' ? 'Guide + Handbook ready' : '');
      ps.className = 'st-' + st.status;
    }
  } catch (e) { /* content script not ready yet */ }

  document.getElementById('b-open').addEventListener('click', () => { send('TN_OPEN_PANEL'); window.close(); });
  document.getElementById('b-retry').addEventListener('click', () => { send('TN_REANALYZE'); window.close(); });
  document.getElementById('b-opts').addEventListener('click', () => { chrome.runtime.openOptionsPage(); });
});
