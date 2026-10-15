<script lang="ts">
  // Confirm, then hand the signed reviewer cookie to the app's injector (D-134). The hand-off is a
  // form post, so the cookie value never sits in a URL, a log or a Referer.
  import { Button } from '@toolbar/ui';
  import { page } from '$app/state';
  import BrandMark from '#lib/components/BrandMark.svelte';

  let { data, form } = $props();
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  let handoff: HTMLFormElement | undefined = $state();
  $effect(() => {
    if (form?.handoff && handoff) handoff.submit();
  });
</script>

<svelte:head><title>Review {data.host} · {brandName}</title></svelte:head>

<main class="review">
  <div class="brand"><BrandMark size={28} /> {brandName}</div>
  {#if form?.handoff}
    <h1>Opening {data.host}</h1>
    <form method="POST" action={form.handoff.action} bind:this={handoff}>
      <input type="hidden" name="token" value={form.handoff.token} />
      <input type="hidden" name="next" value={form.handoff.next} />
      <p class="sub">If nothing happens, <Button type="submit" variant="ghost" size="sm">continue</Button>.</p>
    </form>
  {:else}
    <h1>Review {data.host}</h1>
    <p class="sub">
      The toolbar will show on {data.host} in this browser for {data.days} days, signed in as <b>{data.email}</b>. Nothing changes for other visitors. You can turn it off from the
      toolbar, or revoke it under Settings, Connected browsers.
    </p>
    {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
    <form method="POST">
      <Button type="submit" variant="primary">Open {data.host} with the toolbar</Button>
    </form>
  {/if}
</main>

<style>
  .review {
    max-width: 420px;
    margin: 12vh auto 0;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 20px;
    margin: 0;
  }
  .sub {
    color: var(--nb-text-muted);
    margin: 0 0 8px;
    line-height: 1.5;
  }
  .error {
    color: var(--nb-danger);
  }
</style>
