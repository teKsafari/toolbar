// Paused features (docs/scope.md): their pages answer 404 unless the flag is on, so a bookmark or
// an old link reaches nothing the scope hides.
import { error } from '@sveltejs/kit';

export function requireFeature(on: boolean): void {
  if (!on) error(404, 'Not found');
}
