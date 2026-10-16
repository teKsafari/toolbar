// One-time microphone grant (J-014, J-200). Offscreen documents cannot show the permission
// prompt, so this extension page asks once; the grant then covers the offscreen recorder.
// With no microphone the page closes itself and the mic stays off.
import { browser } from 'wxt/browser';
import '@toolbar/ui/fonts.css';
import '@toolbar/ui/tokens.css';
import './style.css';

const status = document.getElementById('status')!;

async function run() {
  let granted = false;
  let deviceCount = 0;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    granted = true;
    deviceCount = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').length;
    status.textContent = 'Microphone ready. You can close this tab.';
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    // without a grant Chrome still lists one entry per kind when a device exists
    deviceCount = name === 'NotFoundError' ? 0 : (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput').length;
    status.textContent = name === 'NotFoundError' ? 'No microphone found.' : 'Microphone blocked. You can allow it later in the site settings of this page.';
  }
  await browser.runtime.sendMessage({ type: 'mic.result', granted, deviceCount }).catch(() => {});
  if (granted || deviceCount === 0) setTimeout(() => window.close(), granted ? 600 : 0);
}

void run();
