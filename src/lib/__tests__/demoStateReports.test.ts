import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { generateStateFormPdf, formatStateTripDate, type FormArgs } from '../medicaidPdf';
import { upgradeDemoStateReports } from '../demoStateReports.server';

afterEach(() => vi.unstubAllGlobals());
const sample: FormArgs = {
  rider: {full_name:'Alex Morgan', medicaid_id:'DEMO0002'}, driverName:'Casey Reed', vehiclePlate:'DEMO-13',
  vehicleType:'ambulatory', identityVerified:true, tripKind:'one_way', signatureName:'SAMPLE SIGNATURE', signatureUrl:null,
  legs:[{leg_index:1,leg_date:'2026-09-29',pickup_time:'08:30',dropoff_time:'09:00',pickup_odometer:25020,dropoff_odometer:25032,
    pickup_address:'11 Example Lane, Colorado Springs, CO',dropoff_address:'Demo Medical Center, Colorado Springs, CO'}],
};
describe('state trip report demo', () => {
  it('preserves the service calendar date across time zones', () => {
    expect(formatStateTripDate('2026-09-29')).toBe('9/29/2026');
    expect(formatStateTripDate('2026-01-01')).toBe('1/1/2026');
  });
  it('fills the actual shipped state form and marks only demo output', async () => {
    const template = readFileSync('public/forms/nemt-trip-report.pdf');
    const fetchMock = vi.fn(async () => new Response(template));
    vi.stubGlobal('fetch', fetchMock);
    const bytes = await generateStateFormPdf(sample, {templateBaseUrl:'https://nemtsolutions.co',demoSample:true});
    expect(fetchMock).toHaveBeenCalledWith('https://nemtsolutions.co/forms/nemt-trip-report.pdf');
    const demo = await PDFDocument.load(bytes);
    expect(demo.getPageCount()).toBe(1);
    expect(demo.getForm().getFields()).toHaveLength(0);
    expect(demo.getTitle()).toContain('DEMO');
    expect(demo.getSubject()).toContain('Not for submission');
    if(process.env.DEMO_PDF_QA_OUTPUT) writeFileSync(process.env.DEMO_PDF_QA_OUTPUT, bytes);
    const real = await PDFDocument.load(await generateStateFormPdf(sample));
    expect(real.getTitle() ?? '').not.toContain('DEMO');
  });
  it('rejects real companies before any report read or storage write', async () => {
    const query:any={select:()=>query,eq:()=>query,single:async()=>({data:{is_demo:false},error:null})};
    const db:any={from:vi.fn(()=>query),storage:{from:vi.fn()}};
    await expect(upgradeDemoStateReports(db,'real')).rejects.toThrow('Verified demo');
    expect(db.from).toHaveBeenCalledTimes(1);expect(db.storage.from).not.toHaveBeenCalled();
  });
  it('does not regenerate already upgraded demo records', async () => {
    const db:any={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,single:()=>q,maybeSingle:()=>q,
      then:(resolve:any)=>Promise.resolve({data:table==='companies'?{is_demo:true,demo_owner_id:'owner'}:{value:'1'},error:null}).then(resolve)};return q;},storage:{from:vi.fn()}};
    expect(await upgradeDemoStateReports(db,'demo')).toBe(false);expect(db.storage.from).not.toHaveBeenCalled();
  });
});
