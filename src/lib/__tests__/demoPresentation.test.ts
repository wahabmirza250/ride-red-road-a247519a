import { describe,it,expect,vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { demoId,seedDemoPresentation } from '../demoPresentation.server';
import { createDemoBillPdf } from '../demoDocuments';

function database(company:any, seeded=false) {
  const writes:any[]=[];
  const db:any={from:(table:string)=>{
    const q:any={select:()=>q,eq:()=>q,single:()=>q,maybeSingle:()=>q,
      upsert:(p:any)=>{writes.push(p);return q;},
      then:(resolve:any)=>Promise.resolve({error:null,data:table==='companies'?company:table==='app_settings'&&seeded?{value:'done'}:null}).then(resolve)};
    return q;
  },storage:{from:vi.fn()}};
  return {db,writes};
}
describe('presentation seeding safety',()=>{
  it('does not write to a real transport company',async()=>{
    const {db,writes}=database({is_demo:false,demo_owner_id:'owner'});
    await expect(seedDemoPresentation(db,'company','owner',[])).rejects.toThrow('ownership');
    expect(writes).toEqual([]);expect(db.storage.from).not.toHaveBeenCalled();
  });
  it('rejects a demo owned by someone else',async()=>{
    const {db,writes}=database({is_demo:true,demo_owner_id:'other'});
    await expect(seedDemoPresentation(db,'company','owner',[])).rejects.toThrow('ownership');expect(writes).toEqual([]);
  });
  it('preserves presentation actions after the version has been seeded',async()=>{
    const {db,writes}=database({is_demo:true,demo_owner_id:'owner'},true);
    expect(await seedDemoPresentation(db,'company','owner',[])).toBe(false);
    expect(writes).toEqual([]);expect(db.storage.from).not.toHaveBeenCalled();
  });
  it('keeps deterministic sample IDs isolated by tenant',()=>{
    expect(demoId('a','medical-1')).toBe(demoId('a','medical-1'));
    expect(demoId('a','medical-1')).not.toBe(demoId('b','medical-1'));
  });
  it('creates an actual downloadable PDF with explicit fictional-document metadata',async()=>{
    const bytes=await createDemoBillPdf({reference:'DEMO-001',passenger:'Alex Morgan',memberId:'DEMO123',driver:'Jordan Lee',
      date:'2026-09-30',plate:'DEMO-12',pickup:'10 Example Lane, Colorado Springs, CO',dropoff:'Demo Medical Center, Colorado Springs, CO',tripRate:12.15,mileRate:2.74});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);expect(pdf.getTitle()).toContain('DEMO');
    expect(pdf.getSubject()).toContain('Sample signatures only');
  });
});
