<script lang="ts">
  // J-017: whoever opens a recording link picks screen only or screen plus voice, starts, picks a
  // source in the browser's picker, records with a small control (an always-on-top
  // picture-in-picture window where the browser offers one), stops, reviews, adds a note, then
  // submits or redoes. J-126: ?title=&folder=&ref=&mic=1 preset the page.
  import { onDestroy } from 'svelte';
  import { PRODUCT_NAME } from '@toolbar/shared';
  import { Button, Icon } from '@toolbar/ui';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { ScreenRecorder, submitRecording, type Recording } from '#lib/components/dashboard/recorder.ts';
  import { page } from '$app/state';

  let { data } = $props();
  type Phase = 'choose' | 'starting' | 'recording' | 'review' | 'uploading' | 'done';
  let phase = $state<Phase>('choose');
  let voice = $state(data.info?.mic ?? false);
  let error = $state<string | null>(null);
  let elapsed = $state(0);
  let result = $state<Recording | null>(null);
  let previewUrl = $state<string | null>(null);
  let note = $state('');
  let pct = $state(0);
  let rec: ScreenRecorder | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pip: Window | null = null;
  const supported = typeof navigator === 'undefined' || !!navigator.mediaDevices?.getDisplayMedia;

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  async function start() {
    error = null;
    phase = 'starting';
    rec = new ScreenRecorder();
    rec.onended = () => void stop();
    try {
      await rec.start(voice);
    } catch (e) {
      rec.release();
      rec = null;
      phase = 'choose';
      const name = (e as DOMException)?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') error = `Recording could not start: ${(e as Error).message}`;
      return;
    }
    phase = 'recording';
    const t0 = Date.now();
    elapsed = 0;
    timer = setInterval(() => {
      elapsed = Date.now() - t0;
      updatePip();
    }, 250);
    void openPip();
  }

  // Always-on-top control window (Document Picture-in-Picture, Chrome 116+); the in-page bar stays as a fallback.
  async function openPip() {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    if (!dpip) return;
    try {
      pip = await dpip.requestWindow({ width: 260, height: 72 });
      pip.document.body.innerHTML = `<div style="display:flex;align-items:center;gap:12px;height:100vh;padding:0 16px;background:#25211c;color:#fff;font:600 15px system-ui">
        <button id="stop" style="width:30px;height:30px;border-radius:8px;border:0;background:#d23c3c;cursor:pointer" aria-label="Stop recording"></button>
        <span id="t" style="font-variant-numeric:tabular-nums">0:00</span><span style="font-weight:400;opacity:.7">Recording</span></div>`;
      pip.document.body.style.margin = '0';
      pip.document.getElementById('stop')?.addEventListener('click', () => void stop());
      pip.addEventListener('pagehide', () => (pip = null));
    } catch {
      pip = null;
    }
  }
  function updatePip() {
    const t = pip?.document.getElementById('t');
    if (t) t.textContent = fmt(elapsed);
  }

  async function stop() {
    if (!rec || phase !== 'recording') return;
    clearInterval(timer);
    pip?.close();
    pip = null;
    result = await rec.stop();
    rec = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(result.video);
    phase = 'review';
  }

  function redo() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    result = null;
    phase = 'choose';
  }

  async function submit() {
    if (!result) return;
    phase = 'uploading';
    error = null;
    pct = 0;
    try {
      await submitRecording(
        page.params.token!,
        result,
        { note: note.trim(), title: data.info?.title ?? null, folder: data.preset?.folder ?? null, ref: data.preset?.ref ?? null },
        (p) => (pct = p),
      );
      phase = 'done';
    } catch (e) {
      error = (e as Error).message;
      phase = 'review';
    }
  }

  onDestroy(() => {
    clearInterval(timer);
    rec?.release();
    pip?.close();
  });
</script>

