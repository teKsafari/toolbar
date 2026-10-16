// Editor area manifest additions, kept out of wxt.config.ts (owned by ext-ui):
// - the editor page loads in an iframe on any site, so it must be web-accessible;
// - clipboardWrite lets the editor copy the new link from the extension, so the page never
//   shows Chrome's clipboard prompt (J-202).
import { defineWxtModule } from 'wxt/modules';

export default defineWxtModule({
  name: 'tb-editor',
  setup(wxt) {
    wxt.hook('build:manifestGenerated', (_wxt, manifest) => {
      const war = (manifest.web_accessible_resources ?? []) as { resources: string[]; matches: string[] }[];
      war.push({ resources: ['editor.html'], matches: ['<all_urls>'] });
      // the bundled faces the in-page UI registers on the host document (D-175, D-176)
      war.push({ resources: ['fonts/*.woff2'], matches: ['<all_urls>'] });
      manifest.web_accessible_resources = war as typeof manifest.web_accessible_resources;
      const perms = new Set(manifest.permissions ?? []);
      perms.add('clipboardWrite');
      manifest.permissions = [...perms];
    });
  },
});
