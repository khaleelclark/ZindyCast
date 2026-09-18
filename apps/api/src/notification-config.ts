import {createECDH} from 'node:crypto';
/** Validate VAPID key pairing without contacting a push service or logging key material. */
export function notificationConfig(env:NodeJS.ProcessEnv=process.env) {
  const publicKey=env.ZINDYCAST_VAPID_PUBLIC_KEY,privateKey=env.ZINDYCAST_VAPID_PRIVATE_KEY,subject=env.ZINDYCAST_VAPID_SUBJECT;
  if(!publicKey&&!privateKey&&!subject)return null;
  if(!publicKey||!privateKey||!subject)throw new Error('Incomplete notification configuration');
  try {const u=new URL(subject);if(!['mailto:','https:'].includes(u.protocol))throw new Error();const e=createECDH('prime256v1');e.setPrivateKey(Buffer.from(privateKey,'base64url'));if(e.getPublicKey().toString('base64url')!==publicKey)throw new Error();}catch{throw new Error('Invalid notification configuration');}
  return {subject,publicKey,privateKey};
}
