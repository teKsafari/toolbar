<script lang="ts">
  // Local drafts list (J-218, J-035): one row per draft with a thumbnail, the page host and
  // its age, a view button and a trash icon. Trash turns into a red confirm button in place; a
  // second click deletes. View reopens the editor on the draft in the current tab.
  import { onMount } from 'svelte';
  import { Icon } from '@toolbar/ui';
  import { relativeAge } from '@toolbar/shared/areas/ext-ui';
  import { store } from '../lib/store.svelte';
  import { blobUrl } from '../lib/thumbs';
  import { send, errorText } from '../../capture.content/ui/send';
  import ScreenHead from '../lib/ScreenHead.svelte';

  let confirming: string | null = $state(null);
  let thumbs: Record<string, string | null> = $state({});
  let error = $state('');
  const drafts = $derived([...store.drafts].sort((a, b) => b.updatedAt - a.updatedAt));

  onMount(() => {
    for (const d of store.drafts) void blobUrl(d.thumbBlobId).then((u) => (thumbs[d.id] = u));
  });

  async function view(id: string) {
    const r = await send('draft.open', { draftId: id, tabId: store.context?.tabId ?? undefined });
    if (r.ok) window.close();
    else error = errorText(r);
  }
  async function trash(id: string) {
    if (confirming !== id) {
      confirming = id;
      return;
    }
    confirming = null;
    const r = await send('draft.discard', { draftId: id });
    if (r.ok) store.drafts = store.drafts.filter((d) => d.id !== id);
    else error = errorText(r);
  }
  const kindIcon = { screenshot: 'screenshot', video: 'record', replay: 'replay', screen: 'monitor', link: 'link' } as const;
</script>

<div data-screen="drafts">
  <ScreenHead title="Drafts" onback={() => (store.screen = 'main')} />
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <ul>
    {#each drafts as d (d.id)}
      <li data-draft={d.id}>
        <span class="thumb">
          {#if thumbs[d.id]}<img src={thumbs[d.id]} alt="" />{:else}<Icon name={kindIcon[d.kind]} size={20} />{/if}
        </span>
        <span class="meta">
          <span class="host">{d.host || 'Untitled page'}</span>
          <span class="age">{relativeAge(d.updatedAt)}{d.status === 'failed' ? ' · upload failed' : ''}</span>
        </span>
        <button class="view" type="button" data-draft-view={d.id} onclick={() => view(d.id)}>View</button>
        <button
          class="trash"
          class:confirm={confirming === d.id}
          type="button"
          aria-label={confirming === d.id ? 'Confirm delete' : 'Delete draft'}
          data-draft-trash={d.id}
          onclick={() => trash(d.id)}
          onblur={() => confirming === d.id && (confirming = null)}
        >
          {#if confirming === d.id}Delete{:else}<Icon name="trash" size={16} />{/if}
        </button>
      </li>
    {:else}
      <li class="empty" data-drafts-empty>No drafts. Captures you save for later show up here.</li>
    {/each}
  </ul>
</div>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 440px;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 70px;
    padding: 0 8px;
    box-sizing: border-box;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-md);
  }
  .thumb {
    flex: none;
    width: 66px;
    height: 50px;
    border-radius: var(--nb-radius-sm);
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--nb-surface-sunken);
    color: var(--nb-text-faint);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .host {
    font: var(--nb-weight-medium) var(--nb-text-base) / 1.3 var(--nb-font-sans);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .age {
    color: var(--nb-text-faint);
    font-size: var(--nb-text-sm);
  }
  .view,
  .trash {
    all: unset;
    height: 30px;
    border-radius: var(--nb-radius-md);
    cursor: pointer;
    font: var(--nb-weight-medium) var(--nb-text-md) / 30px var(--nb-font-sans);
  }
  .view {
    padding: 0 12px;
    background: var(--nb-accent);
    color: var(--nb-on-accent);
  }
  .trash {
    min-width: 30px;
    display: grid;
    place-items: center;
    color: var(--nb-text-faint);
  }
  .trash:hover {
    background: var(--nb-surface-sunken);
  }
  .trash.confirm {
    padding: 0 10px;
    background: var(--nb-danger);
    color: var(--nb-on-danger);
  }
  .view:focus-visible,
  .trash:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
  .empty {
    height: auto;
    padding: 24px 12px;
    border: 0;
    color: var(--nb-text-muted);
    justify-content: center;
    text-align: center;
  }
  .err {
    margin: 0 0 8px;
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
</style>
