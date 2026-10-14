<script lang="ts">
  // Floating tool pill under the screenshot: colour dot, select, pen, rectangle, ellipse, arrow,
  // line, text, blur, then undo and redo (ergonomics.md "Draft editor").
  import EdIcon from './EdIcon.svelte';
  import Tip from './Tip.svelte';
  import { SWATCHES, SWATCH_NAMES, TOOL_KEYS, type AnnotatorState } from './annotator.svelte.ts';
  import type { Tool } from './shapes.ts';

  interface Props {
    state: AnnotatorState;
  }
  let { state: st }: Props = $props();
  let paletteOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();

  const TOOLS: { tool: Tool; label: string; icon: 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text' | 'blur' }[] = [
    { tool: 'select', label: 'Select', icon: 'select' },
    { tool: 'pen', label: 'Pen', icon: 'pen' },
    { tool: 'rect', label: 'Rectangle', icon: 'rect' },
    { tool: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
    { tool: 'arrow', label: 'Arrow', icon: 'arrow' },
    { tool: 'line', label: 'Line', icon: 'line' },
    { tool: 'text', label: 'Text', icon: 'text' },
    { tool: 'blur', label: 'Blur', icon: 'blur' },
  ];

  $effect(() => {
    if (!paletteOpen || !root) return;
    const doc = root.ownerDocument;
    const onDown = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root)) paletteOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        paletteOpen = false;
      }
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    };
  });

  export function closePalette() {
    paletteOpen = false;
  }
</script>

<div class="nb-pill" bind:this={root} role="toolbar" aria-label="Annotation tools" data-testid="tool-pill">
  <div class="nb-colour-wrap">
    <Tip label="Colour">
      <button
        type="button"
        class="nb-tool"
        aria-label="Colour"
        aria-haspopup="true"
        aria-expanded={paletteOpen}
        data-testid="colour-dot"
        onclick={() => (paletteOpen = !paletteOpen)}
      >
        <span class="nb-dot" style="background:{st.color}" data-colour={st.color}></span>
      </button>
    </Tip>
    {#if paletteOpen}
      <div class="nb-palette" role="listbox" aria-label="Colours" data-testid="palette">
        {#each SWATCHES as c (c)}
          <button
            type="button"
            class="nb-swatch"
            class:nb-on={st.color === c}
            role="option"
            aria-selected={st.color === c}
            aria-label={SWATCH_NAMES[c]}
            data-colour={c}
            style="background:{c}"
            onclick={() => {
              st.setColor(c);
              paletteOpen = false;
            }}
          ></button>
        {/each}
      </div>
    {/if}
  </div>
  {#each TOOLS as t (t.tool)}
    <Tip label={t.label} keys={TOOL_KEYS[t.tool]}>
      <button
        type="button"
        class="nb-tool"
        class:nb-active={st.tool === t.tool}
        aria-label={t.label}
        aria-pressed={st.tool === t.tool}
        data-tool={t.tool}
        onclick={() => st.setTool(t.tool)}
      >
        <EdIcon name={t.icon} size={18} />
      </button>
    </Tip>
  {/each}
  <span class="nb-div" aria-hidden="true"></span>
  <Tip label="Undo" keys="Ctrl+Z">
    <button type="button" class="nb-tool" aria-label="Undo" disabled={!st.canUndo} data-testid="undo" onclick={() => st.undo()}>
      <EdIcon name="undo" size={18} />
    </button>
  </Tip>
  <Tip label="Redo" keys="Ctrl+Shift+Z">
    <button type="button" class="nb-tool" aria-label="Redo" disabled={!st.canRedo} data-testid="redo" onclick={() => st.redo()}>
      <EdIcon name="redo" size={18} />
    </button>
  </Tip>
</div>

<style>
  .nb-pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 46px;
    padding: 0 6px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-surface);
    border: 1px solid var(--nb-border);
    box-shadow: var(--nb-shadow-md);
  }
  .nb-tool {
    all: unset;
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--nb-radius-pill);
    color: var(--nb-text-muted);
    cursor: pointer;
  }
  .nb-tool:hover:not(:disabled) {
    background: var(--nb-surface-sunken);
    color: var(--nb-text);
  }
  .nb-tool:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 1px;
  }
  .nb-tool.nb-active {
    background: var(--nb-accent-tint);
    color: var(--nb-accent-text);
  }
  .nb-tool:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .nb-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }
  .nb-div {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--nb-border);
  }
  .nb-colour-wrap {
    position: relative;
    display: inline-flex;
  }
  .nb-palette {
    position: absolute;
    bottom: calc(100% + 10px);
    left: -6px;
    display: flex;
    gap: 6px;
    padding: 8px;
    border-radius: var(--nb-radius-lg);
    background: var(--nb-surface);
    border: 1px solid var(--nb-border);
    box-shadow: var(--nb-shadow-lg);
    z-index: 30;
  }
  .nb-swatch {
    all: unset;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }
  .nb-swatch.nb-on {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
</style>
