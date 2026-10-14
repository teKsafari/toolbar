import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './index.ts';

/** The drizzle/ folder: next to package.json in dev, copied next to build/ in the image. */
export function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const candidates = [path.resolve(process.cwd(), 'drizzle'), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle')];
  return candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json'))) ?? candidates[0]!;
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
