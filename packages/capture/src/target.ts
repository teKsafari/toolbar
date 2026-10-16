// TargetRef for an element: selector, tag, role, accessible name, text, test id, a few
// attributes for the action row's pseudo tag (J-067), landmarks and the nearest heading
// (Part 2 locator packet). Values of masked fields never appear (J-187).
import type { MaskingPreset, Rect, TargetRef } from '@toolbar/shared';
import { MASKED_TYPING, isMaskedField, scrubText } from '@toolbar/shared/redact';

const TEXT_MAX = 120;
const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
const PSEUDO_ATTRS = ['type', 'name', 'href', 'role', 'aria-label', 'title', 'placeholder', 'alt', 'value', 'for'];

const IMPLICIT_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  form: 'form',
  dialog: 'dialog',
  img: 'img',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (t === 'checkbox' || t === 'radio') return t;
    if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
    if (t === 'range') return 'slider';
    return 'textbox';
  }
  return IMPLICIT_ROLE[tag];
}

function clean(s: string | null | undefined, max = TEXT_MAX): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? scrubText(t.length > max ? t.slice(0, max) : t) : undefined;
}

export function accessibleName(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (t.trim()) return clean(t);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const id = el.getAttribute('id');
    const label = (id && el.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`)) || el.closest('label');
    if (label) return clean(label.textContent);
    return clean(el.getAttribute('placeholder') ?? el.getAttribute('title'));
  }
  if (tag === 'img') return clean(el.getAttribute('alt'));
  return clean((el as HTMLElement).innerText ?? el.textContent) ?? clean(el.getAttribute('title'));
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`);
}

/**
 * Ids a framework generates per render: React's useId (`:r1:` in React 18, `«r1»` and `_r_1p_` in
 * 19), and the libraries that build on it (`radix-:r2:`). They change between loads, so a selector
 * built on one stops matching (seen on Nuru, Next.js 15, D-185).
 */
export function generatedId(id: string): boolean {
  return /[:«]r[0-9a-z]+[:»]/i.test(id) || /^_r_[0-9a-z]+_$/i.test(id);
}

/** Short unique-ish CSS selector: id, test id, or a tag/nth-of-type path up to 5 levels. */
export function selectorOf(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur.nodeType === 1 && depth < 6; depth++) {
    const tag = cur.tagName.toLowerCase();
    const id = cur.getAttribute('id');
    if (id && !/\d{3,}|^[0-9]/.test(id) && !generatedId(id)) {
      parts.unshift(`#${cssEscape(id)}`);
      break;
    }
    const testAttr = TEST_ID_ATTRS.find((a) => cur!.hasAttribute(a));
    if (testAttr) {
      parts.unshift(`${tag}[${testAttr}="${cur.getAttribute(testAttr)}"]`);
      break;
    }
    let part = tag;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    if (tag === 'body' || tag === 'html') break;
    cur = parent;
  }
  const sel = parts.join(' > ');
  try {
    if (doc.querySelectorAll(sel).length === 1) return sel;
  } catch {
    /* fall through */
  }
  return sel;
}

