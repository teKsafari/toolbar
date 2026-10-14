<script lang="ts">
  // Recording link explainer (J-016): three cards inside the popup, paged with next.
  import { Button } from '@toolbar/ui';
  import { store } from '../lib/store.svelte';
  import ScreenHead from '../lib/ScreenHead.svelte';

  const cards = [
    { title: 'Send a link', body: 'Create a recording link and paste it into a ticket, a chat or an email.', art: 'send' },
    { title: 'They record their screen', body: 'Whoever opens it records their screen and voice in the browser. No extension and no account needed.', art: 'record' },
    { title: 'It lands in your workspace', body: 'The capture shows up in your workspace and you get an email when it arrives.', art: 'inbox' },
  ] as const;
  let i = $state(0);
  const card = $derived(cards[i]!);
</script>

<div data-screen="link-help">
  <ScreenHead title="Recording links" onback={() => (store.screen = 'main')} />
  <div class="card" data-help-card={i + 1}>
    <svg class="art" viewBox="0 0 120 64" aria-hidden="true">
      {#if card.art === 'send'}
        <rect x="14" y="14" width="64" height="36" rx="6" class="paper" />
        <path d="M24 32h30M24 40h20" class="ink" />
        <path d="M84 32h22m-8-8 8 8-8 8" class="accent" />
      {:else if card.art === 'record'}
        <rect x="18" y="10" width="84" height="44" rx="6" class="paper" />
        <circle cx="60" cy="32" r="10" class="accent-fill" />
        <rect x="46" y="58" width="28" height="3" rx="1.5" class="ink-fill" />
      {:else}
        <path d="M20 20h80l-10 30H30z" class="paper" />
        <rect x="44" y="8" width="32" height="22" rx="3" class="accent-fill" />
        <path d="M30 40h60" class="ink" />
      {/if}
    </svg>
    <h3>{card.title}</h3>
    <p>{card.body}</p>
  </div>
  <div class="foot">
    <span class="dots" aria-label="Card {i + 1} of {cards.length}">
      {#each cards as _, k (k)}<span class:on={k === i}></span>{/each}
    </span>
    {#if i < cards.length - 1}
      <Button variant="primary" size="sm" onclick={() => i++} data-help-next>Next</Button>
    {:else}
      <Button variant="primary" size="sm" onclick={() => (store.screen = 'link')} data-help-done>Create a link</Button>
    {/if}
  </div>
</div>

<style>
  .card {
    padding: 16px;
    border-radius: var(--nb-radius-lg);
    background: var(--nb-surface-2);
    border: 1px solid var(--nb-border);
    text-align: center;
  }
  .art {
    width: 120px;
    height: 64px;
  }
  .paper {
    fill: var(--nb-surface);
    stroke: var(--nb-border-strong);
    stroke-width: 2;
  }
  .ink {
    stroke: var(--nb-text-faint);
    stroke-width: 3;
    stroke-linecap: round;
    fill: none;
  }
  .ink-fill {
    fill: var(--nb-text-faint);
  }
  .accent {
    stroke: var(--nb-accent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }
  .accent-fill {
    fill: var(--nb-accent);
  }
  h3 {
    margin: 8px 0 4px;
    font: var(--nb-weight-semibold) var(--nb-text-base) / 1.3 var(--nb-font-sans);
  }
  p {
    margin: 0;
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
  .foot {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--nb-border-strong);
  }
  .dots span.on {
    background: var(--nb-accent);
  }
</style>
