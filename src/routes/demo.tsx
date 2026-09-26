import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabaseBrowser';
import { setCompanySlug } from '@/lib/companyContext';
import { launchActualDemo } from '@/lib/actualDemo.functions';
import { BrandWordmark } from '@/components/Brand';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/demo')({head:()=>({meta:[{title:'Open the actual app demo — NEMT Solutions'},{name:'robots',content:'noindex'}]}),component:ActualDemoEntry});
function ActualDemoEntry(){
 const {user,loading,isAdmin,isOwner}=useAuth();const launch=useServerFn(launchActualDemo);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 async function start(){setBusy(true);setError(null);try{const result=await launch();if(result.token_hash){const {error}=await supabase.auth.verifyOtp({type:'magiclink',token_hash:result.token_hash});if(error)throw error;}setCompanySlug(result.slug);window.location.href=`/${result.slug}/dashboard`;}catch(e){setError(e instanceof Error?e.message:'Could not open demo');setBusy(false);}}
 return <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground"><section className="w-full max-w-xl rounded-3xl border border-border bg-surface p-6 shadow-soft sm:p-10"><BrandWordmark className="h-9"/><p className="mt-7 text-xs font-semibold uppercase tracking-widest text-primary">Full product demo</p><h1 className="mt-2 text-3xl font-semibold">Your actual app. Ready to present.</h1><p className="mt-4 text-muted-foreground">Open a separate demo company with saved sample drivers, passengers, trips, and bills. You will use the real dashboard and apps.</p><ul className="my-5 space-y-2 text-sm"><li>Admin dashboard and dispatch</li><li>Driver and passenger apps</li><li>Separate EDI and Robot billing</li></ul><p className="mb-5 text-xs text-muted-foreground">Fictional records stay separate from Walla. Demo submissions, camera access, and external notifications are disabled.</p>{error&&<p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}{loading?<p>Loading account…</p>:user&&(isAdmin||isOwner)?<Button onClick={start} disabled={busy}>{busy?'Preparing your demo company…':'Open actual app demo'}</Button>:<><a href="/access" className="inline-block rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Sign in with your company admin account</a><p className="mt-3 text-xs text-muted-foreground">After signing in, return to this page to open your demo.</p></>}</section></main>;
}
