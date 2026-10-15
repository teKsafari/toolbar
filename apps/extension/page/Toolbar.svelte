<script lang="ts">
  // The injector's in-page toolbar (D-117): a small bar at the bottom centre with Comment, Start
  // and Stop trace, and a menu. Comment picks an element, then asks for the text; without a trace
  // it sends at once with the last minute of console, network and DOM replay, during a trace it
  // joins the trace. Positions are set through the CSSOM (no style attributes), so a page CSP
  // without 'unsafe-inline' styles does not break the layout.
  import { onMount } from 'svelte';
  import { describeNode } from '@toolbar/capture';
  import type { TargetRef } from '@toolbar/shared';
  import { UI_HOST_TAG } from '@toolbar/shared/constants';
  import type { PageSession } from './session.ts';
  import type { Bootstrap } from './upload.ts';

  let { session, bootstrap, host }: { session: PageSession; bootstrap: () => Promise<Bootstrap>; host: Element } = $props();

  type Mode = 'idle' | 'picking' | 'composing' | 'stopping';
  let mode: Mode = $state('idle');
  let minimized = $state(false);
  let menuOpen = $state(false);
  let busy = $state(false);
  let tracing = $state(false);
  let queued = $state(0);
  let elapsed = $state(0);
  let text = $state('');
  let who = $state('');
  let toast: { text: string; href?: string; error?: boolean } | null = $state(null);

  let hovered: Element | null = null;
  let target: TargetRef | null = $state(null);
  let anchor: DOMRect | null = $state(null);
  let outlineEl: HTMLDivElement | undefined = $state();
  let outlineLabel = $state('');
  let popEl: HTMLDivElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();
  let commentedAt = 0;

  const fromUs = (e: Event) => e.composedPath().includes(host);

  function px(el: HTMLElement | undefined, props: Record<string, number | null>) {
    if (!el) return;
    for (const [k, v] of Object.entries(props)) {
      if (v === null) el.style.removeProperty(k);
      else el.style.setProperty(k, `${Math.round(v)}px`);
    }
  }

  function showOutline(el: Element | null) {
    if (!outlineEl) return;
    if (!el) {
      outlineEl.style.setProperty('display', 'none');
      return;
    }
    const r = el.getBoundingClientRect();
    outlineEl.style.setProperty('display', 'block');
    px(outlineEl, { left: r.left - 2, top: r.top - 2, width: r.width + 4, height: r.height + 4 });
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    outlineLabel = `${el.tagName.toLowerCase()}${id || cls}`;
  }

  function placePop() {
    if (!popEl) return;
    const w = Math.min(320, innerWidth - 32);
    const h = popEl.offsetHeight || 160;
    if (!anchor) {
      px(popEl, { left: (innerWidth - w) / 2, top: null, bottom: 64 });
      return;
    }
    let top = anchor.bottom + 8;
    if (top + h > innerHeight - 64) top = Math.max(8, anchor.top - h - 8);
    const left = Math.min(Math.max(8, anchor.left), innerWidth - w - 8);
    px(popEl, { left, top, bottom: null });
  }

  $effect(() => {
    if (mode === 'composing' || mode === 'stopping') {
      placePop();
      field?.focus();
    }
  });

  function startPicking() {
    menuOpen = false;
    toast = null;
    mode = mode === 'picking' ? 'idle' : 'picking';
    if (mode !== 'picking') showOutline(null);
  }

  function cancel() {
    mode = 'idle';
    text = '';
    target = null;
    anchor = null;
    showOutline(null);
  }

  function onMove(e: PointerEvent) {
    if (mode !== 'picking' || fromUs(e)) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el === hovered) return;
    hovered = el;
    showOutline(el);
  }

  function onClick(e: MouseEvent) {
    if (mode !== 'picking' || fromUs(e)) return;
    // the page does not see the click that picks the element
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.tagName.toLowerCase() === UI_HOST_TAG) return;
    target = describeNode(el);
    anchor = el.getBoundingClientRect();
    commentedAt = Date.now();
    mode = 'composing';
  }

  function swallow(e: Event) {
    if (mode === 'picking' && !fromUs(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && mode !== 'idle') {
      e.preventDefault();
      cancel();
    }
  }

  function fieldKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function fail(e: unknown) {
    const code = (e as { code?: string })?.code ?? (e instanceof Error ? e.message : String(e));
    const msg: Record<string, string> = {
      unauthorized: 'Your review sign-in expired. Open the site again from open-toolbar.',
      forbidden: 'This server did not accept the upload.',
      network: 'Could not reach the server. Try again.',
    };
    toast = { text: msg[code] ?? `Could not send (${code}).`, error: true };
  }

  async function submit() {
    if (busy) return;
    if (mode === 'composing') {
      const comment = text.trim();
      if (!comment) return;
      busy = true;
      try {
        const r = await session.comment({ comment, target: target ?? undefined, t: commentedAt || Date.now(), url: location.href });
        if ('queued' in r) {
          queued = session.trace?.comments.length ?? queued + 1;
          toast = { text: 'Added to the trace.' };
        } else toast = { text: 'Comment sent.', href: r.shareUrl };
        cancel();
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    } else if (mode === 'stopping') {
      busy = true;
      try {
        const r = await session.stopTrace(text.trim());
        tracing = false;
        queued = 0;
        toast = { text: 'Trace sent.', href: r.shareUrl };
        cancel();
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    }
  }

  async function startTrace() {
    menuOpen = false;
    toast = null;
    busy = true;
    try {
      await session.startTrace();
      tracing = true;
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  function stopTrace() {
    toast = null;
    anchor = null;
    mode = 'stopping';
  }

  function signOut() {
    location.href = `/__toolbar/logout?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  const clock = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  onMount(() => {
    const opts = { capture: true };
    addEventListener('pointermove', onMove, opts);
    addEventListener('click', onClick, opts);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const) addEventListener(t, swallow, opts);
    addEventListener('keydown', onKey, opts);
    const tick = setInterval(() => {
      if (session.trace) elapsed = Date.now() - session.trace.startedAt;
    }, 500);
    const sync = () => {
      tracing = !!session.trace;
      queued = session.trace?.comments.length ?? 0;
    };
    sync();
    const off = session.subscribe(sync);
    void bootstrap().then(
      (b) => {
        who = b.user.email;
        const root = host.shadowRoot?.querySelector<HTMLElement>('.tb');
        if (b.branding?.accent) root?.style.setProperty('--tb-accent', b.branding.accent);
      },
      () => {
        who = '';
      },
    );
    return () => {
      removeEventListener('pointermove', onMove, opts);
      removeEventListener('click', onClick, opts);
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const) removeEventListener(t, swallow, opts);
      removeEventListener('keydown', onKey, opts);
      clearInterval(tick);
      off();
    };
  });
</script>

<div class="tb">
  <div class="outline" bind:this={outlineEl}><span class="label">{outlineLabel}</span></div>

  {#if mode === 'picking'}
    <div class="hint" role="status">Click an element to comment. <kbd>Esc</kbd> cancels.</div>
  {/if}

  {#if mode === 'composing' || mode === 'stopping'}
    <div class="pop" bind:this={popEl} role="dialog" aria-label={mode === 'composing' ? 'Comment' : 'Stop trace'}>
      {#if mode === 'composing'}
        {#if target}<div class="about">On {target.name ?? target.text ?? target.selector}</div>{/if}
      {:else}
        <div class="about">Send the trace{queued ? ` with ${queued} comment${queued === 1 ? '' : 's'}` : ''}. A note is optional.</div>
      {/if}
      <textarea bind:this={field} bind:value={text} onkeydown={fieldKey} placeholder={mode === 'composing' ? 'What is wrong here?' : 'What were you trying to do?'} aria-label={mode === 'composing' ? 'Comment' : 'Note'}></textarea>
      <div class="row">
        <kbd class="grow">Ctrl+Enter</kbd>
        <button type="button" onclick={cancel}>Cancel</button>
        <button type="button" class="primary" data-testid="tb-send" disabled={busy || (mode === 'composing' && !text.trim())} onclick={submit}>
          {busy ? 'Sending' : mode === 'composing' ? (tracing ? 'Add' : 'Send') : 'Send trace'}
        </button>
      </div>
    </div>
  {/if}

  {#if toast}
    <div class="toast" class:error={toast.error} role="status">
      <span>{toast.text}</span>
      {#if toast.href}<a href={toast.href} target="_blank" rel="noopener noreferrer">Open</a>{/if}
      <button type="button" class="icon" aria-label="Dismiss" onclick={() => (toast = null)}>×</button>
    </div>
  {/if}

  {#if menuOpen}
    <div class="menu" role="menu">
      {#if who}<div class="who">Signed in as {who}</div>{/if}
      <button type="button" role="menuitem" onclick={() => ((minimized = true), (menuOpen = false))}>Hide toolbar</button>
      <button type="button" role="menuitem" onclick={signOut}>Turn off review on this site</button>
    </div>
  {/if}

  <div class="bar" class:min={minimized} role="toolbar" aria-label="open-toolbar">
    {#if minimized}
      <button type="button" class="icon" aria-label="Show toolbar" onclick={() => (minimized = false)}><span class="mark"></span></button>
    {:else}
      <span class="mark" aria-hidden="true"></span>
      <span class="sep"></span>
      <button type="button" class:on={mode === 'picking'} aria-pressed={mode === 'picking'} onclick={startPicking} disabled={busy}>Comment</button>
      {#if tracing}
        <button type="button" onclick={stopTrace} disabled={busy} aria-label="Stop trace"><span class="rec"></span>Stop <span class="time">{clock(elapsed)}</span></button>
      {:else}
        <button type="button" onclick={startTrace} disabled={busy}>Start trace</button>
      {/if}
      <span class="sep"></span>
      <button type="button" class="icon" aria-label="More" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>⋯</button>
    {/if}
  </div>
</div>
