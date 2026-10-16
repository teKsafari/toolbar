// Extension pages (popup, options, editor) follow the stored brand (D-112): accent variables
// on the page root, and the tab title with the brand name.
import { applyAccent, brand, loadBrand } from '../brand.svelte';

export function brandPage(title?: (name: string) => string): void {
  loadBrand();
  $effect.root(() => {
    $effect(() => {
      applyAccent(document.documentElement, brand.accent);
      if (title) document.title = title(brand.name);
    });
  });
}
