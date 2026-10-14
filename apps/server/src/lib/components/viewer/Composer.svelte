<script lang="ts">
  // Comment composer (J-127, J-132, J-134, J-135): Enter adds a line, Ctrl+Enter sends; once the
  // player is past zero the send button grows into a pill naming the time and the comment is
  // pinned there. Clears at once; the server answer replaces the optimistic row.
  import { toasts } from '@toolbar/ui';
  import type { Asset, Comment } from '@toolbar/shared/api';
  import { fmtClock } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import MentionTextarea from './MentionTextarea.svelte';
  import { MentionDraft } from './mentions.svelte.ts';
  import { call } from './api.ts';
  import { useViewer } from './viewer.svelte.ts';

  interface Props {
    parentId?: string;
    autofocus?: boolean;
    oncancel?: () => void;
    onsent?: (c: Comment) => void;
  }
  let { parentId, autofocus = false, oncancel, onsent }: Props = $props();
  const v = useViewer();
  const draft = new MentionDraft();
  let el: HTMLTextAreaElement | undefined = $state();
  let files: { asset: Asset | null; preview: string; uploading: boolean }[] = $state([]);
  let fileInput: HTMLInputElement | undefined = $state();
  const timed = $derived(!parentId && v.playable && (v.now >= 500 || v.armed));
  const canAttach = $derived(!!v.data.me);
  const ready = $derived((draft.text.trim() !== '' || files.some((f) => f.asset)) && !files.some((f) => f.uploading));

  $effect(() => {
    if (v.armed && !parentId) {
      const t = setTimeout(() => (v.armed = false), 8000);
      return () => clearTimeout(t);
    }
  });

  async function addFiles(list: FileList | File[] | null) {
    for (const file of Array.from(list ?? [])) {
      if (!file.type.startsWith('image/')) {
        toasts.error('Only images can be attached');
        continue;
      }
      const item = { asset: null as Asset | null, preview: URL.createObjectURL(file), uploading: true };
      files.push(item);
      const idx = files.length - 1;
      const fd = new FormData();
      fd.set('kind', 'comment');
      fd.set('recordingId', v.detail.id);
      fd.set('file', file);
      try {
        const asset = await call<Asset>('captures.uploadAsset', {}, fd);
        files[idx] = { ...files[idx]!, asset, uploading: false };
      } catch (e) {
        files.splice(idx, 1);
        toasts.error(`Upload failed: ${(e as Error).message}`);
      }
    }
  }
  function removeFile(i: number) {
    URL.revokeObjectURL(files[i]!.preview);
    files.splice(i, 1);
  }

  async function send() {
    if (!ready) return;
    const body = draft.toMarkdown().trim();
    const mentions = draft.mentionIds();
    const tMs = timed ? Math.round(v.now) : undefined;
    const attachmentAssetIds = files.map((f) => f.asset!.id);
    const saved = { text: draft.text, picked: new Map(draft.picked), files: [...files] };
    draft.clear();
    files = [];
    v.armed = false;
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    const temp: Comment = {
      id: tempId,
      recordingId: v.detail.id,
      parentId: parentId ?? null,
      author: v.data.me ? { id: v.data.me.id, name: v.data.me.name, email: v.data.me.email, image: v.data.me.image } : null,
      anonymous: !v.data.me,
      displayName: v.data.me?.name ?? 'Anonymous',
      body,
      tMs: tMs ?? null,
      attachments: saved.files.map((f) => f.asset!),
      reactions: [],
      mentions,
      createdAt: new Date().toISOString(),
      editedAt: null,
      resolvedAt: null,
      resolvedBy: null,
      canEdit: false,
    };
    v.upsertComment(temp);
    try {
      const c = await call<Comment>('comments.create', { id: v.detail.id }, { body, parentId, tMs, attachmentAssetIds, mentions });
      v.removeComment(tempId);
      v.upsertComment(c);
      onsent?.(c);
    } catch (e) {
      v.removeComment(tempId);
      draft.text = saved.text;
      for (const [k, id] of saved.picked) draft.pick(k, id);
      files = saved.files;
      toasts.error(`Comment not sent: ${(e as Error).message}`);
    }
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && oncancel) oncancel();
  }
  function onpaste(e: ClipboardEvent) {
    const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length && canAttach) {
      e.preventDefault();
      void addFiles(imgs);
    }
  }
</script>

<div class="composer" class:reply={!!parentId} data-testid={parentId ? 'reply-composer' : 'composer'}>
  {#if files.length}
    <div class="files">
      {#each files as f, i (f.preview)}
        <span class="file" data-testid="composer-attachment">
          <img src={f.preview} alt="Attachment" />
          {#if f.uploading}<span class="up"><VIcon name="spinner" size={14} /></span>{/if}
          <button type="button" class="rm" onclick={() => removeFile(i)} aria-label="Remove attachment"><VIcon name="close" size={10} /></button>
        </span>
      {/each}
    </div>
  {/if}
  <div class="row">
    {#if canAttach && !parentId}
      <button type="button" class="ib" onclick={() => fileInput?.click()} aria-label="Attach an image" title="Attach an image" data-testid="attach"><VIcon name="paperclip" size={16} /></button>
      <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={(e) => { void addFiles((e.currentTarget as HTMLInputElement).files); (e.currentTarget as HTMLInputElement).value = ''; }} data-testid="attach-input" />
    {/if}
    <MentionTextarea
      {draft}
      members={v.data.members}
      bind:el
      {autofocus}
      label={parentId ? 'Reply' : 'Comment'}
      placeholder={parentId ? 'Reply' : v.data.me ? 'Leave a comment. Type @ to mention someone.' : 'Leave a comment as a guest'}
      onkeydown={onkey}
      {onpaste}
      testid={parentId ? 'reply-input' : 'comment-input'} />
    {#if parentId && oncancel}<button type="button" class="ib" onclick={oncancel} aria-label="Cancel reply"><VIcon name="close" size={14} /></button>{/if}
    <button type="button" class="send" class:pill={timed} disabled={!ready} onclick={send} aria-label={timed ? `Comment at ${fmtClock(v.now)}` : 'Send'} title="Send (Ctrl+Enter)" data-testid="send">
      <VIcon name="send" size={15} />{#if timed}<span>at {fmtClock(v.now)}</span>{/if}
    </button>
  </div>
</div>

<style>
  .composer { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-lg); background: var(--nb-surface); box-shadow: var(--nb-shadow-md); }
  .composer:focus-within { border-color: var(--nb-focus); }
  .composer.reply { box-shadow: none; margin-left: 48px; padding: 4px 8px; }
  .row { display: flex; align-items: flex-end; gap: 6px; }
  .ib { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: var(--nb-radius-sm); color: var(--nb-text-muted); cursor: pointer; flex: none; }
  .ib:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .send { all: unset; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; min-width: 30px; padding: 0; border-radius: 999px; background: var(--nb-accent); color: var(--nb-on-accent); cursor: pointer; flex: none; font: 500 var(--nb-text-md) var(--nb-font-mono); transition: padding var(--nb-dur-med) var(--nb-ease-out); }
  .send.pill { padding: 0 12px 0 10px; }
  .send:disabled { opacity: 0.4; cursor: default; }
  .send:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .files { display: flex; gap: 6px; flex-wrap: wrap; }
  .file { position: relative; width: 64px; height: 48px; border-radius: 6px; overflow: hidden; border: 1px solid var(--nb-border); }
  .file img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .up { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(255 255 255 / 0.6); }
  .rm { all: unset; position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: rgb(0 0 0 / 0.65); color: #fff; cursor: pointer; }
</style>
