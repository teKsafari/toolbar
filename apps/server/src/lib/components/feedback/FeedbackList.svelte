<script lang="ts">
  // Feedback items of a capture (Part 2 reviewer toolbar): one card per pin in pin order, with
  // the crop, the quoted text, the comment, the voice note and its transcript, and the errors and
  // failed requests that came with it. Shown on the capture page above the title.
  import { onMount } from 'svelte';
  import type { FeedbackItem } from '@toolbar/shared/areas/reviewer';
  import { call } from '../viewer/api.ts';
  import VIcon from '../viewer/VIcon.svelte';

  interface Props {
    recordingId: string;
    /** the capture is a reviewer submit: say so when it holds nothing yet */
    primary?: boolean;
  }
  let { recordingId, primary = false }: Props = $props();

  let items: FeedbackItem[] = $state([]);
  let loaded = $state(false);
  let open: string | null = $state(null);

  const KIND_LABEL: Record<FeedbackItem['kind'], string> = {
    element: 'Element',
    text: 'Text',
    draw: 'Drawing',
    shot: 'Screenshot',
    voice: 'Voice note',
    note: 'Page',
  };
  const KIND_ICON = { element: 'comment', text: 'text', draw: 'pen', shot: 'camera', voice: 'mic', note: 'comment' } as const;

  async function load() {
    try {
      const r = await call<{ items: FeedbackItem[] }>('feedback.list', { id: recordingId });
      items = r.items;
    } catch {
      items = [];
    }
    loaded = true;
  }

  onMount(() => {
    void load();
    // transcripts arrive after the submit: look again while one is still running
    const timer = setInterval(() => {
      if (items.some((i) => i.transcript && (i.transcript.status === 'pending' || i.transcript.status === 'running'))) void load();
    }, 4000);
    return () => clearInterval(timer);
  });

  const pathOf = (url: string) => {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  };
  const fmtMs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
</script>

