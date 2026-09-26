import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(()=>({demo:true,rows:[] as any[]}));
vi.mock('@/lib/demoCompany.server',()=>({isDemoCompany:vi.fn(async()=>fixture.demo),assertRealCompany:vi.fn(async()=>{if(fixture.demo)throw new Error('Demo blocked');})}));
vi.mock('@/lib/ediRecords.server',()=>({loadEdiDetails:vi.fn(async()=>fixture.rows),toWorkRow:(r:any)=>r}));
import { runDemoBilling } from '@/lib/demoBilling.server';
import { ediFetch } from '@/lib/ediBridge.server';
import { dispatchToFleet } from '@/lib/robotFleet.server';
describe('demo isolation',()=>{
 beforeEach(()=>{fixture.demo=true;fixture.rows=[];vi.restoreAllMocks();});
 it('rejects billing simulation in a real company',async()=>{fixture.demo=false;await expect(runDemoBilling({},'real',['a'],'validate')).rejects.toThrow('restricted');});
 it('rejects foreign bills before writing',async()=>{await expect(runDemoBilling({},'demo',['foreign'],'validate')).rejects.toThrow('belong');});
 it('rejects a mixed batch before writing any record',async()=>{fixture.rows=[{record_id:'a',edi_ready:true,local_blockers:[]},{record_id:'b',edi_ready:false,local_blockers:[]}];const db={from:vi.fn()};await expect(runDemoBilling(db,'demo',['a','b'],'batch')).rejects.toThrow('Check');expect(db.from).not.toHaveBeenCalled();});
 it('rejects a file that belongs to a different selection',async()=>{fixture.rows=[{record_id:'a',edi_file_id:123}];const db={from:vi.fn()};await expect(runDemoBilling(db,'demo',['a'],'upload',456)).rejects.toThrow('belong');expect(db.from).not.toHaveBeenCalled();});
 it('never calls EDI transport for a demo identity',async()=>{const fetch=vi.spyOn(globalThis,'fetch');const result=await ediFetch({auth:{getUser:async()=>({data:{user:{app_metadata:{is_demo:true}}}})}},{path:'/api/v1/health/'});expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();});
 it('fails closed when the EDI identity cannot be verified',async()=>{const fetch=vi.spyOn(globalThis,'fetch');const result=await ediFetch({auth:{getUser:async()=>({data:{user:null},error:new Error('expired')})}},{path:'/api/v1/health/'});expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();});
 it('blocks demo robot dispatch before loading a worker',async()=>{const db={from:vi.fn()};await expect(dispatchToFleet(db,{companyId:'demo',payload:{},jobId:'demo'})).rejects.toThrow('Demo blocked');expect(db.from).not.toHaveBeenCalled();});
});
