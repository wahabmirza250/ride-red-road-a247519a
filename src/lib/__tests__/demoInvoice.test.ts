import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({demo:true,rows:[] as any[]}));
vi.mock('../demoCompany.server',()=>({isDemoCompany:async()=>state.demo}));
vi.mock('../ediRecords.server',()=>({loadEdiDetails:async()=>state.rows,toWorkRow:(r:any)=>r}));
import {runDemoBilling} from '../demoBilling.server';
import {DEMO_TRIP_RATE,DEMO_MILE_RATE} from '../demoBillingRates';
beforeEach(()=>{state.demo=true;state.rows=[{record_id:'12345678-abcd',total_charge:45.03,edi_status:null,local_blockers:[]}];});
function database(){const writes:any[]=[];return {writes,db:{from:()=>{let patch:any;const filters:any[]=[];const q:any={update:(p:any)=>{patch=p;return q;},eq:(k:string,v:string)=>{filters.push([k,v]);return q;},then:(resolve:any)=>{writes.push({patch,filters});Object.assign(state.rows[0],patch);return Promise.resolve({error:null}).then(resolve)}};return q;}}};}
it('uses the requested demo rates',()=>{expect(Math.round((DEMO_TRIP_RATE+12*DEMO_MILE_RATE)*100)/100).toBe(45.03);});
it('rejects a real company and foreign records before writing',async()=>{
 const {db,writes}=database();state.demo=false;
 await expect(runDemoBilling(db,'real',['12345678-abcd'],'submit')).rejects.toThrow('restricted');
 state.demo=true;state.rows=[];
 await expect(runDemoBilling(db,'demo',['foreign'],'submit')).rejects.toThrow('belong');expect(writes).toHaveLength(0);
});
it('stores a reusable demo claim confirmation without any external calls',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch');const {db,writes}=database();
 await runDemoBilling(db,'demo',['12345678-abcd'],'submit');
 expect(writes[0].patch).toMatchObject({status:'submitted',edi_status:'uploaded',state_confirmation_number:'DEMO-12345678',edi_environment:'test'});
 expect(writes[0].filters).toContainEqual(['company_id','demo']);
 await runDemoBilling(db,'demo',['12345678-abcd'],'submit');expect(writes).toHaveLength(1);
 expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
});
