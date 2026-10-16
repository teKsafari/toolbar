<script lang="ts">
  import { focusNow } from '#lib/components/focus.ts';
  // Title and description under the media (J-110, J-111, J-116, J-135): click the title, type,
  // Enter saves and the tab title follows; the description saves on blur, keeps lists and bold,
  // takes @mentions, and its time links seek the player. Read-only for share viewers.
  import { toasts } from '@toolbar/ui';
  import { page } from '$app/state';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  import { figmaEmbedUrl, figmaLink, renderMarkdown } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Avatar from './Avatar.svelte';
  import MentionTextarea from './MentionTextarea.svelte';
  import { MentionDraft } from './mentions.svelte.ts';
  import { call } from './api.ts';
  import { useViewer } from './viewer.svelte.ts';
  import { relTime } from './time.ts';

  const v = useViewer();
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let editingDesc = $state(false);
  const desc = new MentionDraft();
  let descEl: HTMLTextAreaElement | undefined = $state();
  let figmaOpen = $state(false);
  const figma = $derived(figmaLink(v.detail.description));
  const shownTitle = $derived(v.detail.title || 'Untitled capture');

  $effect(() => {
    document.title = `${shownTitle} | ${brandName}`;
  });

  async function save(patch: { title?: string; description?: string }) {
    const before = { title: v.detail.title, description: v.detail.description };
    Object.assign(v.detail, patch);
    try {
      await call('captures.update', { id: v.detail.id }, patch);
    } catch (e) {
      Object.assign(v.detail, before);
      toasts.error(`Not saved: ${(e as Error).message}`);
    }
  }

  function startTitle() {
    if (!v.canEdit) return;
    titleDraft = v.detail.title;
    editingTitle = true;
  }
  function commitTitle() {
    if (!editingTitle) return;
    editingTitle = false;
    const t = titleDraft.trim();
    if (t !== v.detail.title) void save({ title: t });
  }
  function titleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle();
    } else if (e.key === 'Escape') editingTitle = false;
  }

  function startDesc(e: MouseEvent) {
    if (!v.canEdit) return;
    if ((e.target as HTMLElement).closest('a, button')) return;
    desc.load(v.detail.description);
    editingDesc = true;
    queueMicrotask(() => descEl?.focus());
  }
  function commitDesc() {
    if (!editingDesc) return;
    editingDesc = false;
    const md = desc.toMarkdown();
    if (md !== v.detail.description) void save({ description: md });
  }
  function descKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      editingDesc = false;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && descEl) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = descEl;
      const inner = value.slice(a, b) || 'bold';
      desc.text = `${value.slice(0, a)}**${inner}**${value.slice(b)}`;
      queueMicrotask(() => descEl?.setSelectionRange(a + 2, a + 2 + inner.length));
    }
  }
  function descClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-seek]');
    if (t) {
      e.preventDefault();
      v.seek(Number(t.dataset.seek));
      return;
    }
    startDesc(e);
  }
</script>

