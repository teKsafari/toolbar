// Component styles of the embed's shadow root, as constructed style sheets (adoptedStyleSheets),
// so a site whose CSP has no 'unsafe-inline' for styles still renders the toolbar. The build
// compiles Svelte with css: 'injected' and swaps Svelte's append_styles (which adds <style>
// elements) for registerCss below (svelte-client.ts, vite.config.ts).

const styles = new Map<string, string>();
const roots = new Set<ShadowRoot>();
const sheets = new WeakMap<ShadowRoot, Set<string>>();

function adopt(root: ShadowRoot, hash: string, code: string) {
  const have = sheets.get(root) ?? new Set<string>();
  sheets.set(root, have);
  if (have.has(hash)) return;
  have.add(hash);
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(code);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    /* very old browser: unstyled but usable */
  }
}

/** A component's styles, once per hash, into every root that holds the toolbar. */
export function registerCss(hash: string, code: string): void {
  if (styles.has(hash)) return;
  styles.set(hash, code);
  for (const r of roots) adopt(r, hash, code);
}

/** The shadow root the toolbar mounts in: every style so far, and those of components mounted later. */
export function adoptStyles(root: ShadowRoot, base = ''): void {
  roots.add(root);
  if (base) adopt(root, 'tb-base', base);
  for (const [hash, code] of styles) adopt(root, hash, code);
}
