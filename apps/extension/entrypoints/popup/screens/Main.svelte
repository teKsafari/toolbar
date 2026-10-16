<script lang="ts">
  // The capture menu (J-001, J-019, J-026, J-035, J-239, J-011, J-014). Rows: screenshot,
  // record, instant replay (when on) and recording link, then Start trace (Part 2). The session decides which rows live.
  import { Icon, Segmented } from '@toolbar/ui';
  import { popupActions, type RecordMode, type TraceState } from '@toolbar/shared/ext';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';
  import CaptureRow from '../lib/CaptureRow.svelte';

  const s = $derived(store.session);
  const actions = $derived(popupActions(s, { ...store.replay, enabled: store.settings.instantReplay }));
  const live = $derived(s.state === 'countdown' || s.state === 'starting' || s.state === 'recording');
  const arming = $derived(s.state === 'arming-screenshot');
  const ctx = $derived(store.context);

  // the record mode on this page: our own server pages default to desktop (J-019)
  let recordMode: RecordMode = $state('tab');
  $effect(() => {
    recordMode = ctx?.recordMode ?? store.settings.recordMode;
  });
  let delay = $state(0);
  $effect(() => {
    delay = store.settings.screenshotDelaySec === 6 || store.settings.screenshotDelaySec === 3 ? store.settings.screenshotDelaySec : 0;
  });

  const recordLabel = $derived(recordMode === 'tab' ? 'Record this tab' : recordMode === 'screen' ? 'Record a window' : 'Record full screen');
  const recordIcon = $derived(recordMode === 'tab' ? 'record' : 'monitor');

  async function run<T extends { ok: boolean }>(p: Promise<T>, close = true) {
    store.error = '';
    const r = await p;
    if (!r.ok) {
      store.error = errorText(r as unknown as { ok: false; error: string; message?: string });
      return;
    }
    if (close) window.close();
  }

  const tabId = $derived(ctx?.tabId ?? undefined);

  function screenshot() {
    if (arming) return run(send('screenshot.cancel', {}));
    return run(send('capture', { mode: 'screenshot', tabId, delaySec: delay }));
  }
  function record() {
    if (live) return run(send('recording.stop', {}));
    return run(send('capture', { mode: 'video', tabId, recordMode }));
  }
  function replay() {
    if (ctx?.heavy) {
      store.screen = 'heavy';
      return;
    }
    return run(send('capture', { mode: 'replay', tabId }));
  }

  // Part 2 traces: one trace at a time, beside any capture (lib/bg/trace.ts)
  let trace = $state<TraceState | null>(null);
  let traceBusy = $state(false);
  $effect(() => {
    void send('trace.get', {}).then((r) => {
      if (r.ok) trace = r.trace;
    });
  });
  const traceHere = $derived(!!trace && trace.tabId === tabId);
  const traceLabel = $derived(
    traceBusy ? (trace ? 'Stopping trace...' : 'Starting trace...') : trace ? (traceHere ? 'Stop trace' : 'Stop trace (other tab)') : 'Start trace',
  );
  async function toggleTrace() {
    if (traceBusy) return;
    traceBusy = true;
    try {
      if (trace) await run(send('trace.stop', {}));
      else await run(send('trace.start', { tabId }));
    } finally {
      traceBusy = false;
    }
  }

  async function setRecordMode(m: RecordMode) {
    recordMode = m;
    await store.updateSettings({ recordMode: m }); // sticky (flow D)
  }
  async function setDelay(d: number) {
    delay = d;
    await store.updateSettings({ screenshotDelaySec: d as 0 | 3 | 6 });
  }

  async function toggleMic(e: Event) {
    e.stopPropagation();
    const on = !store.settings.mic;
    if (on) {
      // first use opens the one-time permission page (J-014); a refusal leaves the mic off
      const r = await send('mic.request', {});
      if (r.ok && !r.granted) {
        store.error = 'Microphone permission was not granted';
        return;
      }
    }
    await store.updateSettings({ mic: on });
  }
</script>

