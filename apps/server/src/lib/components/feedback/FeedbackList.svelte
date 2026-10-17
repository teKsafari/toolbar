<script lang="ts">
  // Feedback items of a capture (Part 2 reviewer toolbar): one card per pin in pin order, with
  // the crop, the quoted text, the comment, the voice note and its transcript, and the errors and
  // failed requests that came with it. Shown on the capture page above the title. Those last two
  // are chips; on a page with the dev tools, a chip opens Console or Network on the note's window
  // with its entries selected (D-206).
  import { onMount } from 'svelte';
  import type { FeedbackItem } from '@toolbar/shared/areas/reviewer';
  import type { Resolution } from '@toolbar/shared/api';
  import { call } from '../viewer/api.ts';
  import { relTime } from '../viewer/time.ts';
  import AuthorAvatar from '../agent/AuthorAvatar.svelte';
  import AuthorName from '../agent/AuthorName.svelte';
  import VIcon from '../viewer/VIcon.svelte';
  import { useViewer } from '../viewer/viewer.svelte.ts';

  interface Props {
    recordingId: string;
    /** the capture is a reviewer submit: say so when it holds nothing yet */
    primary?: boolean;
  }
  let { recordingId, primary = false }: Props = $props();
  /** the capture page's state, when the list is on it with the dev tools */
  const v = useViewer();
  const canOpen = $derived(!!v?.data.devtools);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  let items: FeedbackItem[] = $state([]);
  /** who resolved the feedback, and through which agent (members only; D-207) */
  let resolution = $state<Resolution | null>(null);
  /** "browser" is the person themself; anything else names the agent or "API" */
  const resolvedVia = $derived(resolution?.via && resolution.via !== 'browser' ? resolution.via : null);
  const resolverName = $derived(resolution?.resolvedBy?.name ?? resolution?.resolvedBy?.email ?? 'Someone');
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

  async function loadResolution() {
    if (v?.data.mode !== 'member' || !v.data.me) return;
    try {
      const r = await call<Resolution>('handoff.resolution', { id: recordingId });
      resolution = r.resolved ? r : null;
    } catch {
      resolution = null;
    }
  }

  onMount(() => {
    void load();
    void loadResolution();
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
    {#if resolution?.resolvedAt}
      <p class="hist" data-testid="feedback-resolution">
        <AuthorAvatar name={resolverName} agent={resolvedVia} size={20} />
        <span class="htext">Resolved by <AuthorName name={resolverName} agent={resolvedVia} /> <span class="when" title={new Date(resolution.resolvedAt).toLocaleString()}>{relTime(resolution.resolvedAt)}</span>{#if resolution.commit}<code class="commit">{resolution.commit.slice(0, 12)}</code>{/if}</span>
      </p>
      {#if resolution.note}<p class="rnote">{resolution.note}</p>{/if}
    {/if}
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
            {@const ctx = it.context}
            <div class="ctx" data-testid="feedback-context">
              {#each [{ show: 'errors' as const, n: ctx.errors.length, text: plural(ctx.errors.length, 'error', 'errors'), list: ctx.errors }, { show: 'requests' as const, n: ctx.failedRequests.length, text: plural(ctx.failedRequests.length, 'failed request', 'failed requests'), list: ctx.failedRequests }] as c (c.show)}
                {#if c.n}
                  {@const tip = c.list.map((e) => (e.status || e.error ? `${e.status || e.error} ` : '') + e.text).join('\n')}
                  {#if canOpen}
                    <button type="button" class="cchip" title={tip} onclick={() => v!.showNoteContext(it, c.show)} data-testid="feedback-chip-{c.show}">{c.text}</button>
                  {:else}
                    <span class="cchip" title={tip} data-testid="feedback-chip-{c.show}">{c.text}</span>
                  {/if}
                {/if}
              {/each}
            </div>
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
  /* a history line (D-207): who resolved it, through which agent, and when */
  .hist { --ring: var(--nb-surface); display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); min-width: 0; }
  .htext { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
  .htext :global(.who) { color: var(--nb-text); }
  .when { color: var(--nb-text-faint); }
  .commit { font: 11px var(--nb-font-mono); color: var(--nb-text-muted); }
  .rnote { margin: -4px 0 8px 28px; font-size: var(--nb-text-md); color: var(--nb-text-body); white-space: pre-wrap; }
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
  /* context chips: 20 px capsules on the danger tint (language section 10, badges) */
  .ctx { display: flex; flex-wrap: wrap; gap: 6px; }
  .cchip { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: var(--nb-radius-pill); background: var(--nb-danger-tint); color: var(--nb-danger-text); font: var(--nb-weight-medium) 11px/20px var(--nb-font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
  button.cchip { cursor: pointer; transition: box-shadow var(--nb-dur-fast) var(--nb-ease-out); }
  button.cchip:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-danger-text) 45%, transparent); }
  button.cchip:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .muted { color: var(--nb-text-faint); }
  .foot { display: flex; gap: 10px; font: 11px var(--nb-font-mono); color: var(--nb-text-faint); min-width: 0; }
  .foot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .crop:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: var(--nb-radius-sm); }
</style>