function landmarksOf(el: Element): string[] | undefined {
  const out: string[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const r = roleOf(p);
    if (r && ['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'dialog', 'region', 'search'].includes(r)) {
      const name = p.getAttribute('aria-label') ?? undefined;
      out.push(name ? `${r}:${name}` : r);
    }
  }
  return out.length ? out : undefined;
}

function headingOf(el: Element): string | undefined {
  const scope = el.closest('section, article, dialog, [role=dialog], main, form') ?? el.ownerDocument.body;
  const h = scope?.querySelector('h1, h2, h3, h4, h5, h6');
  return h ? clean(h.textContent, 80) : undefined;
}

/** Origin and path of the link around an element that is not a link itself (D-188). */
function linkOf(el: Element): string | undefined {
  if (el.tagName.toLowerCase() === 'a') return undefined;
  const a = el.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return undefined;
  try {
    // origin and path only: a query string can carry a token
    const u = new URL(a.href || a.getAttribute('href') || '', el.ownerDocument.baseURI);
    return (u.origin === 'null' ? u.protocol + u.pathname : u.origin + u.pathname).slice(0, 2000);
  } catch {
    return undefined;
  }
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const sx = win?.scrollX ?? 0;
  const sy = win?.scrollY ?? 0;
  return { x: Math.round(r.x + sx), y: Math.round(r.y + sy), w: Math.round(r.width), h: Math.round(r.height) };
}

/** Text masked the way rrweb masks it: every non-space character becomes `*`. */
export function maskText(s: string): string {
  return s.replace(/\S/g, '*');
}

export interface DescribeOptions {
  preset?: MaskingPreset;
  frame?: string;
}

/** TargetRef for a DOM node (text nodes describe their parent). Never throws. */
export function describeNode(node: Node | null | undefined, opts: DescribeOptions = {}): TargetRef | null {
  try {
    if (!node) return null;
    const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
    if (!el || typeof el.getAttribute !== 'function') return null;
    const tag = el.tagName.toLowerCase();
    const field = { tag, type: el.getAttribute('type') ?? undefined, name: el.getAttribute('name') ?? undefined, id: el.id || undefined, autocomplete: el.getAttribute('autocomplete') ?? undefined };
    const masked = (tag === 'input' || tag === 'textarea') && isMaskedField(field, opts.preset);
    const attrs: Record<string, string> = {};
    for (const a of PSEUDO_ATTRS) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      attrs[a] = a === 'value' && masked ? MASKED_TYPING : (clean(v, 200) ?? '');
    }
    if (tag === 'button' && !el.hasAttribute('type')) attrs.type = 'submit'; // J-067: default button type
    for (const a of TEST_ID_ATTRS) if (el.hasAttribute(a)) attrs[a] = el.getAttribute(a)!;
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => c && !/^svelte-/.test(c)).slice(0, 8) : [];
    const testAttr = TEST_ID_ATTRS.find((a) => el.hasAttribute(a));
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    const text = isField ? undefined : clean((el as HTMLElement).innerText ?? el.textContent);
    // production preset (D-125): page text is masked; structure (tag, role, test id, classes) stays
    if (opts.preset === 'production') {
      const ref: TargetRef = { selector: selectorOf(el), tag, rect: rectOf(el) };
      const role = roleOf(el);
      if (role) ref.role = role;
      const t = isField ? undefined : clean((el as HTMLElement).innerText ?? el.textContent);
      if (t) ref.text = maskText(t);
      const n = accessibleName(el);
      if (n) ref.name = maskText(n);
      if (testAttr) ref.testId = el.getAttribute(testAttr)!;
      if (el.id) ref.elId = el.id;
      if (cls.length) ref.classes = cls;
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(attrs)) kept[k] = k === 'type' || k === 'role' || (TEST_ID_ATTRS as readonly string[]).includes(k) ? v : k === 'value' ? MASKED_TYPING : maskText(v);
      if (Object.keys(kept).length) ref.attrs = kept;
      if (opts.frame) ref.frame = opts.frame;
      return ref;
    }
    const ref: TargetRef = {
      selector: selectorOf(el),
      tag,
      rect: rectOf(el),
    };
    const role = roleOf(el);
    if (role) ref.role = role;
    const name = masked ? clean(el.getAttribute('aria-label')) : accessibleName(el);
    if (name) ref.name = name;
    if (text) ref.text = text;
    if (testAttr) ref.testId = el.getAttribute(testAttr)!;
    if (el.id) ref.elId = el.id;
    if (cls.length) ref.classes = cls;
    if (Object.keys(attrs).length) ref.attrs = attrs;
    const link = linkOf(el);
    if (link) ref.link = link;
    const lm = landmarksOf(el);
    if (lm) ref.landmarks = lm;
    const heading = headingOf(el);
    if (heading) ref.heading = heading;
    if (opts.frame) ref.frame = opts.frame;
    return ref;
  } catch {
    return null;
  }
}
