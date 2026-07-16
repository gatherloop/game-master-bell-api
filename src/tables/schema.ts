import { z } from "zod";

/** Mirrors the `Table` shape from `@game-master-bell/shared` (packages/shared/src/table.ts). */
export const TableSchema = z.object({
  code: z.string().min(1),
  floor: z.number().int().positive(),
  number: z.string().min(1),
  displayName: z.string().min(1),
  active: z.boolean(),
});

export type Table = z.infer<typeof TableSchema>;

export const TablesSchema = z.array(TableSchema);
