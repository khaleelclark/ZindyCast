import type {FastifyInstance} from 'fastify';
// MUI requires inline styles; scripts remain same-origin without eval/inline permission.
// MapLibre uses same-origin workers and blob-backed NOAA images; Mapbox styled tiles and OSM are the only external runtime origins.
export const CONTENT_SECURITY_POLICY = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://tile.openstreetmap.org https://api.mapbox.com", "connect-src 'self' blob: https://tile.openstreetmap.org https://api.mapbox.com", "worker-src 'self'", "font-src 'self' data:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].join('; ');
export function registerHeaders(app:FastifyInstance) {
 app.addHook('onRequest',async(_request,reply)=>{
  reply.header('Content-Security-Policy',CONTENT_SECURITY_POLICY);
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('X-Frame-Options','DENY');
  reply.header('Referrer-Policy','strict-origin-when-cross-origin');
  reply.header('Permissions-Policy','camera=(), microphone=(), payment=(), geolocation=(self)');
 });
}
