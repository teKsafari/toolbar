<script lang="ts">
  // J-169: a sidebar card with four setup steps as links, ticks for done ones, and dismiss.
  import { invalidate } from '$app/navigation';
  import DIcon from './DIcon.svelte';
  import { api } from './api.ts';

  type Ob = { steps: { id: string; label: string; href: string; done: boolean }[]; dismissed: boolean };
  let { data }: { data: Ob | null } = $props();
  let hidden = $state(false);
  const done = $derived(data ? data.steps.filter((s) => s.done).length : 0);

  async function dismiss() {
    hidden = true;
    await api('dashboard.dismissOnboarding').catch(() => {});
    await invalidate('tb:shell');
  }
</script>

{#if data && !data.dismissed && !hidden}
  <section class="ob" aria-label="Get set up" data-testid="onboarding">
    <div class="top">
      <strong>Get set up</strong>
      <button class="x" aria-label="Dismiss setup steps" onclick={dismiss} data-testid="onboarding-dismiss"><DIcon name="close" size={12} /></button>
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={data.steps.length} aria-valuenow={done}>
      <span style="width:{(done / data.steps.length) * 100}%"></span>
    </div>
    <ol>
      {#each data.steps as s (s.id)}
        <li class:done={s.done}>
          <span class="tick">{#if s.done}<DIcon name="check" size={12} />{/if}</span>
          <a href={s.href}>{s.label}</a>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .ob { margin: 12px 0 8px; padding: 10px 12px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .top { display: flex; align-items: center; justify-content: space-between; font-size: var(--nb-text-md); }
  .x { all: unset; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; color: var(--nb-text-faint); cursor: pointer; }
  .x:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .bar { height: 4px; border-radius: 4px; background: var(--nb-surface-sunken); margin: 8px 0; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--nb-accent); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; align-items: center; gap: 8px; font-size: var(--nb-text-sm); }
  .tick { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--nb-border-strong); color: var(--nb-on-accent); }
  .done .tick { background: var(--nb-success); border-color: var(--nb-success); }
  .done a { color: var(--nb-text-faint); text-decoration: line-through; }
  a { color: var(--nb-text); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
