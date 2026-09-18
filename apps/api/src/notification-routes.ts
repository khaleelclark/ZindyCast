import type {FastifyInstance,FastifyRequest} from 'fastify';
import {parseBearerHeader,type InstallationRepository} from '@zindycast/installations';
import {NotificationSaveSchema,NotificationStatusSchema} from '../../../packages/contracts/src/notifications.js';
import type {NotificationRepository} from './notifications-store.js';
export function sameOriginMutation(r:FastifyRequest) {
  if(r.headers['x-zindycast-request']!=='1'||r.headers['sec-fetch-site'] && !['same-origin','none'].includes(r.headers['sec-fetch-site']))return false;
  if(!r.headers.origin)return true;
  try {const u=new URL(r.headers.origin);return ['https:','http:'].includes(u.protocol)&&u.origin===r.headers.origin&&u.host===r.headers.host;}catch{return false;}
}
export function registerNotifications(app:FastifyInstance,repo:NotificationRepository,installations:InstallationRepository,publicKey:string|null) {
  const auth=(r:FastifyRequest)=>{const bearer=parseBearerHeader(r.headers.authorization);return bearer?installations.authenticate(bearer):null;};
  app.get('/api/v1/notifications',async(r,reply)=>{
    const identity=auth(r);
    if(r.headers.authorization&&!identity)return reply.code(401).send({status:'error',code:'invalid_request',message:'Installation access has expired.'});
    return NotificationStatusSchema.parse({status:'success',configured:!!publicKey,publicKey,...(identity?repo.status(identity.id):{enabled:false,preferences:null,expiresAt:null,lastCheckedAt:null,lastDeliveryAt:null,lastOutcome:null})});
  });
  app.post('/api/v1/notifications',async(r,reply)=>{
    if(!sameOriginMutation(r))return reply.code(403).send({status:'error',code:'invalid_request',message:'Same-origin application request required.'});
    const identity=auth(r);if(!identity)return reply.code(401).send({status:'error',code:'invalid_request',message:'Installation access required.'});
    if(!publicKey)return reply.code(503).send({status:'error',code:'not_configured',message:'Warning notifications are not configured.'});
    const parsed=NotificationSaveSchema.safeParse(r.body);if(!parsed.success)return reply.code(400).send({status:'error',code:'invalid_request',message:'Choose 1–5 distinct places and a supported browser subscription.'});
    try {repo.save(identity.id,parsed.data,identity.expiresAt);return NotificationStatusSchema.parse({status:'success',configured:true,publicKey,...repo.status(identity.id)});}catch{return reply.code(409).send({status:'error',code:'invalid_request',message:'Subscription could not be saved. Check its expiry or disable it in its previous installation.'});}
  });
  app.post('/api/v1/notifications/disable',async(r,reply)=>{
    if(!sameOriginMutation(r))return reply.code(403).send({status:'error',code:'invalid_request',message:'Same-origin application request required.'});
    const identity=auth(r);if(!identity)return reply.code(401).send({status:'error',code:'invalid_request',message:'Installation access required.'});
    repo.remove(identity.id);return {status:'success'};
  });
}
