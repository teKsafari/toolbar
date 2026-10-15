// `dom` summaries (architecture s4): every 100 ms with changes, counts of added and removed
// nodes, attribute and text changes, and up to five changed-region rects. Cheap signal for
// Part 2 span outcomes and keyframe bursts. Mutations inside the toolbar host are ignored.
// With `texts` on, each summary also carries up to five scrubbed snippets of the changed text,
// so a trace can tell an error message from a success message (packages/trace).
import type { DomSummary, Rect } from '@toolbar/shared';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { scrubText } from '@toolbar/shared/redact';

export interface DomObserveOptions {
  /** Include changed text snippets (off under the production masking preset). */
  texts?: () => boolean;
}

const SNIPPET = 80;

function snippet(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > SNIPPET ? t.slice(0, SNIPPET - 3) + '...' : t;
}

export function observeDom(emit: (d: DomSummary) => void, win: Window & typeof globalThis = window, intervalMs = 100, opts: DomObserveOptions = {}) {
  let acc: DomSummary = { added: 0, removed: 0, attrs: 0, text: 0, rects: [] };
  const els = new Set<Element>();
  /** nodes whose text to report: changed text nodes and added elements */
  const textNodes = new Set<Node>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!acc.added && !acc.removed && !acc.attrs && !acc.text) return;
    const rects: Rect[] = [];
    for (const el of els) {
      if (rects.length >= 5) break;
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push({ x: Math.round(r.x + win.scrollX), y: Math.round(r.y + win.scrollY), w: Math.round(r.width), h: Math.round(r.height) });
    }
    acc.rects = rects;
    if (opts.texts?.()) {
      const texts: string[] = [];
      for (const n of textNodes) {
        if (texts.length >= 5) break;
        if (!n.isConnected) continue;
        const parent = n.nodeType === 1 ? (n as Element) : n.parentElement;
        if (parent && /^(script|style|noscript|template)$/i.test(parent.tagName)) continue;
        const t = snippet(scrubText(n.textContent ?? '', { emails: true }));
        if (t && !texts.includes(t)) texts.push(t);
      }
      acc.texts = texts;
    }
    const out = acc;
    acc = { added: 0, removed: 0, attrs: 0, text: 0, rects: [] };
    els.clear();
    textNodes.clear();
    emit(out);
  };

  const ours = (n: Node) => {
    const el = (n.nodeType === 1 ? n : n.parentElement) as Element | null;
    return !!el && (el.tagName?.toLowerCase() === UI_HOST_TAG || !!el.closest?.(UI_HOST_TAG));
  };

  const mo = new win.MutationObserver((records) => {
    for (const r of records) {
      if (ours(r.target)) continue;
      if (r.type === 'childList') {
        acc.added += r.addedNodes.length;
        acc.removed += r.removedNodes.length;
        if (textNodes.size < 20) for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1 || n.nodeType === 3) textNodes.add(n);
      } else if (r.type === 'attributes') acc.attrs++;
      else if (r.type === 'characterData') {
        acc.text++;
        if (textNodes.size < 20) textNodes.add(r.target);
      }
      const el = (r.target.nodeType === 1 ? r.target : r.target.parentElement) as Element | null;
      if (el && els.size < 20) els.add(el);
    }
    timer ??= setTimeout(flush, intervalMs);
  });
  const start = () => mo.observe(win.document.documentElement ?? win.document, { childList: true, subtree: true, attributes: true, characterData: true });
  if (win.document.documentElement) start();
  else win.document.addEventListener('readystatechange', start, { once: true });
  return {
    flush,
    stop() {
      mo.disconnect();
      if (timer) clearTimeout(timer);
    },
  };
}
