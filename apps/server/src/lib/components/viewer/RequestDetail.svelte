<script lang="ts">
  // Request detail pane (J-106, J-107, J-185): status dot, sub-tabs for headers, payload,
  // response (messages for sockets and event streams) and timing, copy as cURL, close.
  import { fmtBytes, fmtClock, fmtDuration, isFailed, prettyBody, toCurl, type NetworkViewRow } from '@toolbar/ui/viewer';
  import { toasts } from '@toolbar/ui';
  import VIcon from './VIcon.svelte';
  import BodyView from './BodyView.svelte';
  import { copyText } from './api.ts';
  import { agentNudge } from './actions.ts';

  type Sub = 'headers' | 'payload' | 'response' | 'timing';
  interface Props {
    entry: NetworkViewRow;
    sub: Sub;
    onclose: () => void;
  }
  let { entry, sub = $bindable(), onclose }: Props = $props();

  const stream = $derived(entry.type === 'websocket' || entry.type === 'eventsource');
  // a GraphQL reply with errors is a failure at any status (J-064)
  const tone = $derived(entry.state === 'pending' ? 'pend' : isFailed(entry) ? 'bad' : (entry.status ?? 0) >= 300 ? 'warn' : 'ok');
  const masked = (name: string, value: string) => entry.redacted.includes(name.toLowerCase()) || /\[redacted\]/i.test(value);
  const subs = $derived<{ id: Sub; label: string }[]>([
    { id: 'headers', label: 'Headers' },
    ...(stream ? [] : [{ id: 'payload' as Sub, label: 'Payload' }]),
    { id: 'response', label: stream ? 'Messages' : 'Response' },
    { id: 'timing', label: 'Timing' },
  ]);
  $effect(() => {
    if (!subs.some((s) => s.id === sub)) sub = 'headers';
  });
  // Frame list (J-062): direction, data, length and time, a regex filter, a direction filter and
  // a pretty-printed pane for the selected frame. Binary frames show their size only (J-066).
  type Dir = 'all' | 'send' | 'recv';
  let frameQ = $state('');
  let frameDir = $state<Dir>('all');
  let frameSel = $state<number | null>(null);
  const frameRe = $derived.by(() => {
    if (!frameQ) return null;
    try {
      return new RegExp(frameQ, 'i');
    } catch {
      return 'bad' as const;
    }
  });
  const isRecv = (op: string) => op === 'recv' || op === 'message';
  const frameRows = $derived(
    entry.frames
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => {
        if (frameDir === 'send' && f.op !== 'send') return false;
        if (frameDir === 'recv' && !isRecv(f.op)) return false;
        if (frameRe && frameRe !== 'bad') return frameRe.test(`${f.event ?? ''} ${f.data ?? ''}`);
        return true;
      }),
  );
  const selFrame = $derived(frameSel === null ? null : (entry.frames[frameSel] ?? null));
  const selPretty = $derived(prettyBody(selFrame?.data ?? null));
  $effect(() => {
    void entry.rid;
    frameSel = null;
  });
  const dirLabel = (f: { op: string; event: string | null }) => (f.op === 'send' ? 'sent' : isRecv(f.op) ? 'received' : f.op) + (f.event ? ` ${f.event}` : '');
  const frameText = (f: { binary: boolean; data: string | null; length: number | null; op: string }) =>
    f.binary ? `Binary frame, ${f.length != null ? fmtBytes(f.length) : 'size unknown'}` : (f.data ?? '');
  /** Headers sorted by name, as DevTools lists them (J-059). */
  const sorted = (hs: Record<string, string> | null | undefined) => Object.entries(hs ?? {}).sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const groups = $derived([
    { id: 'response', title: 'Response headers', list: sorted(entry.responseHeaders) },
    { id: 'request', title: 'Request headers', list: sorted(entry.requestHeaders) },
  ]);

  async function copyCurl() {
    if (await copyText(toCurl(entry))) agentNudge('cURL copied');
    else toasts.error('Could not copy');
  }
</script>

