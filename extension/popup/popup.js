import { renderReport } from './render.js';
const message = document.getElementById('message');
const scanButton = document.getElementById('rescan');
const reloadButton = document.getElementById('reload');
const filesButton = document.getElementById('files');
const buttons = [scanButton, reloadButton, filesButton];

function showMessage(text, error = false) {
  message.hidden = false;
  message.className = `message${error ? ' error' : ''}`;
  message.textContent = text;
}
async function request(type) {
  const { id: windowId } = await chrome.windows.getCurrent();
  const response = await chrome.runtime.sendMessage({ type, windowId });
  if (!response?.ok) throw new Error(response?.error || 'The extension did not respond. Reload it from chrome://extensions and try again.');
  return response.result;
}
async function scan(type = 'scan') {
  for (const button of buttons) button.disabled = true;
  document.getElementById('results').hidden = true;
  showMessage(type === 'scan-files' ? 'Reading this site’s own script files…' : 'Reading exposed libraries…');
  try { renderReport(await request(type)); }
  catch (error) { document.getElementById('host').textContent = 'Inspection unavailable'; showMessage(error.message, true); }
  finally { for (const button of buttons) button.disabled = false; }
}
scanButton.addEventListener('click', () => scan());
filesButton.addEventListener('click', () => scan('scan-files'));
reloadButton.addEventListener('click', async () => {
  for (const button of buttons) button.disabled = true;
  document.getElementById('results').hidden = true;
  try {
    await request('reload-headers');
    showMessage('Page reloading. When it finishes, open rustline.dev again or press Scan again to see the response headers.');
  } catch (error) { showMessage(error.message, true); }
  finally { for (const button of buttons) button.disabled = false; }
});
void scan();
