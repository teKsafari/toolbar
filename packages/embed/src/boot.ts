// The script tag's settings (D-211):
//   <script src="https://toolbar.example.com/embed.js" data-key="tbk_..."></script>
// The server is the origin the script came from; data-name and data-email name the reviewer.
import type { InitOptions } from './init.ts';

export function scriptConfig(script: Element | null | undefined, base = typeof location === 'undefined' ? undefined : location.href): InitOptions | null {
  if (!script || script.localName !== 'script') return null;
  const s = script as HTMLScriptElement;
  const key = s.getAttribute('data-key')?.trim();
  const src = s.getAttribute('src');
  if (!key || !src) return null;
  let server: string;
  try {
    const u = new URL(src, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    server = u.origin;
  } catch {
    return null;
  }
  const name = s.getAttribute('data-name')?.trim();
  const email = s.getAttribute('data-email')?.trim();
  return { key, server, ...(name || email ? { user: { ...(name ? { name } : {}), ...(email ? { email } : {}) } } : {}) };
}
