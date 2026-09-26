import { createSign } from 'node:crypto';
import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import type { PushPayload } from './pushSend.server';
import { ridePushMessages, isRidePushStatus, safeNotificationPath } from './passengerRidePush';
let cached: { token: string; until: number } | undefined;
async function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const key = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
  if (!key.project_id || !/^[a-z0-9-]+$/.test(key.project_id) || !key.client_email || !key.private_key) throw new Error('Invalid Firebase server configuration');
  if (!cached || cached.until < Date.now()) {
    const now = Math.floor(Date.now()/1000);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:key.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
    const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
    const assertion = `${unsigned}.${signer.sign(key.private_key).toString('base64url')}`;
    const res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', signal:AbortSignal.timeout(10000), body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}) });
    if (!res.ok) throw new Error('Firebase authorization failed');
    const token = await res.json() as {access_token:string;expires_in:number};
    cached = {token:token.access_token,until:Date.now()+(token.expires_in-60)*1000};
  }
  return {project:key.project_id,token:cached.token};
}
export async function sendNativePushToUsers(userIds: string[], payload: PushPayload) {
  const auth = await credentials();
  if (!auth || !userIds.length) return {sent:0,failed:0};
  const {data: tokens, error} = await db.from('native_push_tokens').select('token,user_id,company_id').in('user_id',userIds);
  if (error) throw new Error('Could not load device notification recipients');
  let sent=0,failed=0;
  for (const t of tokens ?? []) {
    const {data: profile} = await db.from('profiles').select('company_id,is_active').eq('id',t.user_id).maybeSingle();
    const {data: company} = await db.from('companies').select('status').eq('id',t.company_id).maybeSingle();
    if (!profile?.is_active || profile.company_id!==t.company_id || company?.status!=='active') continue;
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
        method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},
        // Locked-screen notifications contain no passenger names or addresses.
        body:JSON.stringify({message:{token:t.token,
          notification: payload.rideStatus && isRidePushStatus(payload.rideStatus)
            ? {title:ridePushMessages[payload.rideStatus][0],body:ridePushMessages[payload.rideStatus][1]}
            : {title:'NEMT Solutions',body:'New activity in your company app. Open the app to view it.'},
          data:{url:safeNotificationPath(payload.url)??'/'},
          android:{priority:'high',ttl:payload.rideStatus?'180s':'60s',notification:{sound:'default',tag:payload.tag??'nemt-activity'}}}}),
      });
      if (res.ok) sent++;
      else { failed++; if(res.status===404) await db.from('native_push_tokens').delete().eq('token',t.token); }
    } catch {failed++;}
  }
  return {sent,failed};
}
