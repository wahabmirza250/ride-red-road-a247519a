import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({rows:[] as any[],remove:vi.fn(),deleted:vi.fn(),expiry:vi.fn()}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{storage:{from:()=>({remove:m.remove})},from:()=>{
 const q:any={select:()=>q,lte:(_key:string,value:string)=>{m.expiry(value);return q;},limit:async()=>({data:m.rows}),delete:()=>({in:async(_key:string,ids:string[])=>{m.deleted(ids);m.rows=[];return {error:null};}})};return q;
}}}));
import { removeExpiredRecordings } from '../recordingRetention.server';
describe('recording deletion',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.rows=[{id:'expired',object_path:'company/driver/clip.webm'}];m.remove.mockResolvedValue({error:null});});
 it('deletes private objects before removing their index',async()=>{
   await removeExpiredRecordings();expect(m.remove).toHaveBeenCalledWith(['company/driver/clip.webm']);expect(m.deleted).toHaveBeenCalledWith(['expired']);expect(m.expiry).toHaveBeenCalled();
 });
 it('keeps the index for retry when storage deletion fails',async()=>{
   m.remove.mockResolvedValueOnce({error:new Error('offline')});await expect(removeExpiredRecordings()).rejects.toThrow('offline');expect(m.deleted).not.toHaveBeenCalled();
   await removeExpiredRecordings();expect(m.deleted).toHaveBeenCalledWith(['expired']);
 });
});
