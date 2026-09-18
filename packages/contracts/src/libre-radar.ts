import { z } from 'zod';
const epoch = z.number().int().positive().max(4102444800);
export const LibreRadarCatalogSchema = z.object({
  status: z.literal('success'), generated: epoch, retrievedAt: z.iso.datetime(),
  past: z.array(epoch).max(12), nowcast: z.array(epoch).max(12),
});