{#if loaded && (items.length || primary)}
  <section class="fb" data-testid="feedback-list" aria-label="Feedback">
    <header>
      <h2>Feedback</h2>
      <span class="count">{items.length}</span>
    </header>
    {#if !items.length}
      <p class="empty">No feedback items in this capture.</p>
    {/if}
    <ol>
      {#each items as it (it.id)}
        <li class="item" data-testid="feedback-item" data-kind={it.kind} data-n={it.n}>
          <div class="head">
            <span class="n" aria-label="Pin {it.n}">{it.n}</span>
            <span class="kind"><VIcon name={KIND_ICON[it.kind]} size={14} />{KIND_LABEL[it.kind]}</span>
            {#if it.target}<code class="sel" title={it.target.selector}>{it.target.name || it.target.selector}</code>{/if}
            <span class="grow"></span>
            <span class="tag" title="Intent">{it.intent}</span>
            <span class="tag sev-{it.severity}" title="Severity">{it.severity}</span>
          </div>
          {#if it.quote}<blockquote data-testid="feedback-quote">{it.quote}</blockquote>{/if}
          {#if it.comment}<p class="comment" data-testid="feedback-comment">{it.comment}</p>{/if}
          {#if it.cropUrl}
            <button type="button" class="crop" onclick={() => (open = open === it.id ? null : it.id)} aria-label="Show the screenshot of pin {it.n} {open === it.id ? 'smaller' : 'larger'}">
              <img src={it.cropUrl} alt="Pin {it.n}" class:big={open === it.id} data-testid="feedback-crop" />
            </button>
          {/if}
          {#if it.voiceUrl}
            <div class="voice">
              <audio controls preload="none" src={it.voiceUrl} data-testid="feedback-voice"></audio>
              {#if it.voiceDurationMs}<span class="muted">{fmtMs(it.voiceDurationMs)}</span>{/if}
            </div>
            {#if it.transcript}
              <p class="transcript" data-testid="feedback-transcript" data-status={it.transcript.status}>
                {#if it.transcript.status === 'done'}{it.transcript.text || '(no speech found)'}
                {:else if it.transcript.status === 'failed'}The transcript could not be made.
                {:else if it.transcript.status === 'off'}Transcription is off on this server.
                {:else}<VIcon name="spinner" size={12} /> Transcribing{/if}
              </p>
            {/if}
          {/if}
          {#if it.context && (it.context.errors.length || it.context.failedRequests.length)}
            <details class="ctx" data-testid="feedback-context">
              <summary>
                <VIcon name="warning" size={13} />
                {it.context.errors.length} {it.context.errors.length === 1 ? 'error' : 'errors'}, {it.context.failedRequests.length}
                failed {it.context.failedRequests.length === 1 ? 'request' : 'requests'} in the {Math.round(it.context.windowMs / 1000)} s before
              </summary>
              <ul>
                {#each it.context.errors as e, i (i)}<li class="err">{e.text}</li>{/each}
                {#each it.context.failedRequests as r, i (i)}<li class="net"><b>{r.status || r.error || 'failed'}</b> {r.text}</li>{/each}
              </ul>
            </details>
          {/if}
          <div class="foot muted">
            <span title={it.page.url}>{pathOf(it.page.url)}</span>
            {#if it.author.name}<span>{it.author.name}</span>{/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .fb { border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); padding: 14px 16px; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  h2 { font-size: var(--nb-text-base); font-weight: 600; letter-spacing: var(--nb-tracking-ui); margin: 0; }
  .count { font: var(--nb-text-xs) / 18px var(--nb-font-mono); font-variant-numeric: tabular-nums; color: var(--nb-text-muted); background: var(--nb-surface-sunken); border-radius: var(--nb-radius-pill); padding: 0 8px; }
  .empty { color: var(--nb-text-muted); font-size: var(--nb-text-md); margin: 0; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .item { border-top: 1px solid var(--nb-border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .item:first-child { border-top: 0; padding-top: 0; }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--nb-text-sm); }
  .n { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--nb-accent); color: var(--nb-on-accent); font-weight: 600; font-size: 11px; }
  .kind { display: inline-flex; align-items: center; gap: 4px; color: var(--nb-text-muted); }
  .sel { font-family: var(--nb-font-mono); font-size: 11px; color: var(--nb-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .grow { flex: 1; }
  .tag { font-size: 11px; color: var(--nb-text-muted); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-pill); padding: 0 6px; }
  .sev-blocking { color: var(--nb-danger); border-color: var(--nb-danger); }
  blockquote { margin: 0; padding: 2px 10px; border-left: 2px solid var(--nb-accent); color: var(--nb-text-muted); font-size: var(--nb-text-md); white-space: pre-wrap; }
  .comment { margin: 0; white-space: pre-wrap; font-size: var(--nb-text-base); }
  .crop { all: unset; cursor: zoom-in; align-self: flex-start; max-width: 100%; }
  .crop img { display: block; max-width: min(100%, 320px); max-height: 180px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); object-fit: contain; background: var(--nb-surface-sunken); }
  .crop img.big { max-width: 100%; max-height: none; cursor: zoom-out; }
  .voice { display: flex; align-items: center; gap: 8px; }
  .voice audio { height: 32px; max-width: 100%; }
  .transcript { margin: 0; font-size: var(--nb-text-md); color: var(--nb-text-body); background: var(--nb-surface-2); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); padding: 6px 8px; }
  .ctx summary { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: var(--nb-text-sm); color: var(--nb-warning); }
  .ctx ul { margin: 6px 0 0; padding-left: 18px; font-family: var(--nb-font-mono); font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
  .ctx .err { color: var(--nb-danger); }
  .muted { color: var(--nb-text-faint); }
  .foot { display: flex; gap: 10px; font: 11px var(--nb-font-mono); color: var(--nb-text-faint); min-width: 0; }
  .foot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .crop:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: var(--nb-radius-sm); }
</style>
