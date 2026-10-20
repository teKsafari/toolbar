// Entry of dist/embed.js, the script tag build: one classic script the server serves at /embed.js.
// It reads its settings from its own tag while it runs (document.currentScript is null later).
import { scriptConfig } from './boot.ts';
import { init } from './init.ts';

try {
  const cfg = typeof document === 'undefined' ? null : scriptConfig(document.currentScript);
  if (cfg) init(cfg);
  else if (typeof document !== 'undefined') console.info('[open-toolbar] not started: the script tag needs data-key');
} catch {
  /* never break the page */
}
