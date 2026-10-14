// MAIN world, document_start, all frames. Registered at runtime by the service worker.
import { startMainWorld } from '@toolbar/capture/main';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main() {
    startMainWorld();
  },
});