<section class="pane" aria-label="Request detail" data-testid="request-detail" data-keys-own>
  <header>
    <span class="dot {tone}" aria-hidden="true"></span>
    <span class="status" data-testid="detail-status">{entry.status ?? (entry.state === 'pending' ? 'Pending' : 'Failed')}</span>
    <span class="name" title={entry.url}>{entry.method} {entry.path}</span>
    {#if !stream}
      <button type="button" class="btn" onclick={copyCurl} data-testid="copy-curl"><VIcon name="copy" size={13} />Copy as cURL</button>
    {/if}
    <button type="button" class="x" onclick={onclose} aria-label="Close detail" data-testid="close-detail"><VIcon name="close" size={14} /></button>
  </header>
  <div class="subs" role="tablist">
    {#each subs as s (s.id)}
      <button type="button" role="tab" aria-selected={sub === s.id} class:on={sub === s.id} onclick={() => (sub = s.id)} data-testid="sub-{s.id}">{s.label}</button>
    {/each}
  </div>
  <div class="body" data-testid="detail-body">
    {#if sub === 'headers'}
      <details open data-testid="hgroup-general">
        <summary><VIcon name="chevron-down" size={11} class="chev" />General</summary>
        <dl>
          <dt>URL</dt><dd>{entry.url}</dd>
          <dt>Method</dt><dd>{entry.method}</dd>
          <dt>Status</dt><dd><span class="dot {tone}"></span>{entry.status ?? entry.state}{entry.statusText ? ` ${entry.statusText}` : ''}{entry.error ? ` (${entry.error})` : ''}{entry.graphql?.hasErrors ? ', GraphQL errors' : ''}</dd>
          {#if entry.graphql?.operationName}<dt>Operation</dt><dd>{entry.graphql.operationName}</dd>{/if}
          <dt>Type</dt><dd>{entry.type}{entry.initiator ? `, ${entry.initiator}` : ''}</dd>
          <dt>Seen by</dt><dd>{entry.source === 'both' ? 'page and browser' : entry.source === 'webRequest' ? 'browser' : 'page'}</dd>
          {#if entry.size != null}<dt>Size</dt><dd>{fmtBytes(entry.size)}{entry.truncated ? ' (body cut)' : ''}</dd>{/if}
        </dl>
      </details>
      {#each groups as g (g.id)}
        <details open data-testid="hgroup-{g.id}">
          <summary><VIcon name="chevron-down" size={11} class="chev" />{g.title} <span class="n">{g.list.length}</span></summary>
          {#if g.list.length}
            <dl>
              {#each g.list as [k, val] (k)}
                <dt>{k}</dt>
                <dd>
                  {#if masked(k, val)}<span class="masked" data-testid="masked-{k.toLowerCase()}"><VIcon name="shield" size={12} />masked</span>{:else}{val}{/if}
                </dd>
              {/each}
            </dl>
          {:else}<p class="none">None captured</p>{/if}
        </details>
      {/each}
    {:else if sub === 'payload'}
      {#if entry.requestBody}<BodyView text={entry.requestBody} testid="payload-body" />{:else}<p class="none">This request had no body.</p>{/if}
    {:else if sub === 'response'}
      {#if stream}
        <div class="ffilter" data-testid="frame-filters">
          <input type="search" placeholder="Filter frames (regex)" aria-label="Filter frames by regular expression" bind:value={frameQ} class:bad={frameRe === 'bad'} data-testid="frame-filter" />
          <div class="seg" role="radiogroup" aria-label="Direction">
            {#each [['all', 'All'], ['send', 'Sent'], ['recv', 'Received']] as [id, label] (id)}
              <button type="button" role="radio" aria-checked={frameDir === id} class:on={frameDir === id} onclick={() => (frameDir = id as Dir)} data-testid="frame-dir-{id}">{label}</button>
            {/each}
          </div>
          <span class="count" data-testid="frame-count">{frameRows.length} of {entry.frames.length}</span>
        </div>
        {#if frameRe === 'bad'}<p class="none">That is not a valid regular expression.</p>{/if}
        <ol class="frames" data-testid="frames">
          <li class="fhead" aria-hidden="true"><span>Time</span><span></span><span>Data</span><span>Length</span></li>
          {#each frameRows as { f, i } (i)}
            <li class="op-{f.op}" class:sel={frameSel === i} data-testid="frame">
              <button type="button" onclick={() => (frameSel = frameSel === i ? null : i)} aria-pressed={frameSel === i}>
                <span class="t">{fmtClock(f.at)}</span>
                <span class="op" title={dirLabel(f)} aria-label={dirLabel(f)}>{f.op === 'send' ? '\u2191' : isRecv(f.op) ? '\u2193' : '\u2022'}</span>
                <code class:bin={f.binary} data-testid="frame-data">{f.event && !f.binary ? `${f.event}: ` : ''}{frameText(f)}</code>
                <span class="len" data-testid="frame-length">{f.length != null ? fmtBytes(f.length) : ''}</span>
              </button>
            </li>
          {:else}
            <li class="empty"><span class="none">No frames match.</span></li>
          {/each}
        </ol>
        {#if selFrame}
          <div class="fdetail" data-testid="frame-detail">
            <h4>{dirLabel(selFrame)} at {fmtClock(selFrame.at)}{selFrame.length != null ? `, ${fmtBytes(selFrame.length)}` : ''}{selFrame.truncated ? ' (cut)' : ''}</h4>
            {#if selFrame.binary}<p class="none">{frameText(selFrame)}. Binary payloads are not kept.</p>
            {:else if selFrame.data}<pre class:json={selPretty.json}>{selPretty.text}</pre>
            {:else}<p class="none">No data.</p>{/if}
          </div>
        {/if}
      {:else if entry.responseBody}
        <BodyView text={entry.responseBody} testid="response-body" />
      {:else}<p class="none">{entry.state === 'pending' ? 'No response arrived before the capture ended.' : 'No response body was captured.'}</p>{/if}
    {:else}
      <dl class="timing">
        <dt>Started</dt><dd>{fmtClock(entry.at)} into the capture</dd>
        <dt>Duration</dt><dd>{entry.state === 'pending' ? 'still waiting' : fmtDuration(entry.durationMs)}</dd>
        {#if entry.timing}
          {#if entry.timing.dns != null}<dt>DNS</dt><dd>{fmtDuration(entry.timing.dns)}</dd>{/if}
          {#if entry.timing.connect != null}<dt>Connect</dt><dd>{fmtDuration(entry.timing.connect)}</dd>{/if}
          {#if entry.timing.ttfb != null}<dt>Waiting (TTFB)</dt><dd>{fmtDuration(entry.timing.ttfb)}</dd>{/if}
          {#if entry.timing.download != null}<dt>Download</dt><dd>{fmtDuration(entry.timing.download)}</dd>{/if}
        {/if}
      </dl>
    {/if}
  </div>
</section>

<style>
  .pane { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--nb-surface); }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--nb-border); }
  .status { font: 600 var(--nb-text-sm) var(--nb-font-mono); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--nb-text-sm) var(--nb-font-mono); color: var(--nb-text-muted); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; flex: none; }
  .dot.ok { background: var(--nb-success); }
  .dot.warn { background: var(--nb-warning); }
  .dot.bad { background: var(--nb-danger); }
  .dot.pend { background: var(--nb-text-faint); }
  .btn { all: unset; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); font-size: var(--nb-text-sm); font-weight: var(--nb-weight-medium); cursor: pointer; white-space: nowrap; box-shadow: var(--nb-shadow-sm); transition: border-color var(--nb-dur-fast) var(--nb-ease-out); }
  .btn:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  .btn:focus-visible, .x:focus-visible, .subs button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .x { all: unset; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--nb-radius-sm); cursor: pointer; color: var(--nb-text-muted); }
  .x:hover { background: var(--nb-surface-sunken); }
  .subs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--nb-border); }
  .subs button { all: unset; padding: 7px 8px; font-size: var(--nb-text-md); color: var(--nb-text-muted); cursor: pointer; border-bottom: 2px solid transparent; }
  .subs button:hover { color: var(--nb-text); }
  .subs button.on { color: var(--nb-text); border-bottom-color: var(--nb-text); font-weight: var(--nb-weight-medium); }
  .body { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 16px; font: var(--nb-text-sm) / 1.5 var(--nb-font-mono); }
  details { margin-top: 6px; }
  summary { display: flex; align-items: center; gap: 4px; padding: 4px 0; list-style: none; cursor: pointer; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  summary:hover { color: var(--nb-text); }
  summary::-webkit-details-marker { display: none; }
  details:not([open]) summary :global(.chev) { transform: rotate(-90deg); }
  summary .n { font-weight: 400; color: var(--nb-text-faint); }
  h4 { margin: 10px 0 4px; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  dl { display: grid; grid-template-columns: minmax(90px, max-content) 1fr; gap: 2px 12px; margin: 0; }
  dt { color: var(--nb-text-faint); }
  /* long values wrap at word boundaries, breaking inside a word only when nothing else fits */
  dd { margin: 0; overflow-wrap: anywhere; word-break: normal; }
  .masked { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 999px; background: var(--nb-success-tint); color: var(--nb-success); font-family: var(--nb-font-sans); }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .none { color: var(--nb-text-muted); font-family: var(--nb-font-sans); }
  .frames { list-style: none; margin: 0; padding: 0; }
  .ffilter { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .ffilter input { flex: 1; min-width: 120px; height: 26px; padding: 0 8px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text); font: inherit; }
  .ffilter input.bad { border-color: var(--nb-danger); }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); }
  .seg button { all: unset; padding: 2px 9px; border-radius: var(--nb-radius-pill); font: var(--nb-text-sm) var(--nb-font-sans); color: var(--nb-text-muted); cursor: pointer; }
  .seg button.on { background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .count { color: var(--nb-text-faint); font-family: var(--nb-font-sans); }
  .frames li > button, .frames .fhead { all: unset; box-sizing: border-box; width: 100%; display: grid; grid-template-columns: 34px 12px minmax(0, 1fr) auto; gap: 6px; padding: 3px 0; cursor: pointer; }
  .frames .fhead { cursor: default; color: var(--nb-text-faint); font: 600 var(--nb-text-xs) var(--nb-font-sans); }
  .frames li { border-bottom: 1px solid var(--nb-border); }
  .frames li.sel { background: var(--nb-surface-sunken); }
  .frames .len { color: var(--nb-text-muted); text-align: right; }
  /* the whole frame shows, wrapped (J-062) */
  .frames code { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7.5em; overflow: hidden; }
  .frames code.bin { color: var(--nb-text-muted); font-style: italic; }
  .fdetail { margin-top: 10px; border-top: 1px solid var(--nb-border); }
  .frames .t { color: var(--nb-text-faint); }
  .frames .op { font-weight: 700; text-align: center; }
  .frames .op-send .op { color: var(--nb-accent-text); }
  .frames .op-recv .op, .frames .op-message .op { color: var(--nb-success); }
</style>
