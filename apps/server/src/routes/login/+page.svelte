<script lang="ts">
  import { Button, Icon } from '@toolbar/ui';
  import { PRODUCT_NAME } from '@toolbar/shared';

  let { data, form } = $props();
</script>

<svelte:head><title>Sign in · {PRODUCT_NAME}</title></svelte:head>

<main class="login">
  <div class="brand"><Icon name="logo" size={28} /> <span>{PRODUCT_NAME}</span></div>
  <h1>Sign in or create an account</h1>

  {#each data.options.providers as p (p.id)}
    <form method="POST" action="?/provider">
      <input type="hidden" name="provider" value={p.id} />
      <input type="hidden" name="next" value={data.next} />
      <Button type="submit" size="lg" class="full">Continue with {p.name}</Button>
    </form>
  {/each}

  {#if data.options.emailPassword}
    {#if data.options.providers.length}<div class="or"><span>or</span></div>{/if}
    <form method="POST" action="?/email" class="stack">
      <input type="hidden" name="next" value={data.next} />
      <label>Work email <input type="email" name="email" autocomplete="email" required value={form?.email ?? ''} /></label>
      <label>Password <input type="password" name="password" autocomplete="current-password" minlength="8" required /></label>
      <Button type="submit" variant="primary" size="lg" class="full">Continue</Button>
    </form>
  {/if}

  {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}
  {#if !data.options.emailPassword && !data.options.providers.length}
    <p class="err">No sign-in method is configured. Set GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID or OIDC_1_* in .env.</p>
  {/if}
</main>

<style>
  .login {
    max-width: 360px;
    margin: 12vh auto 0;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: var(--nb-space-3);
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 18px; color: var(--nb-accent-text); }
  h1 { font-size: var(--nb-text-xl); margin: var(--nb-space-2) 0; }
  .stack { display: flex; flex-direction: column; gap: var(--nb-space-3); }
  label { display: flex; flex-direction: column; gap: 4px; font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  :global(.full) { width: 100%; }
  .or { display: flex; align-items: center; gap: 8px; color: var(--nb-text-faint); font-size: 12px; }
  .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--nb-border); }
  .err { color: var(--nb-danger); margin: 0; }
</style>
