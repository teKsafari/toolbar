<script lang="ts">
  // The review link's page (D-200): one button that opens the site with the toolbar. Before the
  // hand-off the page checks that the injector answers on the site (its /__toolbar/health allows
  // any origin), so a site that is not behind the injector shows a clear message instead of the
  // app's own error page. The hand-off is a form post, so the cookie value never sits in a URL,
  // a log or a Referer.
  import { onMount, tick } from 'svelte';
  import { Button, Icon } from '@toolbar/ui';
  import { page } from '$app/state';
  import BrandMark from '#lib/components/BrandMark.svelte';

  let { data, form } = $props();
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  const go = $derived(data.go);
  const host = $derived(go.state === 'ready' || go.state === 'not_allowed' ? go.host : '');

  type Probe = 'checking' | 'ok' | 'unreachable';
  let probe = $state<Probe>('checking');
  let handoffForm: HTMLFormElement | undefined = $state();
  let opening = $state(false);

  async function check(): Promise<boolean> {
    if (go.state !== 'ready') return false;
    probe = 'checking';
    try {
      const res = await fetch(`${go.origin}/__toolbar/health`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(6000) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      probe = body?.service === 'open-toolbar-injector' ? 'ok' : 'unreachable';
    } catch {
      probe = 'unreachable';
    }
    return probe === 'ok';
  }

  onMount(() => {
    void check().then(async (ok) => {
      // the dashboard's "Open with toolbar" lands here with the cookie already minted
      if (ok && form?.handoff) {
        opening = true;
        await tick();
        handoffForm?.submit();
      }
    });
  });

  $effect(() => {
    // after this page's own button: the action answered with the hand-off
    if (form?.handoff && probe === 'ok' && handoffForm && !opening) {
      opening = true;
      handoffForm.submit();
    }
  });
</script>

<svelte:head><title>{host ? `Review ${host}` : 'Review link'} · {brandName}</title></svelte:head>

<main class="go" data-testid="go-page" data-state={go.state} data-probe={go.state === 'ready' ? probe : undefined}>
  <div class="brand"><BrandMark size={28} /> {brandName}</div>

  {#if form?.signedOut}
    <h1>Sign in again</h1>
    <p class="sub">Your session ended. Sign in, and the link opens the site.</p>
    <a class="nb-btn nb-primary nb-lg full" href={form.login}>Sign in</a>
  {:else if go.state === 'ready'}
    {#if form?.handoff}
      <form method="POST" action={form.handoff.action} bind:this={handoffForm} class="handoff">
        <input type="hidden" name="token" value={form.handoff.token} />
        <input type="hidden" name="next" value={form.handoff.next} />
      </form>
    {/if}
    {#if probe === 'unreachable'}
      <span class="badge warn"><Icon name="warning" size={18} /></span>
      <h1>The toolbar is not set up on {go.host}</h1>
      <p class="sub" data-testid="go-unreachable">
        {go.host} did not answer as a site behind the {brandName} injector, so the toolbar cannot open there. The site itself is fine. Ask whoever runs it to put it behind the injector, then try again.
      </p>
      <Button variant="primary" size="lg" class="full" onclick={() => void check()} data-testid="go-retry">Try again</Button>
    {:else if opening}
      <h1>Opening {go.host}</h1>
      <p class="sub">
        The toolbar appears at the bottom of the page. If nothing happens, <button type="button" class="link" onclick={() => handoffForm?.submit()}>continue</button>.
      </p>
    {:else}
      {#if go.projectName}<p class="eyebrow">{go.projectName}</p>{/if}
      <h1>Review {go.host}</h1>
      <p class="sub">
        The toolbar will show on {go.host} in this browser for {go.days} days, signed in as <b>{go.email}</b>. Other visitors see the site as always. Turn it off any time from the toolbar’s menu.
      </p>
      {#if form?.refused}<p class="err" role="alert">This link no longer works for you. Ask for a new one.</p>{/if}
      <form method="POST">
        <Button type="submit" variant="primary" size="lg" class="full" disabled={probe !== 'ok'} loading={probe === 'checking'} data-testid="go-open">
          Open {go.host} with the toolbar
        </Button>
      </form>
    {/if}
  {:else if go.state === 'pick_site'}
    <h1>Review {go.projectName}</h1>
    {#if go.sites.length}
      <p class="sub">Pick the site to open with the toolbar.</p>
      <ul class="sites">
        {#each go.sites as s (s.href)}<li><a href={s.href} data-testid="go-site">{s.host}</a></li>{/each}
      </ul>
    {:else}
      <p class="sub">This project has no site to open yet. A workspace admin adds one under Settings, Projects.</p>
    {/if}
  {:else if go.state === 'not_allowed'}
    <span class="badge warn"><Icon name="warning" size={18} /></span>
    <h1>{go.host} is not open for review</h1>
    <p class="sub" data-testid="go-not-allowed">
      {#if go.reason === 'not_listed'}
        This server does not review {go.host}. Its operator lists the sites it reviews in INJECTOR_ORIGINS.
      {:else}
        {go.host} is not in a project of your workspaces. Ask a workspace admin to add it under Settings, Projects, or to invite you to the workspace that has it.
      {/if}
    </p>
    <a class="nb-btn nb-secondary nb-md full" href="/">Go to the dashboard</a>
  {:else if go.state === 'not_found'}
    <h1>This review link does not work</h1>
    <p class="sub">The project is gone, or it belongs to a workspace you are not in. Ask whoever sent the link for a new one.</p>
    <a class="nb-btn nb-secondary nb-md full" href="/">Go to the dashboard</a>
  {:else if go.state === 'bad_link'}
    <h1>This review link is incomplete</h1>
    <p class="sub">It names no site. Copy the link again from the project under Settings, Projects.</p>
    <a class="nb-btn nb-secondary nb-md full" href="/">Go to the dashboard</a>
  {:else}
    <h1>Review links are off</h1>
    <p class="sub">This server has no injector set up (INJECTOR_SECRET is empty), so it cannot open sites with the toolbar.</p>
  {/if}
</main>

<style>
  /* the sign-in page's form card */
  .go {
    box-sizing: border-box;
    width: min(420px, calc(100% - 32px));
    margin: 12vh auto 48px;
    padding: 0 24px 24px;
    display: flex;
    flex-direction: column;
    gap: var(--nb-space-3);
    background: var(--nb-surface);
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
  }
  .brand {
    display: flex; align-items: center; gap: 10px; margin: 0 -24px var(--nb-space-3); padding: 14px 24px;
    border-bottom: 1px solid var(--nb-border);
    font: var(--nb-weight-semibold) var(--nb-text-lg) / 1.2 var(--nb-font-display); letter-spacing: var(--nb-tracking-tight);
  }
  h1 { font-size: var(--nb-text-2xl); margin: 0; overflow-wrap: anywhere; }
  .eyebrow { margin: 0 0 -8px; color: var(--nb-text-muted); font: var(--nb-text-xs) var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; overflow-wrap: anywhere; }
  .sub { margin: -4px 0 var(--nb-space-2); color: var(--nb-text-muted); line-height: var(--nb-leading-relaxed); }
  form { display: flex; flex-direction: column; }
  .handoff { display: none; }
  :global(.full) { width: 100%; }
  .err { color: var(--nb-danger); margin: 0; }
  .link { all: unset; cursor: pointer; color: var(--nb-accent-text); }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
  .sites { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .sites a { display: block; padding: 10px 12px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); color: var(--nb-text); text-decoration: none; font-family: var(--nb-font-mono); font-size: var(--nb-text-md); overflow-wrap: anywhere; }
  .sites a:hover { background: var(--nb-surface-2); }
  .badge {
    display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: var(--nb-radius-md);
    border: 1px solid var(--nb-border); background: var(--nb-surface-2); color: var(--nb-warning-text);
  }
</style>
