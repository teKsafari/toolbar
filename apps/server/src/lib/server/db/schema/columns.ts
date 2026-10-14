// Column helpers shared by every schema file. Ids are uuid with a uuidv7() default (Postgres 18).
// Better Auth passes its own ids, made with our uuidv7 (see auth.ts), so every id sorts by creation time.
import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const created = () => ts('created_at').notNull().defaultNow();
export const updated = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
