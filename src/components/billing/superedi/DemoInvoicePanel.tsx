import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { submitDemoInvoice } from '@/lib/demoInvoice.functions';
import { DEMO_TRIP_RATE, DEMO_MILE_RATE, DEMO_BILLING_ACCOUNT } from '@/lib/demoBillingRates';
import type { EdiWorkRow } from '@/lib/ediTypes';
import { moneyText } from './ediUi';

export function DemoInvoicePanel({companyId,rows,onRowsUpdated}:{companyId:string|null;rows:EdiWorkRow[];onRowsUpdated:(rows:EdiWorkRow[])=>void}) {
  const submit = useServerFn(submitDemoInvoice);
  const run = useMutation({mutationFn:()=>submit({data:{company_id:companyId,record_ids:rows.map(r=>r.record_id)}}),
    onSuccess:res=>{onRowsUpdated(res.rows);toast.success('Demo bill submitted successfully');},
    onError:(error:Error)=>toast.error(error.message)});
  const miles=rows.reduce((sum,r)=>sum+r.miles,0);
  const total=rows.reduce((sum,r)=>sum+r.total_charge,0);
  return <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
    <div><h2 className="font-semibold">{DEMO_BILLING_ACCOUNT}</h2><p className="text-sm text-muted-foreground">Connected for presentation · Simulation only</p></div>
    <p className="text-sm">Trip unit: <strong>{moneyText(DEMO_TRIP_RATE)}</strong> · Per mile: <strong>{moneyText(DEMO_MILE_RATE)}</strong></p>
    <p className="text-sm">Example: 1 trip unit + 12 miles = <strong>$45.03</strong></p>
    {rows.length ? <div className="space-y-2"><p>{rows.length} selected trips · {miles.toFixed(1)} miles · <strong>{moneyText(total)}</strong></p>
      <Button disabled={run.isPending} onClick={()=>run.mutate()}>{run.isPending?'Submitting demo bill…':'Submit demo bill'}</Button></div>
      : <p className="text-sm">Select trips below, then click Submit demo bill.</p>}
    {run.data && <div role="status" className="rounded-xl bg-background p-3 text-sm"><strong>Bill submitted successfully — demo</strong>
      {run.data.rows.map(r=><p key={r.record_id}>{r.member_name} · {moneyText(r.total_charge)} · {r.edi_claim_id ? `Demo claim #${r.edi_claim_id}` : 'Previously submitted demo bill'}</p>)}
      <p>No real claim was sent and no money was charged.</p></div>}
  </section>;
}
