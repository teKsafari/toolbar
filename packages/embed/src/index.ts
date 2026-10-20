// @open-toolbar/embed: the reviewer toolbar as a package (D-211).
//   import { init } from '@open-toolbar/embed';
//   init({ key: 'tbk_...', server: 'https://toolbar.example.com' });
// Call it as early as the app starts: console and network capture begin there.
export { init, type InitOptions, type OpenToolbarApi } from './init.ts';
