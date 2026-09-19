import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
export async function serveWeb(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {root, preCompressed:true, index:['index.html'], cacheControl:false,
    setHeaders(reply,path) {
      reply.header('Cache-Control', /\/static\/(js|css)\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      reply.header('X-Content-Type-Options','nosniff');
    }
  });
  app.get('/wet-bulb-tracker', async (_request, reply) => reply.header('Cache-Control','no-cache').sendFile('index.html'));
}
