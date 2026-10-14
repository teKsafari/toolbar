import { writeFileSync } from 'node:fs';
import { tokensCss } from '../src/tokens.ts';

writeFileSync(new URL('../src/tokens.css', import.meta.url), tokensCss());
console.log('wrote src/tokens.css');
