declare const __TB_TEST_HOOKS__: boolean;
declare const __TB_APP_NAME__: string;

/** True in builds made with WXT_TEST_HOOKS=1 (e2e). Never true in a release build. */
export const TEST_HOOKS: boolean = typeof __TB_TEST_HOOKS__ !== 'undefined' && __TB_TEST_HOOKS__;

/** Closed in release builds (spikes S4); open in test builds so Playwright selectors pierce it. */
export const SHADOW_MODE: 'open' | 'closed' = TEST_HOOKS ? 'open' : 'closed';

/** The name this build was made with (WXT_APP_NAME, default open-toolbar); the manifest name. */
export const BUILD_NAME: string = typeof __TB_APP_NAME__ !== 'undefined' ? __TB_APP_NAME__ : 'open-toolbar';
