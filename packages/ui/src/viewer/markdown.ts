// Small, safe Markdown renderer for capture descriptions and comments. Everything is escaped
// first; only these constructs become markup: paragraphs, "- " and "1. " lists, **bold**,
// *italic*, `code`, [text](https://...) links, bare http(s) URLs, mentions written
// @[Name](user:<uuid>) and time links [0:12](t:12000) that seek the player (J-111).

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MENTION = /@\[([^\]]{1,80})\]\(user:([0-9a-f-]{36})\)/g;

/** Member ids mentioned in a text. */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[2]!))];
}

/** Text with mentions shown as @Name (for emails and plain previews). */
export function plainText(text: string): string {
  return text.replace(MENTION, '@$1').replace(/\[([^\]]+)\]\(t:\d+\)/g, '$1');
}

function inline(src: string): string {
  // Pull out tokens before escaping so their URLs survive intact.
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = src
    .replace(/`([^`]+)`/g, (_, c: string) => keep(`<code>${esc(c)}</code>`))
    .replace(MENTION, (_, name: string, id: string) => keep(`<span class="nb-mention" data-user="${esc(id)}">@${esc(name)}</span>`))
    .replace(/\[([^\]]+)\]\(t:(\d+)\)/g, (_, label: string, ms: string) => keep(`<button type="button" class="nb-timelink" data-seek="${Number(ms)}">${esc(label)}</button>`))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`))
    .replace(/\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, (url) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url)}</a>`));
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]!);
}

export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}

const FIGMA = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[A-Za-z0-9]+[^\s)<>]*/;

/** First public Figma link in a text (J-116). */
export function figmaLink(text: string): string | null {
  return text.match(FIGMA)?.[0] ?? null;
}

export function figmaEmbedUrl(link: string): string {
  return `https://www.figma.com/embed?embed_host=open-toolbar&url=${encodeURIComponent(link)}`;
}
