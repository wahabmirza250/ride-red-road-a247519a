import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
export function ActualDemoSwitcher() {
  const { user, signOut } = useAuth();
  const [open,setOpen] = useState(false);
  const slug = user?.app_metadata?.demo_company_slug;
  if (user?.app_metadata?.is_demo !== true || typeof slug !== 'string' || !/^demo-[a-f0-9]{16}$/.test(slug)) return null;
  return <aside className="fixed bottom-20 right-3 z-[80] max-w-[calc(100vw-24px)] rounded-2xl border border-primary/40 bg-surface p-3 shadow-xl">
    <Button size="sm" variant="outline" onClick={()=>setOpen(!open)} aria-expanded={open}>Demo company · Switch app</Button>
    {open && <div className="mt-3 w-64 max-w-full space-y-2"><p className="text-xs text-muted-foreground">Real app screens · Fictional records. External submissions and camera access are disabled.</p>
      <nav aria-label="Demo apps" className="grid grid-cols-2 gap-2">{[['Admin','dashboard'],['Dispatch','live-ops'],['Driver','driver'],['Passenger','passenger'],['EDI billing','billing/edi'],['Robot billing','billing/portal']].map(([name,path])=><a key={path} href={`/${slug}/${path}`} className="rounded-lg bg-surface-muted p-2 text-sm font-medium">{name}</a>)}</nav>
      <button className="text-xs underline" onClick={async()=>{await signOut();window.location.href='/access';}}>Exit demo and sign in to your company</button>
    </div>}
  </aside>;
}
