<script lang="ts">
  // One comment (J-127 to J-134): avatar (a letter for anonymous comments), time chip that seeks
  // and highlights, rendered body with mentions, attachments, reactions, and hover actions for
  // the permalink, reactions, reply, resolve, edit and delete.
  import { toasts } from '@toolbar/ui';
  import { REACTION_KEYS, type Comment, type CommentThread, type ReactionKey } from '@toolbar/shared/api';
  import { fmtClock, renderMarkdown, reactionGlyphs } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Avatar from './Avatar.svelte';
  import Dropdown from './Dropdown.svelte';
  import Menu from './Menu.svelte';
  import Modal from './Modal.svelte';
  import ReactionGlyph from './ReactionGlyph.svelte';
  import MentionTextarea from './MentionTextarea.svelte';
  import { MentionDraft } from './mentions.svelte.ts';
  import { call, copyText } from './api.ts';
  import { shareBaseUrl } from './actions.ts';
  import { relTime } from './time.ts';
  import { useViewer } from './viewer.svelte.ts';

  interface Props {
    c: Comment | CommentThread;
    reply?: boolean;
    onreply?: () => void;
  }
  let { c, reply = false, onreply }: Props = $props();
  const v = useViewer();

  let picker = $state(false);
  let more = $state(false);
  let editing = $state(false);
  let confirmDelete = $state(false);
  let busy = $state(false);
  const draft = new MentionDraft();
  const canDelete = $derived(!!v.data.me && !c.anonymous && (c.canEdit || v.data.role === 'admin'));
  const isMember = $derived(v.data.mode === 'member' && !!v.data.me);

  function seekHere() {
    if (c.tMs === null) return;
    v.seek(c.tMs);
    v.highlightComment = c.id;
    document.querySelector('[data-testid="media"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  async function permalink() {
    const base = await shareBaseUrl(v);
    if (!base) return;
    const sep = base.includes('?') ? '&' : '?';
    if (await copyText(`${base}${sep}comment=${c.id}`)) toasts.success('Link to the comment copied');
  }
  async function toggleReaction(key: ReactionKey) {
    picker = false;
    const mine = c.reactions.find((r) => r.key === key)?.mine;
    try {
      const res = await call<{ reactions: Comment['reactions'] }>(mine ? 'comments.removeReaction' : 'comments.addReaction', { id: c.id, key });
      v.setReactions(c.id, res.reactions);
    } catch (e) {
      toasts.error((e as Error).message);
    }
  }
  async function resolve() {
    try {
      const res = await call<Comment>('comments.resolve', { id: c.id }, { resolved: !c.resolvedAt });
      v.upsertComment(res);
    } catch (e) {
      toasts.error((e as Error).message);
    }
  }
  function startEdit() {
    draft.load(c.body);
    editing = true;
  }
  async function saveEdit() {
    const body = draft.toMarkdown().trim();
    if (!body) return;
    busy = true;
    try {
      v.upsertComment(await call<Comment>('comments.update', { id: c.id }, { body }));
      editing = false;
    } catch (e) {
      toasts.error((e as Error).message);
    } finally {
      busy = false;
    }
  }
  async function remove() {
    busy = true;
    try {
      await call('comments.delete', { id: c.id });
      v.removeComment(c.id);
      confirmDelete = false;
      toasts.success('Comment deleted');
    } catch (e) {
      toasts.error((e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<article id="comment-{c.id}" class="cm" class:reply class:hl={v.highlightComment === c.id} class:resolved={!!c.resolvedAt} data-testid="comment" data-comment-id={c.id}>
  <Avatar name={c.displayName} image={c.author?.image} size={reply ? 22 : 28} />
  <div class="main">
    <div class="head">
      <span class="name">{c.displayName}</span>{#if c.viaAgent}<span class="via" title="Written by {c.viaAgent} for {c.displayName}" data-testid="comment-via">via {c.viaAgent}</span>{/if}
      {#if c.anonymous}<span class="tag">anonymous</span>{/if}
      {#if c.tMs !== null}<button type="button" class="tchip" onclick={seekHere} title="Play from here" data-testid="comment-time">{fmtClock(c.tMs)}</button>{/if}
      <span class="when" title={new Date(c.createdAt).toLocaleString()}>{relTime(c.createdAt)}</span>
      {#if c.editedAt}<span class="when" data-testid="edited">(edited)</span>{/if}
      {#if c.resolvedAt}<span class="res" data-testid="resolved-badge"><VIcon name="resolve" size={12} />Resolved{c.resolvedBy ? ` by ${c.resolvedBy.name}` : ''}</span>{/if}
    </div>
    {#if editing}
      <div class="edit">
        <MentionTextarea {draft} members={v.data.members} label="Edit comment" rows={2} onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(); } if (e.key === 'Escape') editing = false; }} testid="edit-input" />
        <div class="ebtns">
          <button type="button" class="sbtn" onclick={() => (editing = false)}>Cancel</button>
          <button type="button" class="sbtn primary" disabled={busy} onclick={saveEdit} data-testid="save-edit">Save</button>
        </div>
      </div>
    {:else}
      {#if c.body}<div class="body" data-testid="comment-body">{@html renderMarkdown(c.body)}</div>{/if}
    {/if}
    {#if c.voice}
      <div class="voice" data-testid="comment-voice">
        <audio controls preload="none" src={c.voice.url}></audio>
        {#if c.voice.transcript?.status === 'done' && c.voice.transcript.text}
          <p class="tr" data-testid="voice-transcript" lang={c.voice.transcript.language?.split(',')[0] || undefined}>{c.voice.transcript.text}</p>
        {:else if c.voice.transcript?.status === 'pending' || c.voice.transcript?.status === 'running'}
          <p class="tr muted" data-testid="voice-transcript">Transcribing</p>
        {:else if c.voice.transcript?.reason}
          <p class="tr muted" data-testid="voice-transcript">No transcript: {c.voice.transcript.reason}</p>
        {/if}
      </div>
    {/if}
    {#if c.attachments.length}
      <div class="atts">
        {#each c.attachments as a (a.id)}
          <a href={a.url} target="_blank" rel="noopener noreferrer" data-testid="comment-attachment"><img src={a.url} alt="Attachment" /></a>
        {/each}
      </div>
    {/if}
    {#if c.reactions.length}
      <div class="reacts">
        {#each c.reactions as r (r.key)}
          <button type="button" class="rpill" class:mine={r.mine} onclick={() => toggleReaction(r.key)} aria-pressed={r.mine} title={reactionGlyphs[r.key].label} data-testid="reaction-{r.key}">
            <ReactionGlyph k={r.key} size={14} /><span>{r.count}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="hover" class:open={picker || more}>
    <button type="button" class="hb" onclick={permalink} aria-label="Copy link to this comment" title="Copy link" data-testid="comment-link"><VIcon name="link" size={14} /></button>
    <Dropdown open={picker} align="end" onclose={() => (picker = false)}>
      {#snippet trigger()}
        <button type="button" class="hb" onclick={() => (picker = !picker)} aria-label="React" title="React" data-testid="react"><VIcon name="smile" size={14} /></button>
      {/snippet}
      <div class="picker" role="menu" data-testid="reaction-picker">
        {#each REACTION_KEYS as k (k)}
          <button type="button" role="menuitem" onclick={() => toggleReaction(k)} aria-label={reactionGlyphs[k].label} data-testid="pick-{k}"><ReactionGlyph {k} size={20} /></button>
        {/each}
      </div>
    </Dropdown>
    {#if !reply && onreply && v.detail.canComment}
      <button type="button" class="hb" onclick={onreply} aria-label="Reply" title="Reply" data-testid="reply"><VIcon name="reply" size={14} /></button>
    {/if}
    {#if !reply && isMember}
      <button type="button" class="hb" onclick={resolve} aria-label={c.resolvedAt ? 'Reopen' : 'Resolve'} title={c.resolvedAt ? 'Reopen' : 'Resolve'} data-testid="resolve"><VIcon name="resolve" size={14} /></button>
    {/if}
    {#if c.canEdit || canDelete}
      <Dropdown open={more} align="end" onclose={() => (more = false)}>
        {#snippet trigger()}
          <button type="button" class="hb" onclick={() => (more = !more)} aria-label="More" data-testid="comment-more"><VIcon name="more" size={14} /></button>
        {/snippet}
        <Menu
          label="Comment"
          onpick={() => (more = false)}
          items={[
            ...(c.canEdit ? [{ id: 'edit', label: 'Edit', icon: 'edit', run: startEdit }] : []),
            ...(canDelete ? [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: () => (confirmDelete = true) }] : []),
          ]} />
      </Dropdown>
    {/if}
  </div>
</article>

{#if confirmDelete}
  <Modal title="Delete this comment?" confirmLabel="Delete" danger {busy} onconfirm={remove} oncancel={() => (confirmDelete = false)}>
    This is permanent. The comment and its replies cannot be brought back.
  </Modal>
{/if}

<style>
  .via { margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--nb-accent-tint); color: var(--nb-accent-text); font-size: var(--nb-text-xs); font-weight: 500; white-space: nowrap; }
  .cm { position: relative; display: flex; gap: 10px; padding: 10px 10px; border-radius: var(--nb-radius-md); transition: background var(--nb-dur-med); }
  .cm:hover { background: var(--nb-surface-2); }
  .cm.reply { padding: 6px 10px 6px 48px; }
  .cm.hl { background: var(--nb-capture-tint); }
  .cm.resolved .body { color: var(--nb-text-muted); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--nb-text-md); }
  .name { font-weight: 600; }
  .tag { font-size: var(--nb-text-xs); color: var(--nb-text-faint); }
  .tchip { all: unset; padding: 0 6px; height: 18px; line-height: 18px; border-radius: 999px; background: var(--nb-accent-tint); color: var(--nb-accent-text); font: 500 var(--nb-text-sm) var(--nb-font-mono); cursor: pointer; }
  .tchip:hover { background: var(--nb-accent); color: var(--nb-on-accent); }
  .when { color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
  .res { display: inline-flex; align-items: center; gap: 3px; color: var(--nb-success); font-size: var(--nb-text-sm); }
  .body { word-break: break-word; }
  .body :global(p) { margin: 0 0 4px; }
  .body :global(p:last-child) { margin: 0; }
  .body :global(ul), .body :global(ol) { margin: 0 0 4px; padding-left: 20px; }
  .body :global(.nb-mention) { color: var(--nb-accent-text); font-weight: 500; }
  .voice { display: flex; flex-direction: column; gap: 4px; }
  .voice audio { height: 30px; width: 100%; max-width: 320px; }
  .tr { margin: 0; padding-left: 8px; border-left: 2px solid var(--nb-border-strong); color: var(--nb-text); font-size: var(--nb-text-md); white-space: pre-wrap; }
  .tr.muted { color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
  .atts { display: flex; gap: 6px; flex-wrap: wrap; }
  .atts img { width: 120px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid var(--nb-border); display: block; }
  .reacts { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
  .rpill { all: unset; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--nb-border); font-size: var(--nb-text-sm); cursor: pointer; }
  .rpill.mine { border-color: var(--nb-accent); background: var(--nb-accent-tint); }
  .hover { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; padding: 2px; border-radius: var(--nb-radius-md); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-sm); }
  .cm:hover .hover, .hover.open, .cm:focus-within .hover { display: flex; }
  .hb { all: unset; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; color: var(--nb-text-muted); cursor: pointer; }
  .hb:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .hb:focus-visible { outline: 2px solid var(--nb-focus); }
  .picker { display: grid; grid-template-columns: repeat(4, 32px); gap: 2px; padding: 6px; border-radius: var(--nb-radius-md); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); }
  .picker button { all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
  .picker button:hover { background: var(--nb-surface-sunken); }
  .edit { display: flex; flex-direction: column; gap: 6px; padding: 4px 8px; border: 1px solid var(--nb-focus); border-radius: var(--nb-radius-md); }
  .ebtns { display: flex; justify-content: flex-end; gap: 6px; }
  .sbtn { all: unset; padding: 4px 10px; border-radius: var(--nb-radius-sm); font-size: var(--nb-text-md); cursor: pointer; border: 1px solid var(--nb-border-strong); }
  .sbtn.primary { background: var(--nb-accent); color: var(--nb-on-accent); border-color: transparent; }
  @media (hover: none) { .hover { display: flex; position: static; margin-left: auto; align-self: flex-start; border: 0; box-shadow: none; background: transparent; } }
</style>
