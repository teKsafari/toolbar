<script lang="ts">
  // J-158, J-159: thumbnail with the creator overlay, duration pill for videos, a chip for
  // recording-link captures, title (or a creator-based fallback) and relative time. Hover lifts
  // the card and swaps the overlay for a checkbox and a round copy-link button. The card is a real
  // link; in selection mode a click toggles it instead. Cards drag onto sidebar folders (J-166).
  import { toasts } from '@toolbar/ui';
  import type { CaptureSummary } from '@toolbar/shared/api';
  import { durationLabel, fallbackTitle, relativeTime } from '@toolbar/shared/areas/dashboard';
  import DIcon from './DIcon.svelte';
  import UserAvatar from './UserAvatar.svelte';
  import { copyText } from './api.ts';
  import { shell, DRAG_MIME } from './shell.svelte.ts';

  interface Props {
    c: CaptureSummary;
    selected: boolean;
    selecting: boolean;
    ontoggle: (id: string, shift: boolean) => void;
    dragIds: () => string[];
  }
  let { c, selected, selecting, ontoggle, dragIds }: Props = $props();
  const dur = $derived(c.kind === 'screenshot' || c.kind === 'feedback' ? null : durationLabel(c.durationMs));
  const title = $derived(fallbackTitle(c));

  async function copy(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (await copyText(c.url)) toasts.success('Link copied');
  }

  function click(e: MouseEvent) {
    if (selecting) {
      e.preventDefault();
      ontoggle(c.id, e.shiftKey);
    }
  }

  function dragstart(e: DragEvent) {
    const ids = dragIds();
    shell.dragging = ids;
    e.dataTransfer?.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer?.setData('text/uri-list', c.url);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    const chip = document.createElement('div');
    chip.textContent = ids.length > 1 ? `${ids.length} captures` : title;
    chip.style.cssText = 'position:fixed;top:-100px;left:-100px;padding:6px 10px;border-radius:999px;background:#25211c;color:#fff;font:600 12px system-ui;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(chip);
    e.dataTransfer?.setDragImage(chip, 10, 10);
    setTimeout(() => chip.remove(), 0);
  }
</script>

<a
  class="card"
  class:selected
  class:selecting
  href="/c/{c.id}"
  onclick={click}
  draggable="true"
  ondragstart={dragstart}
  ondragend={() => (shell.dragging = [])}
  data-testid="capture-card"
  data-id={c.id}
  aria-label={title}
>
  <div class="thumb">
    {#if c.thumbUrl}
      <img src={c.thumbUrl} alt="" loading="lazy" draggable="false" />
    {:else}
      <span class="ph"><DIcon name={c.kind === 'screenshot' || c.kind === 'feedback' ? 'image' : 'video'} size={28} /></span>
    {/if}
    {#if c.status !== 'ready'}<span class="state">{c.status === 'failed' ? 'Failed' : 'Processing'}</span>{/if}
    {#if c.recordingLinkId}<span class="chip" title={c.recordingLinkName ?? 'Recording link'}><DIcon name="link" size={12} />{c.recordingLinkName ?? 'Recording link'}</span>{/if}
    <span class="who">
      <UserAvatar name={c.author?.name ?? 'Guest'} image={c.author?.image ?? null} size={20} />
      <span>{c.author?.name ?? 'Guest'}</span>
    </span>
    <button
      class="check"
      role="checkbox"
      aria-checked={selected}
      aria-label="Select {title}"
      data-testid="card-check"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ontoggle(c.id, e.shiftKey);
      }}
    >{#if selected}<DIcon name="check" size={14} />{/if}</button>
    <button class="copy" aria-label="Copy link" title="Copy link" onclick={copy} data-testid="card-copy"><DIcon name="link" size={15} /></button>
    {#if dur}<span class="dur" data-testid="duration">{dur}</span>{/if}
  </div>
  <div class="meta">
    <span class="title">{title}</span>
    <time datetime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>{relativeTime(c.createdAt)}</time>
  </div>
</a>

<style>
  .card {
    display: flex; flex-direction: column; gap: 10px; color: var(--nb-text); text-decoration: none; border-radius: var(--nb-radius-lg);
  }
  /* the site's cards: no shadow, the edge strengthens on hover */
  .thumb {
    position: relative; aspect-ratio: 16 / 10; border-radius: var(--nb-radius-lg); overflow: hidden; background: var(--nb-surface-sunken);
    border: 1px solid var(--nb-border); transition: box-shadow var(--nb-dur-fast) var(--nb-ease-out), border-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .card:hover .thumb { border-color: var(--nb-border-strong); }
  .card:focus-visible { outline: none; }
  .card:focus-visible .thumb { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .selected .thumb { border-color: var(--nb-accent); box-shadow: 0 0 0 2px var(--nb-accent); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--nb-text-faint); }
  .who, .dur, .chip, .state {
    position: absolute; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--nb-radius-pill);
    background: rgb(11 11 11 / 0.66); color: #fafafa; font-size: var(--nb-text-xs); backdrop-filter: blur(6px);
  }
  .who { left: 8px; bottom: 8px; padding: 2px 8px 2px 2px; max-width: calc(100% - 70px); }
  .who span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dur { right: 8px; bottom: 8px; padding: 2px 7px; font-family: var(--nb-font-mono); font-variant-numeric: tabular-nums; }
  .chip { left: 8px; top: 8px; padding: 2px 8px; max-width: calc(100% - 60px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .state { right: 8px; top: 8px; padding: 2px 8px; }
  .check, .copy {
    all: unset; position: absolute; display: grid; place-items: center; cursor: pointer; opacity: 0;
    transition: opacity var(--nb-dur-fast);
  }
  .check {
    left: 8px; bottom: 8px; width: 20px; height: 20px; border-radius: 5px; border: 2px solid #fafafa; background: rgb(11 11 11 / 0.35); color: #fafafa;
  }
  .copy { right: 8px; top: 8px; width: 28px; height: 28px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .copy:hover { background: var(--nb-surface-sunken); }
  .card:hover .check, .card:hover .copy, .selecting .check, .check:focus-visible, .copy:focus-visible { opacity: 1; }
  .card:hover .who, .selecting .who { opacity: 0; }
  .selected .check { background: var(--nb-accent); border-color: var(--nb-accent); }
  .check:focus-visible, .copy:focus-visible { outline: 2px solid var(--nb-focus); }
  .card:hover .chip, .card:hover .state { opacity: 0; }
  @media (hover: none) { .check { opacity: 1; } .who { opacity: 0; } }
  .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 2px; }
  .title { font-weight: var(--nb-weight-medium); letter-spacing: var(--nb-tracking-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  time { flex: none; font-size: var(--nb-text-sm); font-variant-numeric: tabular-nums; color: var(--nb-text-faint); }
</style>
