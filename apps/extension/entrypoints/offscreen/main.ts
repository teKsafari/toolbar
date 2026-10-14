// Offscreen document: MediaRecorder for tab video, screen video and mic (architecture section 10).
// One document exists per extension, so recorders are multiplexed by recording id.
// The media area agent fills in record-tab / record-screen / stop (see docs/spikes.md S1, S2).
import { browser } from 'wxt/browser';
import type { OffscreenRequest } from '../../lib/messages';

const recorders = new Map<string, MediaRecorder>();

browser.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, reply) => {
  if (msg?.to !== 'offscreen') return false;
  switch (msg.type) {
    case 'ping':
      reply({ ok: true, recorders: recorders.size });
      return true;
    default:
      reply({ ok: false, error: 'not_implemented' });
      return true;
  }
});