<svelte:head>
  <title>{data.info ? `Record for ${data.info.workspaceName}` : 'Recording link'}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="rp" data-testid="recorder" data-phase={phase}>
  <header><span class="brand"><Icon name="logo" size={20} />{PRODUCT_NAME}</span></header>

  {#if data.state !== 'ok' || !data.info}
    <section class="card center" data-testid="recorder-unavailable">
      <DIcon name="link" size={30} />
      <h1>{data.state === 'revoked' ? 'This link was turned off' : 'This link does not work'}</h1>
      <p>Ask the person who sent it for a new one.</p>
    </section>
  {:else}
    {@const info = data.info}
    <section class="card">
      <p class="eyebrow">{info.ownerName ? `${info.ownerName} at ${info.workspaceName}` : info.workspaceName} asked you to record</p>
      <h1>{info.title ?? info.name}</h1>
      {#if info.ref}<p class="ref"><DIcon name="issue" size={14} />About <a href={info.ref.url} target="_blank" rel="noopener">{info.ref.key ?? info.ref.url}</a></p>{/if}

      {#if phase === 'choose' || phase === 'starting'}
        <p class="muted">Show what happened on your screen. You pick the window or tab in the next step, and you can watch the recording before you send it. No account or extension needed.</p>
        {#if !supported}
          <p class="err">This browser cannot record the screen. Open the link in a desktop Chrome, Edge or Firefox.</p>
        {/if}
        <div class="choice" role="radiogroup" aria-label="What to record">
          <button role="radio" aria-checked={!voice} onclick={() => (voice = false)} data-testid="choose-screen"><DIcon name="monitor" size={20} /><span><strong>Screen only</strong><small>Video of a window, tab or screen</small></span></button>
          <button role="radio" aria-checked={voice} onclick={() => (voice = true)} data-testid="choose-voice"><DIcon name="mic" size={20} /><span><strong>Screen and voice</strong><small>Talk us through it with your microphone</small></span></button>
        </div>
        <Button variant="primary" size="lg" icon="record" onclick={start} loading={phase === 'starting'} disabled={!supported} data-testid="recorder-start">Start recording</Button>
      {:else if phase === 'recording'}
        <div class="live" data-testid="recorder-live">
          <span class="dot"></span><span class="t" data-testid="recorder-time">{fmt(elapsed)}</span><span class="muted">Recording your screen{voice ? ' and voice' : ''}</span>
          <button class="stop" onclick={stop} data-testid="recorder-stop"><DIcon name="stop" size={14} />Stop</button>
        </div>
        <p class="muted small">Switch to the window you shared and show the problem. Come back here, or use the small control window, to stop.</p>
      {:else if phase === 'review' || phase === 'uploading'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={previewUrl} controls class="pv" data-testid="recorder-preview"></video>
        <label class="note">Add a note <span class="muted">(optional)</span>
          <textarea bind:value={note} rows="3" maxlength="10000" placeholder="What were you trying to do, and what went wrong?" disabled={phase === 'uploading'} data-testid="recorder-note"></textarea>
        </label>
        {#if phase === 'uploading'}
          <div class="prog" data-testid="recorder-progress"><span style="width:{pct}%"></span></div>
          <p class="muted small">Sending {pct}%</p>
        {:else}
          <div class="acts">
            <Button icon="replay" onclick={redo} data-testid="recorder-redo">Record again</Button>
            <Button variant="primary" icon="check" onclick={submit} data-testid="recorder-submit">Send recording</Button>
          </div>
        {/if}
      {:else if phase === 'done'}
        <div class="center" data-testid="recorder-done">
          <span class="ok"><DIcon name="check" size={22} /></span>
          <h2>Sent. Thank you.</h2>
          <p class="muted">{info.ownerName ?? 'The team'} got your recording{note.trim() ? ' and your note' : ''}. You can close this page.</p>
        </div>
      {/if}
      {#if error}<p class="err" role="alert">{error}</p>{/if}
    </section>
    <p class="foot">Recordings made here hold video{voice ? ' and voice' : ''} only; nothing else on your computer is read.</p>
  {/if}
</main>

<style>
  .rp { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 0 16px 40px; background: var(--nb-bg); }
  header { width: 100%; max-width: 640px; padding: 20px 0; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: var(--nb-weight-semibold); color: var(--nb-accent-text); }
  .card {
    width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 14px; padding: 28px;
    border: 1px solid var(--nb-border); border-radius: var(--nb-radius-xl); background: var(--nb-surface); box-shadow: var(--nb-shadow-sm);
  }
  .center { align-items: center; text-align: center; }
  h1 { margin: 0; font-size: var(--nb-text-2xl); }
  h2 { margin: 0; }
  .eyebrow { margin: 0; color: var(--nb-text-muted); font-size: var(--nb-text-md); }
  .ref { margin: 0; display: inline-flex; align-items: center; gap: 6px; font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  p { margin: 0; }
  .small { font-size: var(--nb-text-sm); }
  .choice { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 520px) { .choice { grid-template-columns: 1fr; } .card { padding: 20px; } }
  .choice button {
    all: unset; box-sizing: border-box; display: flex; align-items: flex-start; gap: 12px; padding: 14px; cursor: pointer;
    border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-lg);
  }
  .choice button[aria-checked='true'] { border-color: var(--nb-accent); background: var(--nb-accent-tint); box-shadow: 0 0 0 1px var(--nb-accent); }
  .choice button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .choice span { display: flex; flex-direction: column; gap: 2px; }
  small { color: var(--nb-text-muted); font-size: var(--nb-text-sm); }
  .live { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--nb-radius-pill); background: var(--nb-chrome); color: var(--nb-on-chrome); }
  .live .muted { color: var(--nb-on-chrome-muted); }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--nb-danger); animation: blink 1.2s infinite; }
  @keyframes blink { 50% { opacity: 0.3; } }
  .t { font-variant-numeric: tabular-nums; font-weight: var(--nb-weight-semibold); }
  .stop { all: unset; margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--nb-radius-pill); background: var(--nb-danger); color: #fff; cursor: pointer; font-weight: var(--nb-weight-medium); }
  .stop:focus-visible { outline: 2px solid var(--nb-focus); }
  .pv { width: 100%; max-height: 360px; border-radius: var(--nb-radius-lg); background: #000; }
  .note { display: flex; flex-direction: column; gap: 6px; font-size: var(--nb-text-md); }
  textarea { width: 100%; padding: 10px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); font: inherit; resize: vertical; }
  .acts { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .prog { height: 6px; border-radius: 6px; background: var(--nb-surface-sunken); overflow: hidden; }
  .prog span { display: block; height: 100%; background: var(--nb-accent); transition: width 0.2s; }
  .ok { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--nb-success); color: #fff; }
  .err { color: var(--nb-danger); }
  .foot { margin-top: 14px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); text-align: center; max-width: 640px; }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style>
