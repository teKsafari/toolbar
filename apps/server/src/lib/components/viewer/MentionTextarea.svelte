<script lang="ts">
  import { focusNow } from '#lib/components/focus.ts';
  /** autofocus that works when a click opened the field (J-163) */
  const maybeFocus = (node: HTMLElement, on: boolean) => (on ? focusNow(node) : undefined);
  // Textarea with an @ member picker (J-135). Arrow keys move, Enter or Tab picks, Escape closes.
  import type { MentionDraft } from './mentions.svelte.ts';
  import Avatar from './Avatar.svelte';

  interface Props {
    draft: MentionDraft;
    members: { id: string; name: string; email: string }[];
    placeholder?: string;
    rows?: number;
    label: string;
    autofocus?: boolean;
    el?: HTMLTextAreaElement;
    onkeydown?: (e: KeyboardEvent) => void;
    onblur?: (e: FocusEvent) => void;
    onfocus?: () => void;
    onpaste?: (e: ClipboardEvent) => void;
    testid?: string;
  }
  let { draft, members, placeholder, rows = 1, label, autofocus = false, el = $bindable(), onkeydown, onblur, onfocus, onpaste, testid }: Props = $props();

  let query: string | null = $state(null);
  let active = $state(0);
  const matches = $derived(
    query === null ? [] : members.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(query!.toLowerCase())).slice(0, 6),
  );

  function detect() {
    if (!el || !members.length) return (query = null);
    const before = el.value.slice(0, el.selectionStart ?? 0);
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
    query = m ? m[2]! : null;
    active = 0;
  }
  function pick(m: { id: string; name: string }) {
    if (!el) return;
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos).replace(/@([^\s@]{0,30})$/, `@${m.name} `);
    const after = el.value.slice(pos);
    draft.pick(m.name, m.id);
    draft.text = before + after;
    query = null;
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
      autosize();
    });
  }
  function keys(e: KeyboardEvent) {
    if (query !== null && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
        return;
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        query = null;
        return;
      }
    }
    onkeydown?.(e);
  }
  function autosize() {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }
  $effect(() => {
    void draft.text;
    queueMicrotask(autosize);
  });
</script>

<div class="wrap">
  <textarea
    bind:this={el}
    bind:value={draft.text}
    {placeholder}
    {rows}
    use:maybeFocus={autofocus}
    aria-label={label}
    oninput={() => { detect(); autosize(); }}
    onclick={detect}
    onkeydown={keys}
    onkeyup={(e) => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') detect(); }}
    onblur={(e) => { setTimeout(() => (query = null), 150); onblur?.(e); }}
    {onfocus}
    {onpaste}
    data-testid={testid}></textarea>
  {#if query !== null && matches.length}
    <div class="picker" role="listbox" aria-label="Mention a member" data-testid="mention-picker">
      {#each matches as m, i (m.id)}
        <button type="button" role="option" aria-selected={i === active} class:on={i === active} onpointerdown={(e) => { e.preventDefault(); pick(m); }}>
          <Avatar name={m.name} size={20} /><span class="n">{m.name}</span><span class="e">{m.email}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; min-width: 0; display: flex; }
  /* the composer around it shows the focus, so the field itself has neither border nor ring */
  textarea, textarea:focus-visible { flex: 1; min-width: 0; resize: none; border: 0; outline: none; box-shadow: none; background: transparent; color: var(--nb-text); font: inherit; line-height: 1.45; padding: 6px 0; max-height: 240px; }
  .picker { position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 30; min-width: 260px; padding: 6px; border-radius: var(--nb-radius-lg); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); display: flex; flex-direction: column; }
  .picker button { all: unset; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--nb-radius-sm); cursor: pointer; font-size: var(--nb-text-md); }
  .picker button.on, .picker button:hover { background: var(--nb-accent-tint); }
  .n { font-weight: 500; }
  .e { margin-left: auto; color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .picker button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
</style>
