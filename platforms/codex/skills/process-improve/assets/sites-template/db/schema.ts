import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const worksheets = sqliteTable("worksheets", {
  id: text("id").primaryKey(),
  rowsJson: text("rows_json").notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
