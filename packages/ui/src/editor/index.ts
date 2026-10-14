// Draft editor (editor area): annotation tools, video trim, submit form. Mount <Editor host={...}>.
export { default as Editor } from './Editor.svelte';
export { default as Annotator } from './Annotator.svelte';
export { default as ToolPill } from './ToolPill.svelte';
export { default as VideoDraft } from './VideoDraft.svelte';
export { default as RichField } from './RichField.svelte';
export { AnnotatorState, SWATCHES, DEFAULT_COLOR, TOOL_KEYS, PASTE_OFFSET } from './annotator.svelte.ts';
export { TrimState, spellDuration, clock, eventsInRange, MIN_TRIM_MS, type TrimRange } from './trim.svelte.ts';
export { flattenPng, flattenToCanvas, canvasToPng, loadImage } from './flatten.ts';
export { draw, canvasMeasure, type Prim, type Drawn } from './render.ts';
export * from './shapes.ts';
export { fieldToDraft, draftToHtml, aiToMarkdown, listRuleFor, type TitleAndBody } from './richtext.ts';
export type * from './types.ts';
