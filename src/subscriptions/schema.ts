import { z } from "zod";

/** Mirrors the browser's `PushSubscription.toJSON()` shape. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

export const SubscribeRequestSchema = z.object({
  subscription: PushSubscriptionSchema,
  passcode: z.string().min(1),
});

export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;

export const UnsubscribeRequestSchema = z.object({
  endpoint: z.string().min(1),
  passcode: z.string().min(1),
});

export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
