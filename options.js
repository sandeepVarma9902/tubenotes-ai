// TubeNotes AI — options page.
document.addEventListener('DOMContentLoaded', async () => {
  const o = await chrome.storage.local.get(['tn_apiKey', 'tn_model', 'tn_auto']);
  document.getElementById('apiKey').value = o.tn_apiKey || '';
  document.getElementById('model').value = o.tn_model || 'gemini-2.0-flash';
  document.getElementById('auto').checked = o.tn_auto !== false;

  document.getElementById('save').addEventListener('click', async () => {
    await chrome.storage.local.set({
      tn_apiKey: document.getElementById('apiKey').value.trim(),
      tn_model: document.getElementById('model').value,
      tn_auto: document.getElementById('auto').checked,
    });
    const s = document.getElementById('saved');
    s.style.opacity = 1;
    setTimeout(() => (s.style.opacity = 0), 1600);
  });

  document.getElementById('clear').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('tn_analysis_'));
    if (keys.length) await chrome.storage.local.remove(keys);
    alert('Cleared ' + keys.length + ' cached ' + (keys.length === 1 ? 'analysis' : 'analyses') + '.');
  });
});
