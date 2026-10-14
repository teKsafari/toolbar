<script lang="ts">
  // On/off switch. Toggling applies at once; there is no save button (ergonomics.md).
  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
    id?: string;
  }
  let { checked = $bindable(false), label, disabled = false, onchange, id }: Props = $props();

  function flip() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button class="nb-switch" class:on={checked} type="button" role="switch" aria-checked={checked} aria-label={label} {disabled} {id} onclick={flip}>
  <span class="nb-knob"></span>
</button>

<style>
  .nb-switch {
    all: unset;
    box-sizing: border-box;
    flex: none;
    width: 34px;
    height: 20px;
    padding: 2px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-border-strong);
    cursor: pointer;
    transition: background var(--nb-dur-fast) var(--nb-ease-out);
  }
  .nb-switch.on {
    background: var(--nb-accent);
  }
  .nb-switch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .nb-switch:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-knob {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--nb-shadow-sm);
    transition: translate var(--nb-dur-fast) var(--nb-ease-out);
  }
  .on .nb-knob {
    translate: 14px 0;
  }
</style>
