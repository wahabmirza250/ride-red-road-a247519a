import { createHash } from 'node:crypto';
import { isDemoCompany } from './demoCompany.server';
import { loadEdiDetails, toWorkRow } from './ediRecords.server';
import { summarizeValidation } from './ediBulk';

/** Local presentation transitions only. This module never calls a payer or robot. */
export async function runDemoBilling(db: any, companyId: string, ids: string[], action: 'validate' | 'batch' | 'upload' | 'refresh', fileId?: number) {
  if (!await isDemoCompany(companyId)) throw new Error('Demo billing is restricted to demo companies.');
  if (!ids.length) throw new Error('Select demo bills first.');
  const details = await loadEdiDetails(db, companyId, { recordIds: ids });
  if (details.length !== new Set(ids).size) throw new Error('Demo bills do not belong to this company.');
  const rows = details.map(toWorkRow);
  const demoNumber = (key: string) => 1_000_000_000 + parseInt(createHash('sha256').update(companyId + key).digest('hex').slice(0,7), 16);
  const batchId = demoNumber([...ids].sort().join(','));
  // Validate the complete selection before writing any row.
  if (action === 'batch' && rows.some(row => !row.edi_ready || row.local_blockers.length || (row.edi_batch_id && row.edi_batch_id !== batchId))) throw new Error('Check all selected trips and keep existing batches together.');
  if (action === 'upload' && (!fileId || rows.some(row => row.edi_file_id !== fileId))) throw new Error('The selected bills do not belong to this demo batch.');
  for (const row of rows) {
    const patch: Record<string, unknown> = { edi_environment: 'test', edi_last_sync_at: new Date().toISOString(), edi_last_error: null };
    if (action === 'validate') {
      if (row.edi_batch_id) continue;
      Object.assign(patch, { edi_claim_id: demoNumber(row.record_id), edi_status: row.local_blockers.length ? 'not_ready' : 'ready', edi_validation: { ready: !row.local_blockers.length, demo: true, issues: row.local_blockers } });
    } else if (action === 'batch') {
      if (row.edi_batch_id === batchId && row.edi_file_id) continue;
      if (!row.edi_ready || row.local_blockers.length) throw new Error('Check all selected trips before making a demo batch.');
      if (row.edi_batch_id && row.edi_batch_id !== batchId) throw new Error('A selected bill already belongs to another batch.');
      Object.assign(patch, { edi_batch_id: batchId, edi_file_id: batchId, edi_status: 'generated' });
    } else if (action === 'upload') {
      if (!fileId || row.edi_file_id !== fileId) throw new Error('The selected bills do not belong to this demo batch.');
      Object.assign(patch, { edi_status: 'uploaded' });
    } else {
      if (!['uploaded','paid'].includes(row.edi_status ?? '')) continue;
      Object.assign(patch, { edi_status: 'paid', edi_status_detail: { status: 'paid', demo: true, message: 'Simulated payment for presentation. No payer was contacted.' } });
    }
    const { error } = await db.from('billing_records').update(patch).eq('company_id',companyId).eq('id',row.record_id);
    if (error) throw new Error(error.message);
  }
  const after = (await loadEdiDetails(db,companyId,{recordIds:ids})).map(toWorkRow);
  const results = after.map(row=>({record_id:row.record_id,ok:true,ready:row.edi_ready}));
  return { ok:true, message:'Demo step completed. No real claim was submitted.', results, summary:summarizeValidation(results), rows:after, batch_id:batchId, file_id:batchId, batch_number:`DEMO-${batchId}`, included:ids, excluded:[], failures:[], updated:after.length, failed:[] };
}
