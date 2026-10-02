/** Accept only a terminal receipt belonging to this exact original job. */
export function robotReceiptEvidence(job:any, expected:{jobId:string;companyId:string;tripId:string}) {
  if (job?.jobId !== expected.jobId || job?.ledgerKey !== `${expected.companyId}::${expected.tripId}` ||
      job?.status !== 'done' || job?.result?.status !== 'SUBMITTED') return null;
  const id = String(job.result.claim_id ?? '').trim();
  if (!/^\d{10,20}$/.test(id)) return null;
  const finished = Date.parse(job.finishedAt);
  if (!Number.isFinite(finished)) return null;
  return {id,finishedAt:new Date(finished).toISOString(),suspended:job.result.claim_status_suspended === true};
}
