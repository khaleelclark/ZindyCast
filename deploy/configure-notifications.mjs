import {createECDH,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
// Local operator setup; never prints keys or subscribes a device.
const path=process.argv[2]??join(homedir(),'.config/zindycast/runtime.env');
if(!statSync(path).isFile())throw new Error('Expected existing runtime configuration');
const original=readFileSync(path,'utf8');
const vapidLines=original.split('\n').filter(line=>/^ZINDYCAST_VAPID_/.test(line));
if(vapidLines.some(line=>line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'')!=='')){console.log('Notification configuration already exists; left unchanged.');process.exit(0);}
const originLine=original.split('\n').find(line=>line.startsWith('ZINDYCAST_PUBLIC_ORIGIN='));
const subject=originLine?.slice('ZINDYCAST_PUBLIC_ORIGIN='.length).trim().replace(/^['"]|['"]$/g,'');
if(!subject)throw new Error('Set ZINDYCAST_PUBLIC_ORIGIN to your HTTPS origin before configuring notifications');
const url=new URL(subject);if(url.protocol!=='https:'||url.origin!==subject)throw new Error('Expected configured HTTPS origin');
const keys=createECDH('prime256v1');keys.generateKeys();
const base=original.split('\n').filter(line=>!/^ZINDYCAST_VAPID_/.test(line)).join('\n');
const content=base.trimEnd()+`\nZINDYCAST_VAPID_PUBLIC_KEY=${keys.getPublicKey().toString('base64url')}\nZINDYCAST_VAPID_PRIVATE_KEY=${keys.getPrivateKey().toString('base64url')}\nZINDYCAST_VAPID_SUBJECT=${subject}\n`;
const backup=path+'.before-notifications-'+new Date().toISOString().replace(/[:.]/g,'-');writeFileSync(backup,original,{flag:'wx',mode:0o600});
const temp=path+'.'+randomUUID();writeFileSync(temp,content,{flag:'wx',mode:0o600});renameSync(temp,path);
console.log('Notification keys configured locally. Existing values preserved; devices remain unsubscribed until explicit opt-in.');
