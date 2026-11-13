import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// One versioned school board. Compare-and-swap serializes conflicting edits.
export const board = sqliteTable('board', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  body: text('body').notNull(),
});
