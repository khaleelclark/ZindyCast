import type {FastifyInstance} from 'fastify';
/** Explicit trusted origins: never derive authority from Host or forwarded headers. */
export function registerBoundary(app:FastifyInstance, origins:readonly string[]) {
 const allowed=new Set(origins.map(value=>{
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.origin!==value)throw new Error('Invalid configured application origin');
  return u.origin;
 }));
 const hosts=new Set([...allowed].map(value=>new URL(value).host));
 app.addHook('onRequest',async(request,reply)=>{
  if(!request.headers.host || !hosts.has(request.headers.host.toLowerCase()))return reply.code(421).send({status:'error',code:'invalid_request',message:'Unrecognized application host.'});
  const origin=request.headers.origin;
  if(origin!==undefined && !allowed.has(origin))return reply.code(403).send({status:'error',code:'invalid_request',message:'Unrecognized application origin.'});
 });
}
