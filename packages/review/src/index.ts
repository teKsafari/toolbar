// The Part 2 reviewer toolbar (D-212): one UI for the extension and the embed. Set the platform
// (setPlatform) before mounting Review.svelte; see platform.ts.
export { default as Review } from './Review.svelte';
export { review, DOCK_DEFAULT, type DockPos, type Draft, type Tool, type TraceView } from './state.svelte.ts';
export { setPlatform, platform, type ReviewPlatform, type ReviewStorage, type ReviewerIdentity, type ReviewRequestMap, type ReviewRequestType, type ReviewResult, type ReviewFailure, type ReviewTrace } from './platform.ts';
export { errorText } from './errors.ts';
export { setUiRoot, setGuard, swallowClicksFor, swallowPress } from './guard.ts';
