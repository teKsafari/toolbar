<script lang="ts">
  // On/off switch; toggles save at once with no toast (ergonomics).
  let { checked = $bindable(false), label, disabled = false, onchange, testid }: { checked?: boolean; label: string; disabled?: boolean; onchange?: (v: boolean) => void; testid?: string } = $props();
</script>

<button
  type="button"
  role="switch"
  class="sw"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  data-testid={testid}
  onclick={() => {
    checked = !checked;
    onchange?.(checked);
  }}><span class="knob"></span></button>

<style>
  .sw {
    all: unset; box-sizing: border-box; position: relative; flex: none; width: 34px; height: 20px; border-radius: 999px;
    background: var(--nb-border-strong); cursor: pointer; transition: background var(--nb-dur-fast) var(--nb-ease-out);
  }
  .sw[aria-checked='true'] { background: var(--nb-accent); }
  .sw:disabled { opacity: 0.5; cursor: default; }
  .sw:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .knob {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #ffffff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2); transition: transform var(--nb-dur-fast) var(--nb-ease-out), background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  /* the knob takes on-accent: on the near-white dark accent a white knob would vanish */
  .sw[aria-checked='true'] .knob { transform: translateX(14px); background: var(--nb-on-accent); }
</style>
