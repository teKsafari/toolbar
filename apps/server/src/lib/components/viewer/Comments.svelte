<script lang="ts">
  // Comment list and composer for the left column (J-127 to J-135): threads oldest first with
  // replies, live updates over SSE (J-133) with a jump pill when a new comment lands below the
  // fold, and the highlight from ?comment= (J-129).
  import { onMount, tick } from 'svelte';
  import type { Comment, CommentThread } from '@toolbar/shared/api';
  import CommentItem from './CommentItem.svelte';
  import Composer from './Composer.svelte';
  import Avatar from './Avatar.svelte';
  import VIcon from './VIcon.svelte';
  import { call, urlOf } from './api.ts';
  import { useViewer } from './viewer.svelte.ts';

  interface Props {
    scroller: () => HTMLElement | undefined;
  }
  let { scroller }: Props = $props();
  const v = useViewer();
  let replyTo: string | null = $state(null);
  let fresh: Comment[] = $state([]);
  let showResolved = $state(false);
  const open = $derived(v.threads.filter((t) => !t.resolvedAt));
  const resolved = $derived(v.threads.filter((t) => t.resolvedAt));
  const count = $derived(v.threads.reduce((n, t) => n + 1 + t.replies.length, 0));

  function belowFold(id: string): boolean {
    const el = document.getElementById(`comment-${id}`);
    const sc = scroller();
    if (!el) return false;
    const box = sc && sc.scrollHeight > sc.clientHeight ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return el.getBoundingClientRect().top > box.bottom - 80;
  }
  function jump() {
    const first = fresh[0];
    fresh = [];
    if (first) document.getElementById(`comment-${first.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  onMount(() => {
    if (v.highlightComment) {
      void tick().then(() => document.getElementById(`comment-${v.highlightComment}`)?.scrollIntoView({ block: 'center' }));
    }
    const qs = v.data.shareToken ? { share: v.data.shareToken } : undefined;
    const onMessage = async (msg: MessageEvent) => {
      const ev = JSON.parse(msg.data as string) as
        | { type: 'created' | 'updated'; comment: Comment }
        | { type: 'deleted'; id: string }
        | { type: 'reactions'; id: string; reactions: Comment['reactions'] };
      if (ev.type === 'deleted') v.removeComment(ev.id);
      else if (ev.type === 'reactions') v.setReactions(ev.id, ev.reactions);
      else {
        const all = v.allComments();
        const temp = all.find((c) => c.id.startsWith('tmp-') && c.body === ev.comment.body);
        const known = !!temp || all.some((c) => c.id === ev.comment.id);
        if (temp) v.removeComment(temp.id);
        v.upsertComment(ev.comment);
        if (ev.type === 'created' && !known) {
          await tick();
          if (belowFold(ev.comment.id)) fresh = [...fresh, ev.comment];
        }
      }
    };
    // The stream is open only while the page is visible. Each open stream holds one of the
    // browser's six HTTP/1.1 connections to the server, so six background capture tabs would
    // stall every new page of the app. A tab coming back reconnects and reloads the list.
    let es: EventSource | null = null;
    const connect = () => {
      if (es) return;
      es = new EventSource(urlOf('comments.stream', { id: v.detail.id }, qs));
      es.onmessage = (m) => void onMessage(m);
    };
    const disconnect = () => {
      es?.close();
      es = null;
    };
    const resync = async () => {
      try {
        const page = await call<{ items: CommentThread[]; nextCursor?: string | null }>('comments.list', { id: v.detail.id });
        const pending = v.threads.filter((t) => t.id.startsWith('tmp-'));
        if (!page.nextCursor) v.threads = [...page.items, ...pending];
        else for (const t of page.items) for (const c of [t, ...t.replies]) v.upsertComment(c);
      } catch {
        /* keep what is shown */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return disconnect();
      if (es) return;
      connect();
      void resync();
    };
    if (document.visibilityState !== 'hidden') connect();
    document.addEventListener('visibilitychange', onVisibility);
    const onScroll = () => {
      if (fresh.length && fresh.every((c) => !belowFold(c.id))) fresh = [];
    };
    const sc = scroller();
    (sc ?? window).addEventListener('scroll', onScroll, { passive: true });
    return () => {
      disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      (sc ?? window).removeEventListener('scroll', onScroll);
    };
  });
</script>

<section class="comments" aria-label="Comments" data-testid="comments">
  <h2 class="h">Comments{#if count}<span class="n">{count}</span>{/if}</h2>
  {#if !v.threads.length}
    <p class="none">No comments yet. Seek to a moment and leave the first one.</p>
  {/if}
  {#each open as t (t.id)}
    <div class="thread">
      <CommentItem c={t} onreply={() => (replyTo = replyTo === t.id ? null : t.id)} />
      {#each t.replies as r (r.id)}<CommentItem c={r} reply />{/each}
      {#if replyTo === t.id}
        <Composer parentId={t.id} autofocus oncancel={() => (replyTo = null)} onsent={() => (replyTo = null)} />
      {/if}
    </div>
  {/each}
  {#if resolved.length}
    <button type="button" class="toggle" onclick={() => (showResolved = !showResolved)} aria-expanded={showResolved} data-testid="resolved-toggle">
      <VIcon name={showResolved ? 'chevron-down' : 'chevron-right'} size={12} />{resolved.length} resolved
    </button>
    {#if showResolved}
      {#each resolved as t (t.id)}
        <div class="thread">
          <CommentItem c={t} />
          {#each t.replies as r (r.id)}<CommentItem c={r} reply />{/each}
        </div>
      {/each}
    {/if}
  {/if}
</section>

<div class="dock">
  {#if fresh.length}
    <button type="button" class="jump" onclick={jump} data-testid="jump-pill">
      {#each fresh.slice(0, 3) as c (c.id)}<Avatar name={c.displayName} size={18} />{/each}
      {fresh.length} new comment{fresh.length > 1 ? 's' : ''}<VIcon name="chevron-down" size={12} />
    </button>
  {/if}
  {#if v.detail.canComment}<Composer />{/if}
</div>

<style>
  .comments { display: flex; flex-direction: column; gap: 2px; padding-bottom: 12px; }
  .h { display: flex; align-items: center; gap: 8px; margin: 8px 2px 4px; font-size: var(--nb-text-base); font-weight: var(--nb-weight-semibold); letter-spacing: var(--nb-tracking-ui); }
  .n { font: var(--nb-text-sm) var(--nb-font-mono); font-variant-numeric: tabular-nums; color: var(--nb-text-faint); }
  .none { margin: 4px 2px 8px; color: var(--nb-text-muted); font-size: var(--nb-text-md); }
  .thread { display: flex; flex-direction: column; border-bottom: 1px solid var(--nb-border); padding: 2px 0; }
  .thread:last-of-type { border-bottom: 0; }
  .toggle { all: unset; display: inline-flex; align-items: center; gap: 4px; margin: 6px 2px; font-size: var(--nb-text-md); color: var(--nb-text-muted); cursor: pointer; }
  .toggle:hover { color: var(--nb-text); }
  .toggle:focus-visible { outline: 2px solid var(--nb-focus); border-radius: 4px; }
  .dock { position: sticky; bottom: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 12px; background: linear-gradient(transparent, var(--nb-bg) 30%); }
  .dock > :global(.composer) { align-self: stretch; }
  .jump { all: unset; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px 0 6px; border-radius: 999px; background: var(--nb-chrome); color: var(--nb-on-chrome); font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); cursor: pointer; box-shadow: var(--nb-shadow-lg); }
</style>
