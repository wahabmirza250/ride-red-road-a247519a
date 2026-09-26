import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { getCompanySupportForOwner, setCompanySupportForOwner } from '@/lib/companySupport.functions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function CompanySupportField({ companyId }: { companyId: string }) {
  const get = useServerFn(getCompanySupportForOwner), save = useServerFn(setCompanySupportForOwner);
  const [phone, setPhone] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void get({data:{companyId}}).then(r => { if(active)setPhone(r.phone); }).catch(() => toast.error('Could not load support number.')); return () => {active=false;}; }, [companyId]);
  return <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await save({data:{companyId,phone}}); setPhone(r.phone); toast.success('Company support number saved'); }
    catch(e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally {setBusy(false);}
  }}><div className="min-w-0 flex-1"><Label htmlFor={`support-${companyId}`}>Passenger support phone</Label><Input id={`support-${companyId}`} type="tel" placeholder="Include country code" value={phone} onChange={e=>setPhone(e.target.value)}/></div><Button disabled={busy} variant="outline">{busy?'Saving…':'Save support number'}</Button></form>;
}
