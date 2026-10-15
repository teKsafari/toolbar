// Renders the extension's toolbar icons (16, 32, 48, 128 px PNG) from one SVG or PNG source.
// `node scripts/icons.ts` rewrites public/icon/*.png from assets/icon.svg (the default rectangle,
// D-083). A build with WXT_APP_ICON set renders that file instead, into the build output only
// (wxt.config.ts), so the committed icons stay the default.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const ICON_SIZES = [16, 32, 48, 128] as const;

export async function renderIcons(source: string): Promise<Record<(typeof ICON_SIZES)[number], Buffer>> {
  const input = await readFile(source);
  const out = {} as Record<(typeof ICON_SIZES)[number], Buffer>;
  for (const n of ICON_SIZES) {
    out[n] = await sharp(input, { density: 384 })
      .resize(n, n, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const icons = await renderIcons(process.argv[2] ?? join(root, 'assets', 'icon.svg'));
  for (const [n, buf] of Object.entries(icons)) await writeFile(join(root, 'public', 'icon', `${n}.png`), buf);
  console.log('wrote public/icon/{16,32,48,128}.png');
}
