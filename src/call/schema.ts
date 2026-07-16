import { z } from "zod";

/** Mirrors `CallRequestSchema` from `@game-master-bell/shared` (packages/shared/src/call.ts). */
export const CallRequestSchema = z.object({
  tableCode: z.string().min(1),
});

export type CallRequest = z.infer<typeof CallRequestSchema>;
