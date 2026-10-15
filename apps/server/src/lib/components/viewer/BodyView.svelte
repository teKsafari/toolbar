<script lang="ts">
  // Request and response bodies (J-060): line numbers, fold toggles on objects and arrays,
  // colours per token, a pretty or raw switch and a copy button. Text that is not JSON shows
  // as plain numbered lines.
  import { toasts } from '@toolbar/ui';
  import VIcon from './VIcon.svelte';
  import { copyText } from './api.ts';

  interface Props {
    text: string;
    testid?: string;
  }
  let { text, testid }: Props = $props();

  type Tok = { t: 'key' | 'str' | 'num' | 'lit' | 'p'; v: string };
  type Line = { depth: number; toks: Tok[]; end: number | null; close: string };

  let pretty = $state(true);
  let folded = $state(new Set<number>());

  const parsed = $derived.by(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const, value: null };
    }
  });

  function build(value: unknown): Line[] {
    const lines: Line[] = [];
    const scalar = (v: unknown): Tok => (typeof v === 'string' ? { t: 'str', v: JSON.stringify(v) } : typeof v === 'number' ? { t: 'num', v: String(v) } : { t: 'lit', v: String(v) });
    const walk = (v: unknown, depth: number, lead: Tok[], comma: boolean) => {
      const tail: Tok[] = comma ? [{ t: 'p', v: ',' }] : [];
      if (v !== null && typeof v === 'object') {
        const arr = Array.isArray(v);
        const entries = arr ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
        const [open, close] = arr ? ['[', ']'] : ['{', '}'];
        if (!entries.length) {
          lines.push({ depth, toks: [...lead, { t: 'p', v: open + close }, ...tail], end: null, close: '' });
          return;
        }
        const at = lines.length;
        lines.push({ depth, toks: [...lead, { t: 'p', v: open }], end: null, close: `${close}${comma ? ',' : ''}` });
        entries.forEach(([k, x], i) => walk(x, depth + 1, arr ? [] : [{ t: 'key', v: JSON.stringify(k) }, { t: 'p', v: ': ' }], i < entries.length - 1));
        lines.push({ depth, toks: [{ t: 'p', v: close }, ...tail], end: null, close: '' });
        lines[at]!.end = lines.length - 1;
        return;
      }
      lines.push({ depth, toks: [...lead, scalar(v), ...tail], end: null, close: '' });
    };
    walk(value, 0, [], false);
    return lines;
  }

  const lines = $derived<Line[]>(
    parsed.ok && pretty ? build(parsed.value) : (parsed.ok ? JSON.stringify(parsed.value) : text).split('\n').map((l) => ({ depth: 0, toks: [{ t: 'p', v: l }], end: null, close: '' })),
  );
  /** Line indexes to draw: a folded line hides everything up to its closing line. */
  const shown = $derived.by(() => {
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      out.push(i);
      const end = lines[i]!.end;
      if (end !== null && folded.has(i)) i = end;
    }
    return out;
  });

  function fold(i: number) {
    const s = new Set(folded);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    folded = s;
  }
  async function copy() {
    if (await copyText(parsed.ok && pretty ? JSON.stringify(parsed.value, null, 2) : text)) toasts.success('Body copied');
    else toasts.error('Could not copy');
  }
</script>

<div class="bv" data-testid={testid}>
  <div class="tools">
    {#if parsed.ok}
      <div class="seg" role="radiogroup" aria-label="Body format">
        <button type="button" role="radio" aria-checked={pretty} class:on={pretty} onclick={() => (pretty = true)} data-testid="body-pretty">Pretty</button>
        <button type="button" role="radio" aria-checked={!pretty} class:on={!pretty} onclick={() => (pretty = false)} data-testid="body-raw">Raw</button>
      </div>
    {/if}
    <button type="button" class="copy" onclick={copy} aria-label="Copy body" title="Copy body" data-testid="body-copy"><VIcon name="copy" size={13} /></button>
  </div>
  <ol class="code" class:wrap={!pretty || !parsed.ok}>
    {#each shown as i (i)}
      {@const l = lines[i]!}
      <li>
        <span class="ln">{i + 1}</span>
        <span class="fold">
          {#if l.end !== null}
            <button type="button" onclick={() => fold(i)} aria-expanded={!folded.has(i)} aria-label={folded.has(i) ? 'Expand' : 'Collapse'} data-testid="body-fold"><VIcon name={folded.has(i) ? 'chevron-right' : 'chevron-down'} size={11} /></button>
          {/if}
        </span>
        <span class="src" style:padding-left="{l.depth * 2}ch">{#each l.toks as tk, j (j)}<span class="tk-{tk.t}">{tk.v}</span>{/each}{#if l.end !== null && folded.has(i)}<span class="more">...</span><span class="tk-p">{l.close}</span>{/if}</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .bv { position: relative; }
  .tools { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-bottom: 4px; font-family: var(--nb-font-sans); }
  .seg { display: inline-flex; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-sm); overflow: hidden; }
  .seg button { all: unset; padding: 2px 8px; font-size: var(--nb-text-xs); color: var(--nb-text-muted); cursor: pointer; }
  .seg button.on { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .copy { all: unset; display: grid; place-items: center; width: 24px; height: 22px; border-radius: var(--nb-radius-sm); color: var(--nb-text-muted); cursor: pointer; }
  .copy:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .code { list-style: none; margin: 0; padding: 0; }
  .code li { display: grid; grid-template-columns: 3ch 14px minmax(0, 1fr); column-gap: 4px; line-height: 18px; }
  .ln { color: var(--nb-text-faint); text-align: right; user-select: none; }
  .fold button { all: unset; display: grid; place-items: center; width: 14px; height: 18px; color: var(--nb-text-faint); cursor: pointer; }
  .fold button:hover { color: var(--nb-text); }
  .src { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .wrap .src { white-space: pre-wrap; overflow-wrap: anywhere; }
  .tk-key { color: var(--nb-accent-text); }
  .tk-str { color: var(--nb-success); }
  .tk-num { color: var(--nb-warning); }
  .tk-lit { color: var(--nb-danger); }
  .tk-p { color: var(--nb-text-muted); }
  .more { margin: 0 2px; padding: 0 4px; border-radius: 4px; background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
</style>
