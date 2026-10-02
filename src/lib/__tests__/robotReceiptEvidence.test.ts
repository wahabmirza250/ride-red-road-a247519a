import {describe,it,expect} from 'vitest';
import {robotReceiptEvidence} from '../robotReceiptEvidence';
const expected={jobId:'job',companyId:'company',tripId:'trip'};
const job={jobId:'job',ledgerKey:'company::trip',status:'done',finishedAt:'2026-10-02T01:30:00Z',result:{status:'SUBMITTED',claim_id:'2326274001767',claim_status_suspended:true}};
describe('receipt-only status updates',()=>{
 it('keeps the real receipt and suspended outcome',()=>expect(robotReceiptEvidence(job,expected)).toEqual({id:'2326274001767',finishedAt:'2026-10-02T01:30:00.000Z',suspended:true}));
 it.each([{...job,status:'running'},{...job,jobId:'other'},{...job,ledgerKey:'another::trip'},{...job,ledgerKey:'company::trip::correction::one'},{...job,finishedAt:null},{...job,result:{status:'SUBMITTED_UNVERIFIED',claim_id:'2326274001767'}},{...job,result:{status:'SUBMITTED',claim_id:null}}])('rejects uncertain or mismatched evidence',value=>expect(robotReceiptEvidence(value,expected)).toBeNull());
});
