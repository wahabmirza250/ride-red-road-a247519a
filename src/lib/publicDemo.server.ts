import { randomUUID, createHash } from 'node:crypto';
import { getRequest } from '@tanstack/react-start/server';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { prepareActualDemo } from './actualDemo.server';

const ownerEmail = 'public-demo-owner-v1@demo.nemtsolutions.co';
const recent = new Map<string, { since: number; count: number }>();
let provisioning: Promise<string> | undefined;

async function provision(): Promise<string> {
  const db: any = supabaseAdmin;
  async function profile() {
    const result = await db.from('profiles').select('id').eq('email', ownerEmail).maybeSingle();
    if (result.error) throw new Error('Demo setup is temporarily unavailable.');
    return result.data;
  }
  let owner = await profile();
  if (!owner) {
    const created = await db.auth.admin.createUser({ email: ownerEmail, password: randomUUID() + randomUUID(), email_confirm: true, app_metadata: { public_demo_owner: true }, user_metadata: { first_name: 'Public', last_name: 'Demo' } });
    owner = created.data?.user ? { id: created.data.user.id } : await profile();
  }
  if (!owner) throw new Error('Could not prepare the public demo. Please try again.');
  const identity = await db.auth.admin.getUserById(owner.id);
  if (identity.error || identity.data.user?.email !== ownerEmail || identity.data.user?.app_metadata?.public_demo_owner !== true) throw new Error('Public demo ownership could not be verified.');
  await prepareActualDemo(owner.id, { session: false, publicDemo: true });
  return owner.id;
}

export async function openPublicDemo() {
  const request = getRequest();
  const origin = request.headers.get('origin');
  if (origin && origin !== 'https://nemtsolutions.co' && origin !== 'https://www.nemtsolutions.co') throw new Error('Open the demo from nemtsolutions.co/demo.');
  const now = Date.now();
  for (const [key, value] of recent) if (now - value.since > 60_000) recent.delete(key);
  const key = createHash('sha256').update(request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').digest('hex');
  const usage = recent.get(key) ?? { since: now, count: 0 };
  if (usage.count >= 10 || recent.size > 2000) throw new Error('Please wait a minute before reopening the demo.');
  usage.count++; recent.set(key, usage);
  if (!provisioning) provisioning = provision().catch(error => { provisioning = undefined; throw error; });
  const ownerId = await provisioning;
  const db: any = supabaseAdmin;
  const email = `presenter-${ownerId}@demo.nemtsolutions.co`;
  const company = await db.from('companies').select('id,url_slug,is_demo,status').eq('demo_owner_id', ownerId).eq('is_demo', true).single();
  const presenter = await db.from('profiles').select('id,company_id').eq('email', email).single();
  if (company.error || presenter.error || company.data?.is_demo !== true || company.data.status !== 'active' || presenter.data?.company_id !== company.data.id) throw new Error('Public demo company could not be verified.');
  const auth = await db.auth.admin.getUserById(presenter.data.id);
  const meta = auth.data.user?.app_metadata;
  const roles = await db.from('user_roles').select('role,company_id').eq('user_id', presenter.data.id);
  if (auth.error || auth.data.user?.email !== email || meta?.is_demo !== true || meta?.public_demo !== true || meta?.demo_company_id !== company.data.id || meta?.demo_owner_id !== ownerId || roles.error || !roles.data?.length || roles.data.some((role: any) => role.company_id !== company.data.id || !['admin','driver','passenger','dispatch','billing','admin_biller'].includes(role.role))) throw new Error('Public demo permissions could not be verified.');
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data.properties?.hashed_token) throw new Error('Could not open the demo. Please try again.');
  return { slug: company.data.url_slug as string, token_hash: link.data.properties.hashed_token as string };
}