<div class="td">
  {#if editingTitle}
    <input class="title-in" bind:value={titleDraft} onkeydown={titleKey} onblur={commitTitle} aria-label="Title" use:focusNow maxlength="500" data-testid="title-input" />
  {:else}
    <h1 class="title" class:editable={v.canEdit} data-testid="title">
      {#if v.canEdit}
        <button type="button" class="tbtn" onclick={startTitle} title="Edit the title">{shownTitle}</button>
      {:else}{shownTitle}{/if}
    </h1>
  {/if}

  <div class="byline" data-testid="byline">
    {#if v.detail.author}<Avatar name={v.detail.author.name} image={v.detail.author.image} size={20} /><span class="who">{v.detail.author.name}</span>{/if}
    <span class="dim">{relTime(v.detail.createdAt)}</span>
    {#if v.detail.pageUrl}<span class="dim">·</span><a class="dim url" href={v.detail.pageUrl} target="_blank" rel="noopener noreferrer">{v.detail.pageUrl.replace(/^https?:\/\//, '')}</a>{/if}
  </div>

  {#if editingDesc}
    <div class="desc-edit">
      <MentionTextarea draft={desc} members={v.data.members} bind:el={descEl} label="Description" rows={3} placeholder="What happened? Type @ to mention someone." onkeydown={descKey} onblur={commitDesc} testid="description-input" />
    </div>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
    <div class="desc" class:editable={v.canEdit} class:nodesc={!v.detail.description} role={v.canEdit ? 'button' : undefined} onclick={descClick} data-testid="description" tabindex={v.canEdit ? 0 : undefined} onkeydown={(e) => { if (e.key === 'Enter' && v.canEdit && e.target === e.currentTarget) { desc.load(v.detail.description); editingDesc = true; queueMicrotask(() => descEl?.focus()); } }}>
      {#if v.detail.description}{@html renderMarkdown(v.detail.description)}{:else if v.canEdit}<span class="ph">Add a description. Type @ to mention someone.</span>{/if}
    </div>
  {/if}

  {#if figma}
    <div class="figma">
      <button type="button" class="fbtn" onclick={() => (figmaOpen = !figmaOpen)} aria-expanded={figmaOpen} data-testid="figma-toggle"><VIcon name="figma" size={16} />{figmaOpen ? 'Hide Figma design' : 'Show Figma design'}</button>
      {#if figmaOpen}
        <iframe title="Figma design" src={figmaEmbedUrl(figma)} allowfullscreen loading="lazy" data-testid="figma-embed"></iframe>
      {/if}
    </div>
  {/if}
</div>

<style>
  .td { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px; }
  /* a page title: Nunito 500 with the site's tight tracking */
  .title { margin: 0; font: var(--nb-weight-medium) var(--nb-text-3xl) / 1.25 var(--nb-font-display); letter-spacing: var(--nb-tracking-tight); word-break: break-word; text-wrap: balance; }
  .tbtn { all: unset; cursor: text; border-radius: 6px; padding: 0 4px; margin: 0 -4px; }
  .tbtn:hover { background: var(--nb-surface-sunken); }
  .tbtn:focus-visible { outline: 2px solid var(--nb-focus); }
  .title-in { font: var(--nb-weight-medium) var(--nb-text-3xl) / 1.25 var(--nb-font-display) !important; letter-spacing: var(--nb-tracking-tight); height: auto !important; padding: 0 4px !important; margin: 0 -5px; }
  .byline { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--nb-text-md); }
  .who { font-weight: 500; letter-spacing: var(--nb-tracking-ui); }
  .dim { color: var(--nb-text-muted); }
  .url { text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px; }
  .url:hover { text-decoration: underline; }
  .desc { padding: 6px 4px; margin: 0 -4px; border-radius: 6px; color: var(--nb-text-body); line-height: var(--nb-leading-relaxed); word-break: break-word; }
  .desc.editable { cursor: text; }
  .desc.editable:hover { background: var(--nb-surface-sunken); }
  .desc :global(p) { margin: 0 0 6px; }
  .desc :global(ul), .desc :global(ol) { margin: 0 0 6px; padding-left: 22px; }
  .desc :global(.nb-timelink) { all: unset; color: var(--nb-accent-text); font-family: var(--nb-font-mono); cursor: pointer; text-decoration: underline; }
  .desc :global(.nb-mention) { color: var(--nb-accent-text); font-weight: 500; }
  .desc :global(code) { font-family: var(--nb-font-mono); font-size: 0.92em; padding: 0 3px; border-radius: 4px; background: var(--nb-surface-sunken); }
  .ph { color: var(--nb-text-faint); }
  /* on the hover wash (surface-sunken) faint drops to 4.39:1, so it steps up to muted (D-181) */
  .desc.editable:hover .ph { color: var(--nb-text-muted); }
  .desc-edit { display: flex; padding: 2px 8px; border: 1px solid var(--nb-focus); border-radius: var(--nb-radius-md); background: var(--nb-surface); box-shadow: var(--nb-focus-ring); }
  .figma { display: flex; flex-direction: column; gap: 8px; }
  .fbtn { all: unset; align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--nb-border-strong); background: var(--nb-surface); font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); cursor: pointer; box-shadow: var(--nb-shadow-sm); }
  .fbtn:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  iframe { width: 100%; aspect-ratio: 16 / 10; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .desc :global(.nb-timelink:focus-visible) { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
  .fbtn:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
</style>
