<script lang="ts">
  // Title and description in one field (J-077), Markdown-style input rules (J-078), and the AI
  // ghost text that Tab or a click into the ghost title accepts (J-083, J-230).
  import { onMount, tick } from 'svelte';
  import { aiToMarkdown, draftToHtml, fieldToDraft, listRuleFor, type TitleAndBody } from './richtext.ts';
  import { clock } from './trim.svelte.ts';
  import type { AiDraftText } from './types.ts';

  interface Props {
    value: TitleAndBody;
    ai?: AiDraftText | null;
    aiAccepted?: boolean;
    autofocus?: boolean;
    onchange?: (v: TitleAndBody) => void;
    onaccept?: () => void;
    onseek?: (ms: number) => void;
    onsubmit?: () => void;
  }
  let { value, ai = null, aiAccepted = false, autofocus = true, onchange, onaccept, onseek, onsubmit }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let ghostTitle: HTMLDivElement | undefined = $state();
  let empty = $state(true);

  const ghost = $derived(ai && !aiAccepted && empty ? ai : null);

  function refresh() {
    if (!el) return;
    const v = fieldToDraft(el);
    empty = !v.title && !v.description && !el.querySelector('li');
    onchange?.(v);
  }

  function setHtml(html: string) {
    el!.innerHTML = html;
    refresh();
  }

  onMount(() => {
    el!.innerHTML = draftToHtml(value.title, value.description);
    const v = fieldToDraft(el!);
    empty = !v.title && !v.description;
    if (autofocus) focus();
  });

  export function focus(atEnd = false) {
    if (!el) return;
    el.focus();
    const sel = el.ownerDocument.getSelection();
    const r = el.ownerDocument.createRange();
    r.selectNodeContents(atEnd ? el : (el.firstElementChild ?? el));
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  /** Accept the ghost text; with `caret`, put the caret at that offset of the title. */
  export async function accept(caret?: number) {
    if (!ai || !el) return;
    const md = aiToMarkdown(ai, clock);
    setHtml(draftToHtml(md.title, md.description));
    onaccept?.();
    await tick();
    el.focus();
    const titleText = el.firstChild?.firstChild;
    const sel = el.ownerDocument.getSelection();
    const r = el.ownerDocument.createRange();
    if (titleText && titleText.nodeType === 3 && caret !== undefined) {
      r.setStart(titleText, Math.min(caret, titleText.textContent!.length));
    } else {
      r.selectNodeContents(el);
      r.collapse(false);
    }
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function currentBlock(): HTMLElement | null {
    const sel = el?.ownerDocument.getSelection();
    let n: Node | null = sel?.anchorNode ?? null;
    while (n && n.parentNode !== el) n = n.parentNode;
    return n && n.nodeType === 1 ? (n as HTMLElement) : null;
  }

  function onInput(e: Event) {
    const ie = e as InputEvent;
    if (ie.inputType === 'insertText' && ie.data === ' ') {
      const block = currentBlock();
      if (block && block !== el!.firstElementChild && block.tagName === 'DIV') {
        const rule = listRuleFor(block.textContent ?? '');
        if (rule) {
          const list = el!.ownerDocument.createElement(rule);
          const li = el!.ownerDocument.createElement('li');
          li.appendChild(el!.ownerDocument.createElement('br'));
          list.appendChild(li);
          block.replaceWith(list);
          const r = el!.ownerDocument.createRange();
          r.setStart(li, 0);
          r.collapse(true);
          const sel = el!.ownerDocument.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }
    }
    // keep a block wrapper so the first line stays the title
    if (el && el.firstChild && el.firstChild.nodeType === 3) {
      const div = el.ownerDocument.createElement('div');
      el.insertBefore(div, el.firstChild);
      div.appendChild(div.nextSibling!);
      const r = el.ownerDocument.createRange();
      r.selectNodeContents(div);
      r.collapse(false);
      const sel = el.ownerDocument.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    refresh();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      onsubmit?.();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && ghost) {
      e.preventDefault();
      e.stopPropagation();
      void accept();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      // the title line stays plain text
      const block = currentBlock();
      if (block && block === el!.firstElementChild) return;
      el!.ownerDocument.execCommand(e.key === 'b' ? 'bold' : 'italic');
      refresh();
    }
    // keep editor shortcuts (tools, undo of shapes, Escape) away while typing, except Escape
    if (e.key !== 'Escape') e.stopPropagation();
  }

  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    el!.ownerDocument.execCommand('insertText', false, text);
  }

  function ghostTitleDown(e: MouseEvent) {
    e.preventDefault();
    const doc = el!.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let offset: number | undefined;
    const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
    if (pos && ghostTitle?.contains(pos.offsetNode)) offset = pos.offset;
    else {
      const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r && ghostTitle?.contains(r.startContainer)) offset = r.startOffset;
    }
    void accept(offset);
  }
</script>

<div class="nb-rf" data-testid="rich-field">
  <div
    bind:this={el}
    class="nb-rf-edit"
    class:nb-rf-empty={empty && !ghost}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    aria-label="Title and description"
    data-testid="field"
    data-placeholder-title="Add a title"
    data-placeholder-body="Describe what went wrong"
    oninput={onInput}
    onkeydown={onKey}
    onpaste={onPaste}
  ></div>
  {#if ghost}
    <div class="nb-rf-ghost" data-testid="ai-ghost">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="nb-rf-gtitle" bind:this={ghostTitle} onmousedown={ghostTitleDown} data-testid="ai-ghost-title">{ghost.title}</div>
      {#if ghost.summary}<p>{ghost.summary}</p>{/if}
      {#if ghost.steps.length}
        <ol>
          {#each ghost.steps as s, i (i)}
            <li>
              {s.text}
              {#if s.tMs != null}
                <button type="button" class="nb-rf-time" onmousedown={(e) => e.preventDefault()} onclick={() => onseek?.(s.tMs!)}>{clock(s.tMs)}</button>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
      {#if ghost.result}<p><b>Result:</b> {ghost.result}</p>{/if}
      <div class="nb-rf-hint"><kbd>Tab</kbd> to accept</div>
    </div>
  {/if}
</div>

<style>
  .nb-rf {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .nb-rf-edit {
    min-height: 100%;
    outline: none;
    font: var(--nb-text-base) / 1.55 var(--nb-font-sans);
    color: var(--nb-text);
    word-break: break-word;
    position: relative;
    z-index: 1;
  }
  .nb-rf-edit > :global(:first-child) {
    font-size: var(--nb-text-2xl);
    font-weight: var(--nb-weight-semibold);
    line-height: 1.3;
    margin-bottom: 6px;
  }
  .nb-rf-edit :global(ul),
  .nb-rf-edit :global(ol) {
    margin: 2px 0;
    padding-left: 22px;
  }
  .nb-rf-edit :global(code) {
    font: var(--nb-text-sm) var(--nb-font-mono);
    background: var(--nb-surface-sunken);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .nb-rf-empty::before {
    content: attr(data-placeholder-title);
    position: absolute;
    pointer-events: none;
    color: var(--nb-text-faint);
    font-size: var(--nb-text-2xl);
    font-weight: var(--nb-weight-semibold);
    line-height: 1.3;
  }
  .nb-rf-empty::after {
    content: attr(data-placeholder-body);
    position: absolute;
    top: 40px;
    left: 0;
    pointer-events: none;
    color: var(--nb-text-faint);
  }
  .nb-rf-ghost {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 2;
    color: var(--nb-text-faint);
    font: var(--nb-text-base) / 1.55 var(--nb-font-sans);
    pointer-events: none;
  }
  .nb-rf-gtitle {
    font-size: var(--nb-text-2xl);
    font-weight: var(--nb-weight-semibold);
    line-height: 1.3;
    margin-bottom: 6px;
    pointer-events: auto;
    cursor: text;
  }
  .nb-rf-ghost p {
    margin: 0 0 6px;
  }
  .nb-rf-ghost ol {
    margin: 0 0 6px;
    padding-left: 22px;
  }
  .nb-rf-time {
    all: unset;
    pointer-events: auto;
    cursor: pointer;
    color: var(--nb-accent-text);
    font: var(--nb-text-sm) var(--nb-font-mono);
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-left: 4px;
  }
  .nb-rf-hint {
    margin-top: 6px;
    font-size: var(--nb-text-sm);
  }
  .nb-rf-hint kbd {
    font: var(--nb-text-xs) var(--nb-font-mono);
    padding: 1px 5px;
    border: 1px solid var(--nb-border-strong);
    border-radius: 4px;
  }
</style>
