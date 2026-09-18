import { z } from 'zod';
import { LocationSchema } from './location';
/** Only known browser push services; never an arbitrary server-side HTTP destination. */
export function validPushEndpoint(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
    ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(u.hostname) && u.pathname.length > 1; } catch { return false; }
}
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(validPushEndpoint),
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.object({ p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict(),
}).strict();
export const NotificationPreferencesSchema = z.object({
  locations: z.array(LocationSchema.extend({ id: z.string().min(1).max(160), name: z.string().min(1).max(160), timezone: z.string().refine(v => {try {new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}) })).min(1).max(5)
    .refine(v=>new Set(v.map(p=>`${p.latitude},${p.longitude}`)).size===v.length),
  quietStart: z.number().int().min(0).max(23).default(22), quietEnd: z.number().int().min(0).max(23).default(7),
  urgentDuringQuiet: z.boolean().default(true),
}).strict();
export const NotificationSaveSchema = z.object({ subscription: PushSubscriptionSchema, preferences: NotificationPreferencesSchema }).strict();
export const NotificationStatusSchema = z.object({ status:z.literal('success'), configured:z.boolean(), publicKey:z.string().nullable(), enabled:z.boolean(), preferences:NotificationPreferencesSchema.nullable(), expiresAt:z.number().nullable(), lastCheckedAt:z.number().nullable(), lastDeliveryAt:z.number().nullable(), lastOutcome:z.enum(['not_checked','checked','source_unavailable','delivered','delivery_failed','subscription_expired']).nullable() });
export type NotificationPreferences=z.infer<typeof NotificationPreferencesSchema>;
export type NotificationSave=z.infer<typeof NotificationSaveSchema>;
export type NotificationStatus=z.infer<typeof NotificationStatusSchema>;
