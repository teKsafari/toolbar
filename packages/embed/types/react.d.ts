// Types of @open-toolbar/embed/react (written by hand; test/types.test.ts keeps them in step with src/).
import type { InitOptions } from './index.js';

export { init, type InitOptions } from './index.js';

export interface OpenToolbarProps {
  /** the project's embed key, `tbk_...` */
  siteKey: string;
  /** the open-toolbar server */
  server: string;
  user?: InitOptions['user'];
}

/** Starts the toolbar in an effect and renders nothing, so server rendering never touches window. */
export function OpenToolbar(props: OpenToolbarProps): null;
