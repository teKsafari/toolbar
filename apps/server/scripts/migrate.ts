// Apply drizzle/ migrations to DATABASE_URL. `pnpm --filter @toolbar/server db:migrate`
import { db, sqlClient } from '../src/lib/server/db/index.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';

await runMigrations(db);
console.log('[migrate] done');
await sqlClient.end();
