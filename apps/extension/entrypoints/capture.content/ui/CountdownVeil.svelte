<script lang="ts">
  // Pre-roll veil (J-027): the page under a 50% grey veil while the bar counts 3, 2, 1. A card
  // in the middle names the mic state and says a click pauses the count. Hidden while the blur
  // tool is open, so elements can be blurred before the first frame (J-036).
  import { send } from './send';

  interface Props {
    paused: boolean;
    micOn: boolean;
  }
  let { paused, micOn }: Props = $props();

  const toggle = () => void send(paused ? 'countdown.resume' : 'countdown.pause', {});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="nb-veil" data-nb-veil data-nb-interactive role="button" tabindex="-1" aria-label={paused ? 'Resume countdown' : 'Pause countdown'} onclick={toggle}>
  <div class="nb-card">
    <strong>{paused ? 'Countdown paused' : 'Recording this tab'}</strong>
    <span>Microphone {micOn ? 'on' : 'off'}</span>
    <span class="nb-faint">{paused ? 'Click anywhere to continue' : 'Click anywhere to pause'}</span>
  </div>
</div>

<style>
  .nb-veil {
    position: fixed;
    inset: 0;
    background: rgb(18 18 17 / 0.45);
    /* the page blurs under the veil, so the card reads as the one thing to look at (J-027) */
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    pointer-events: auto;
    cursor: pointer;
    animation: nb-fade var(--nb-dur-med) var(--nb-ease-out);
  }
  .nb-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 340px;
    box-sizing: border-box;
    padding: 24px 32px;
    border-radius: var(--nb-radius-xl);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-text-base) / 1.3 var(--nb-font-sans);
  }
  .nb-card strong {
    font-size: var(--nb-text-lg);
    font-weight: var(--nb-weight-semibold);
  }
  .nb-faint {
    color: var(--nb-on-chrome-muted);
    font-size: var(--nb-text-md);
  }
  @keyframes nb-fade {
    from {
      opacity: 0;
    }
  }
</style>
