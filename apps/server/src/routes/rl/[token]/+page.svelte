<script lang="ts">
  // J-017: whoever opens a recording link picks screen only or screen plus voice, starts, picks a
  // source in the browser's picker, records with a small control (an always-on-top
  // picture-in-picture window where the browser offers one), stops, reviews, adds a note, then
  // submits or redoes. J-126: ?title=&folder=&ref=&mic=1 preset the page. J-200: a refused or
  // missing microphone shows how to allow it and offers to record without voice.
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import BrandMark from '#lib/components/BrandMark.svelte';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  import { Button, Icon } from '@toolbar/ui';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { MicUnavailableError, ScreenRecorder, micPermission, submitRecording, type Recording } from '#lib/components/dashboard/recorder.ts';
  import { focusNow } from '#lib/components/focus.ts';

  let { data } = $props();
  type Phase = 'choose' | 'starting' | 'recording' | 'review' | 'uploading' | 'done';
  let phase = $state<Phase>('choose');
  // svelte-ignore state_referenced_locally
  let voice = $state(data.info?.mic ?? false);
  let error = $state<string | null>(null);
  let micProblem = $state<'denied' | 'missing' | null>(null);
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

  // A microphone the browser already refuses is known before anything starts (J-200).
  async function chooseVoice() {
    voice = true;
    micProblem = (await micPermission()) === 'denied' ? 'denied' : null;
  }
  $effect(() => {
    if (data.info?.mic) void chooseVoice();
  });
  // A tile click is the start: screen only starts at once, screen and voice checks the
  // microphone first and starts when it can be used (J-017: one click fewer than a separate Start).
  async function pick(withVoice: boolean) {
    if (phase !== 'choose') return;
    if (!withVoice) {
      voice = false;
      micProblem = null;
      return start();
    }
    await chooseVoice();
    if (!micProblem) await start();
  }
  let paused = $state(false);
  let micMuted = $state(false);
  function togglePause() {
    if (!rec) return;
    if (rec.paused) rec.resume();
    else rec.pause();
    paused = rec.paused;
    updatePip();
  }
  function toggleMic() {
    if (!rec?.hasVoice) return;
    rec.setMicMuted(!rec.micMuted);
    micMuted = rec.micMuted;
    updatePip();
  }

  function withoutVoice() {
    voice = false;
    micProblem = null;
    void start();
  }

  async function start() {
    error = null;
    phase = 'starting';
    rec = new ScreenRecorder();
    rec.onended = () => void stop();
    try {
      await rec.start(voice);
      micProblem = null;
    } catch (e) {
      rec.release();
      rec = null;
      phase = 'choose';
      if (e instanceof MicUnavailableError) {
        micProblem = e.reason;
        return;
      }
      const name = (e as DOMException)?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') error = `Recording could not start: ${(e as Error).message}`;
      return;
    }
    phase = 'recording';
    elapsed = 0;
    paused = false;
    micMuted = false;
    timer = setInterval(() => {
      elapsed = rec?.elapsedMs ?? elapsed;
      updatePip();
    }, 250);
    void openPip();
  }

  // Always-on-top control window (Document Picture-in-Picture, Chrome 116+); the in-page bar stays as a fallback.
  async function openPip() {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    if (!dpip) return;
    try {
      pip = await dpip.requestWindow({ width: 300, height: 72 });
      // stop, pause, the timer and the microphone, as on the extension's bar (J-017)
      const btn = 'height:30px;min-width:30px;padding:0 8px;border-radius:8px;border:0;cursor:pointer;font:600 13px system-ui';
      pip.document.body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;height:100vh;padding:0 14px;background:#25211c;color:#fff;font:600 15px system-ui">
        <button id="stop" style="${btn};background:#d23c3c" aria-label="Stop recording"></button>
        <button id="pause" style="${btn};background:#3a352e;color:#fff" aria-label="Pause recording">Pause</button>
        <span id="t" style="font-variant-numeric:tabular-nums">0:00</span><span id="s" style="font-weight:400;opacity:.7">Recording</span>
        ${voice ? `<button id="mic" style="${btn};margin-left:auto;background:#3a352e;color:#fff" aria-label="Mute microphone">Mic on</button>` : ''}</div>`;
      pip.document.body.style.margin = '0';
      pip.document.getElementById('stop')?.addEventListener('click', () => void stop());
      pip.document.getElementById('pause')?.addEventListener('click', togglePause);
      pip.document.getElementById('mic')?.addEventListener('click', toggleMic);
      pip.addEventListener('pagehide', () => (pip = null));
    } catch {
      pip = null;
    }
  }
  function updatePip() {
    const d = pip?.document;
    if (!d) return;
    const t = d.getElementById('t');
    if (t) t.textContent = fmt(elapsed);
    const p = d.getElementById('pause');
    if (p) {
      p.textContent = paused ? 'Resume' : 'Pause';
      p.setAttribute('aria-label', paused ? 'Resume recording' : 'Pause recording');
    }
    const st = d.getElementById('s');
    if (st) st.textContent = paused ? 'Paused' : 'Recording';
    const m = d.getElementById('mic');
    if (m) {
      m.textContent = micMuted ? 'Mic off' : 'Mic on';
      m.setAttribute('aria-label', micMuted ? 'Unmute microphone' : 'Mute microphone');
    }
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
        // titled after the link unless the link presets a title (J-017)
        { note: note.trim(), title: data.info?.title ?? data.info?.name ?? null, folder: data.preset?.folder ?? null, ref: data.preset?.ref ?? null },
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
  <header><span class="brand"><BrandMark size={20} />{brandName}</span></header>

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
          <button role="radio" aria-checked={!voice} disabled={phase !== 'choose' || !supported} onclick={() => void pick(false)} data-testid="choose-screen"><DIcon name="monitor" size={20} /><span><strong>Screen only</strong><small>Video of a window, tab or screen</small></span></button>
          <button role="radio" aria-checked={voice} disabled={phase !== 'choose' || !supported} onclick={() => void pick(true)} data-testid="choose-voice"><DIcon name="mic" size={20} /><span><strong>Screen and voice</strong><small>Talk us through it with your microphone</small></span></button>
        </div>
        {#if voice && micProblem}
          <div class="mic" role="alert" data-testid="mic-help" data-reason={micProblem}>
            <strong>{micProblem === 'denied' ? 'Your browser blocks the microphone for this page' : 'No microphone was found'}</strong>
            {#if micProblem === 'denied'}
              <ol>
                <li>Click the icon left of the address bar (a lock or a sliders icon).</li>
                <li>Set Microphone to Allow, then reload this page.</li>
                <li>On a Mac, also check System Settings, Privacy and Security, Microphone, and turn your browser on.</li>
              </ol>
            {:else}
              <p>Plug in or turn on a microphone, then try again.</p>
            {/if}
            <div class="acts">
              <Button variant="primary" icon="monitor" onclick={withoutVoice} data-testid="record-without-voice">Record without voice</Button>
            </div>
          </div>
        {/if}
        {#if voice && micProblem}
          <Button size="lg" icon="record" onclick={start} loading={phase === 'starting'} disabled={!supported} data-testid="recorder-start">Try again with voice</Button>
        {:else if phase === 'starting'}
          <p class="muted small" data-testid="recorder-starting">Pick what to share in your browser's window.</p>
        {/if}

      {:else if phase === 'recording'}
        <div class="live" data-testid="recorder-live">
          <span class="dot" class:still={paused}></span><span class="t" data-testid="recorder-time">{fmt(elapsed)}</span><span class="muted">{paused ? 'Paused' : `Recording your screen${voice ? ' and voice' : ''}`}</span>
          <button class="ctl" onclick={togglePause} data-testid="recorder-pause">{paused ? 'Resume' : 'Pause'}</button>
          {#if voice}<button class="ctl" onclick={toggleMic} data-testid="recorder-mic">{micMuted ? 'Mic off' : 'Mic on'}</button>{/if}
          <button class="stop" onclick={stop} data-testid="recorder-stop"><DIcon name="stop" size={14} />Stop</button>
        </div>
        <p class="muted small">Switch to the window you shared and show the problem. Come back here, or use the small control window, to stop.</p>
      {:else if phase === 'review' || phase === 'uploading'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={previewUrl} controls class="pv" data-testid="recorder-preview"></video>
        <label class="note">Add a note <span class="muted">(optional)</span>
          <textarea use:focusNow bind:value={note} rows="3" maxlength="10000" placeholder="What were you trying to do, and what went wrong?" disabled={phase === 'uploading'} data-testid="recorder-note"></textarea>
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
  .ctl { all: unset; padding: 6px 10px; border-radius: var(--nb-radius-pill); background: var(--nb-chrome-2); color: var(--nb-on-chrome); cursor: pointer; font-size: var(--nb-text-md); }
  .ctl:focus-visible { outline: 2px solid var(--nb-focus); }
  .dot.still { animation: none; opacity: 0.5; }
  .choice button:disabled { opacity: 0.6; cursor: default; }
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
  .mic { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--nb-warning, var(--nb-border-strong)); border-radius: var(--nb-radius-lg); background: var(--nb-surface-sunken); }
  .mic ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
  .foot { margin-top: 14px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); text-align: center; max-width: 640px; }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style>
