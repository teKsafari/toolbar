import { writeFileSync } from 'node:fs';
import { shadowTokensCss, tokensCss } from '../src/tokens.ts';

writeFileSync(new URL('../src/tokens.css', import.meta.url), tokensCss());
writeFileSync(new URL('../src/tokens.shadow.css', import.meta.url), shadowTokensCss());
console.log('wrote src/tokens.css, src/tokens.shadow.css');