<div class="rows" data-screen="main">
  <CaptureRow
    id={arming ? 'exit-screenshot' : 'screenshot'}
    icon={arming ? 'close' : 'screenshot'}
    label={arming ? 'Exit screenshot mode' : delay ? `Screenshot in ${delay} s` : 'Screenshot'}
    tone={arming ? 'danger' : 'default'}
    disabled={!actions.includes(arming ? 'exit-screenshot' : 'screenshot')}
    command="screenshot-mode"
    onclick={screenshot}
  >
    {#snippet options()}
      <Segmented
        label="Screenshot delay"
        value={delay}
        options={[
          { value: 0, label: 'No delay' },
          { value: 3, label: '3 s', icon: 'timer' },
          { value: 6, label: '6 s', icon: 'timer' },
        ]}
        onchange={setDelay}
      />
    {/snippet}
  </CaptureRow>

  <CaptureRow
    id={live ? 'stop' : 'record'}
    icon={live ? 'stop' : recordIcon}
    label={live ? (s.state === 'countdown' ? 'Cancel recording' : 'Stop recording') : recordLabel}
    tone={live ? 'danger' : 'default'}
    disabled={!actions.includes(live ? 'stop' : 'record')}
    command="record-tab"
    hideOptions={live}
    onclick={record}
  >
    {#snippet extra()}
      <button
        class="pill"
        class:on={store.settings.mic}
        type="button"
        data-mic-pill={store.settings.mic ? 'on' : 'off'}
        aria-label={store.settings.mic ? 'Microphone on, click to turn off' : 'Microphone off, click to turn on'}
        disabled={live}
        onclick={toggleMic}
      >
        <Icon name={store.settings.mic ? 'mic' : 'mic-off'} size={12} />
        {store.settings.mic ? 'Mic on' : 'Mic off'}
      </button>
    {/snippet}
    {#snippet options()}
      <Segmented
        label="Record mode"
        value={recordMode}
        options={[
          { value: 'tab', label: 'Tab', icon: 'tab' },
          { value: 'screen', label: 'Window', icon: 'monitor' },
          { value: 'desktop', label: 'Screen', icon: 'monitor' },
        ]}
        onchange={setRecordMode}
      />
    {/snippet}
  </CaptureRow>

  {#if store.settings.instantReplay}
    <CaptureRow
      id="replay"
      icon="replay"
      label="Instant replay"
      disabled={!actions.includes('replay') || !!ctx?.replayBlocked}
      command="instant-replay"
      onclick={replay}
    >
      {#snippet extra()}
        {#if ctx?.replayBlocked}
          <span class="badge" data-replay-badge="blocked">Off on this site</span>
        {:else if ctx?.heavy}
          <span class="badge warn" data-replay-badge="heavy">Paused: heavy page</span>
        {/if}
      {/snippet}
    </CaptureRow>
  {/if}

  <CaptureRow id="link" icon="link" label="Recording link" disabled={!actions.includes('link')} command="recording-link" onclick={() => (store.screen = 'link')}>
    {#snippet extra()}
      <button class="help" type="button" aria-label="How recording links work" data-link-help onclick={(e) => { e.stopPropagation(); store.screen = 'link-help'; }}>
        <Icon name="help" size={16} />
      </button>
    {/snippet}
  </CaptureRow>

  <!-- Part 2: a trace of this tab's actions, separate from the capture rows above -->
  <CaptureRow id={trace ? 'trace-stop' : 'trace'} icon={trace ? 'stop' : 'eye'} label={traceLabel} tone={trace ? 'danger' : 'default'} disabled={traceBusy} onclick={toggleTrace}>
    {#snippet extra()}
      {#if trace}
        <span class="badge" data-trace-badge title="Actions so far in this trace">{trace.spans} {trace.spans === 1 ? 'action' : 'actions'}</span>
      {/if}
    {/snippet}
  </CaptureRow>

  {#if store.error}<p class="err" role="alert" data-popup-error>{store.error}</p>{/if}
</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pill {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-surface-sunken);
    color: var(--nb-text-muted);
    font: var(--nb-weight-medium) var(--nb-text-xs) / 1 var(--nb-font-sans);
    cursor: pointer;
  }
  .pill.on {
    background: var(--nb-accent-tint);
    color: var(--nb-accent-text);
  }
  .pill:disabled {
    cursor: default;
  }
  .pill:focus-visible,
  .help:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
  .help {
    all: unset;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--nb-text-faint);
    cursor: pointer;
  }
  .help:hover {
    color: var(--nb-text);
    background: var(--nb-surface-sunken);
  }
  .badge {
    height: 20px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-surface-sunken);
    color: var(--nb-text-muted);
    font: var(--nb-weight-medium) var(--nb-text-xs) / 1 var(--nb-font-sans);
  }
  .badge.warn {
    background: var(--nb-warning-tint);
    color: var(--nb-warning-text);
  }
  .err {
    margin: 0;
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
</style>
