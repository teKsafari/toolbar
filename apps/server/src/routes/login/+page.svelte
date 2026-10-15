<script lang="ts">
  // Sign-in and sign-up on one page (J-217): provider buttons, an or-divider, then work email.
  // Continue mails a one-time link; "Use a password" swaps in a password field instead.
  import { Button, Icon } from '@toolbar/ui';
  import { PRODUCT_NAME } from '@toolbar/shared';

  let { data, form } = $props();
  let usePassword = $state(false);
  let email = $state('');
  $effect.pre(() => {
    if (form?.email) email = form.email;
    if (form?.mode === 'password') usePassword = true;
  });
  const valid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const opts = $derived(data.options);
  const errorText: Record<string, string> = {
    INVALID_TOKEN: 'That sign-in link was already used or has expired. Ask for a new one.',
    EXPIRED_TOKEN: 'That sign-in link has expired. Ask for a new one.',
    access_denied: 'This server only lets in addresses of its allowed email domains.',
    unable_to_create_user: 'This server only lets in addresses of its allowed email domains.',
    FORBIDDEN: 'This server only lets in addresses of its allowed email domains.',
    unable_to_create_session: 'This server only lets in addresses of its allowed email domains.',
  };
</script>

<svelte:head><title>Sign in · {PRODUCT_NAME}</title></svelte:head>

<main class="login">
  <div class="brand"><span class="mark"><Icon name="logo" size={22} /></span> {PRODUCT_NAME}</div>

  {#if form?.sent}
    <section class="sent" aria-live="polite">
      <span class="badge"><Icon name="check" size={18} /></span>
      <h1>Check your inbox</h1>
      <p>We sent a sign-in link to <b>{form.email}</b>. Open it on this device to continue.</p>
      {#if data.mailHint}<p class="hint">Local server: mail lands in <a href={data.mailHint} target="_blank" rel="noreferrer">Mailpit</a>.</p>{/if}
      <form method="POST" action="?/magic">
        <input type="hidden" name="email" value={form.email} />
        <input type="hidden" name="next" value={data.next} />
        <Button type="submit" variant="ghost" size="sm">Send it again</Button>
        <a class="link" href="/login{data.next !== '/' ? `?next=${encodeURIComponent(data.next)}` : ''}">Use another email</a>
      </form>
    </section>
  {:else}
    <h1>{data.fromExtension ? `Connect the ${PRODUCT_NAME} extension` : `Sign in to ${PRODUCT_NAME}`}</h1>
    <p class="sub">New here? The same steps create your account.</p>

    {#if opts.providers.length}
      <div class="providers">
        {#each opts.providers as p (p.id)}
          <form method="POST" action="?/provider">
            <input type="hidden" name="provider" value={p.id} />
            <input type="hidden" name="next" value={data.next} />
            <Button type="submit" size="lg" class="full" data-provider={p.id}>
              Continue with {p.name}
            </Button>
          </form>
        {/each}
      </div>
    {/if}

    {#if opts.magicLink || opts.emailPassword}
      {#if opts.providers.length}<div class="or" role="separator"><span>or</span></div>{/if}
      <form method="POST" action={usePassword || !opts.magicLink ? '?/password' : '?/magic'} class="stack">
        <input type="hidden" name="next" value={data.next} />
        <label for="email">Work email</label>
        <input id="email" type="email" name="email" autocomplete="email" placeholder="you@company.com" required bind:value={email} />
        {#if usePassword || !opts.magicLink}
          <label for="password">Password</label>
          <input id="password" type="password" name="password" autocomplete="current-password" minlength="8" required />
          <span class="hint">At least 8 characters. A new address gets a new account.</span>
        {/if}
        <Button type="submit" variant="primary" size="lg" class="full" disabled={!valid}>Continue</Button>
      </form>
      {#if opts.magicLink && opts.emailPassword}
        <button class="link swap" type="button" onclick={() => (usePassword = !usePassword)}>
          {usePassword ? 'Email me a sign-in link instead' : 'Use a password instead'}
        </button>
      {/if}
    {/if}

    {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}
    {#if data.error}<p class="err" role="alert">{errorText[data.error] ?? 'Sign-in did not finish. Try again.'}</p>{/if}
    {#if !opts.emailPassword && !opts.magicLink && !opts.providers.length}
      <p class="err" data-testid="no-sign-in">No sign-in method is configured. Set the OIDC_1_* variables in .env (docs/scope.md, "Sign-in").</p>
    {/if}
  {/if}
</main>

<style>
  .login {
    max-width: 360px;
    margin: 14vh auto 48px;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: var(--nb-space-3);
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: var(--nb-weight-semibold); font-size: var(--nb-text-lg); margin-bottom: var(--nb-space-4); }
  .mark {
    display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: var(--nb-radius-lg);
    background: var(--nb-accent); color: var(--nb-on-accent);
  }
  h1 { font-size: var(--nb-text-xl); margin: 0; }
  .sub { margin: -4px 0 var(--nb-space-2); color: var(--nb-text-muted); }
  .providers { display: flex; flex-direction: column; gap: var(--nb-space-2); }
  .providers form { display: flex; flex-direction: column; }
  .stack { display: flex; flex-direction: column; gap: var(--nb-space-2); }
  label { font-size: var(--nb-text-md); color: var(--nb-text-muted); margin-top: var(--nb-space-1); }
  :global(.full) { width: 100%; margin-top: var(--nb-space-1); }
  .or { display: flex; align-items: center; gap: 10px; color: var(--nb-text-faint); font-size: var(--nb-text-sm); margin: var(--nb-space-1) 0; }
  .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--nb-border); }
  .hint { font-size: var(--nb-text-sm); color: var(--nb-text-faint); margin: 0; }
  .link { all: unset; cursor: pointer; color: var(--nb-accent-text); font-size: var(--nb-text-md); }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
  .swap { align-self: center; }
  .err { color: var(--nb-danger); margin: 0; }
  .sent { display: flex; flex-direction: column; gap: var(--nb-space-2); }
  .sent p { margin: 0; }
  .sent form { display: flex; align-items: center; gap: var(--nb-space-3); margin-top: var(--nb-space-2); }
  .badge {
    display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
    background: var(--nb-success-tint); color: var(--nb-success);
  }
</style>
