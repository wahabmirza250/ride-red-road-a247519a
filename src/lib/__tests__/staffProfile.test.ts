import { it, expect, vi } from 'vitest';
import { ensureStaffProfile } from '../staffProfile.server';
it('creates the missing profile instead of silently updating zero rows', async () => {
  const upsert = vi.fn(() => ({select:()=>({single:async()=>({data:{id:'user',company_id:'unicare'},error:null})})}));
  await ensureStaffProfile({from:()=>({upsert})},'user',{company_id:'unicare',email:'staff@example.com'});
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({id:'user',company_id:'unicare'}),{onConflict:'id'});
});
it.each([{data:null,error:{message:'write failed'}},{data:null,error:null},{data:{id:'user',company_id:'wrong'},error:null}])('does not report success without the correct company profile', async result => {
  const db={from:()=>({upsert:()=>({select:()=>({single:async()=>result})})})};
  await expect(ensureStaffProfile(db,'user',{company_id:'unicare',email:'staff@example.com'})).rejects.toThrow('company profile');
});
