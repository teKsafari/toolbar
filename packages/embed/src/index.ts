// @open-toolbar/embed: the reviewer toolbar as a package (D-211).
//   import { init } from '@open-toolbar/embed';
//   init({ key: 'tbk_...', server: 'https://toolbar.example.com' });
// Call it as early as the app starts: console and network capture begin there. setUser names the
// reviewer again when the app's signed-in person changes.
export { init, setUser, type InitOptions, type OpenToolbarApi, type ReviewerUser } from './init.ts';
