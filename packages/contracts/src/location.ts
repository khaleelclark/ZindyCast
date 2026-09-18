import {z} from 'zod';
export const CoordinatesSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
export const LocationSchema = CoordinatesSchema.extend({ id: z.string().min(1), name: z.string().min(1), admin1: z.string().optional(), admin2: z.string().optional(), country: z.string(), timezone: z.string().min(1) });
export type Location = z.infer<typeof LocationSchema>;
