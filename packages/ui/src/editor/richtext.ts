// The draft's one rich-text field (J-077, J-078): first block is the title, the rest is the
// description, stored as Markdown (bold, italics, bullet and numbered lists, one line per block).

export interface TitleAndBody {
  title: string;
  description: string;
}

const BLOCKS = new Set(['DIV', 'P', 'UL', 'OL', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE']);

function inlineMd(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/ /g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  const inner = Array.from(el.childNodes).map(inlineMd).join('');
  const wrap = (m: string) => {
    if (!inner.trim()) return inner;
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.match(/\s*$/)![0];
    return `${lead}${m}${inner.trim()}${m}${trail}`;
  };
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      return wrap('**');
    case 'I':
    case 'EM':
      return wrap('*');
    case 'CODE':
      return wrap('`');
    case 'SPAN':
      if (/font-weight:\s*(bold|[6-9]00)/.test(el.getAttribute('style') ?? '')) return wrap('**');
      return inner;
    default:
      return inner;
  }
}

/** Text of a block with a trailing <br> (an empty line placeholder) removed. */
function blockText(el: Node): string {
  return inlineMd(el).replace(/\n$/, '');
}

function listLines(list: HTMLElement): string[] {
  const ordered = list.tagName === 'OL';
  let n = 0;
  const out: string[] = [];
  for (const li of Array.from(list.children)) {
    if (li.tagName !== 'LI') continue;
    n++;
    out.push(`${ordered ? `${n}.` : '-'} ${blockText(li).replace(/\n/g, ' ')}`);
  }
  return out;
}

/** Split the editable root into blocks: inline runs at the top level count as one block. */
function blocksOf(root: HTMLElement): Node[] {
  const out: Node[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const span = root.ownerDocument.createElement('div');
    for (const n of run) span.appendChild(n.cloneNode(true));
    out.push(span);
    run = [];
  };
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === 1 && BLOCKS.has((n as HTMLElement).tagName)) {
      flush();
      out.push(n);
    } else if (n.nodeType === 1 && (n as HTMLElement).tagName === 'BR') {
      run.push(n);
      flush();
    } else run.push(n);
  }
  flush();
  return out;
}

export function fieldToDraft(root: HTMLElement): TitleAndBody {
  const blocks = blocksOf(root);
  if (!blocks.length) return { title: '', description: '' };
  const [first, ...rest] = blocks;
  const title = (first!.textContent ?? '').replace(/ /g, ' ').trim();
  const lines: string[] = [];
  for (const b of rest) {
    const el = b as HTMLElement;
    if (el.tagName === 'UL' || el.tagName === 'OL') lines.push(...listLines(el));
    else lines.push(...blockText(el).split('\n'));
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  return { title, description: lines.join('\n') };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inlineHtml(md: string): string {
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** HTML for the editable field from a stored title and Markdown description. */
export function draftToHtml(title: string, description: string): string {
  const parts = [`<div>${title ? esc(title) : '<br>'}</div>`];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (list) parts.push(`<${list.tag}>${list.items.map((i) => `<li>${i || '<br>'}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const line of description ? description.split('\n') : []) {
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flush();
        list = { tag, items: [] };
      }
      list.items.push(inlineHtml((ul ?? ol)![1]!));
    } else {
      flush();
      parts.push(`<div>${line.trim() ? inlineHtml(line) : '<br>'}</div>`);
    }
  }
  flush();
  return parts.join('');
}

/** Markdown input rule for the start of a block: "- " or "* " -> bullets, "1. " -> numbers. */
export function listRuleFor(text: string): 'ul' | 'ol' | null {
  const t = text.replace(/ /g, ' ');
  if (t === '- ' || t === '* ') return 'ul';
  if (/^\d+\. $/.test(t)) return 'ol';
  return null;
}

/** Plain text of an AI draft as the field's Markdown (title line plus description). */
export function aiToMarkdown(ai: { title: string; summary: string; steps: { text: string; tMs: number | null }[]; result: string }, clock: (ms: number) => string): TitleAndBody {
  const lines: string[] = [];
  if (ai.summary) lines.push(ai.summary);
  if (ai.steps.length) {
    lines.push('', '**Steps to reproduce**');
    ai.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.text}${s.tMs != null ? ` (${clock(s.tMs)})` : ''}`));
  }
  if (ai.result) lines.push('', `**Result:** ${ai.result}`);
  return { title: ai.title, description: lines.join('\n').trim() };
}
