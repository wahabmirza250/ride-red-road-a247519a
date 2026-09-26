import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:true, foreign:false, providerName:'Walla Investment LLC', writes:vi.fn(), mapping:vi.fn(), fetch:vi.fn()}));
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>{const f:any={middleware:()=>f,inputValidator:()=>f,handler:(h:any)=>h};return f;}}));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:{}}));
vi.mock('../ediCompany.server',()=>({resolveEdiScope:async()=>({companyId:'a',isPlatformOwner:false})}));
vi.mock('../ediSync.server',()=>({loadCatalogState:async()=>({paths:{provider:'/api/v1/provider-billing-profiles/'},error:null})}));
vi.mock('../ediBridge.server',()=>({ediFetch:state.fetch}));
vi.mock('../ediSetup.server',()=>({loadEdiCompanySettings:async()=>({company_id:'a',sender_id:'keep-sender',environment:'test',production_enabled:false})}));
vi.mock('../ediLedger.server',()=>({loadCompanyMapping:async()=>({edi_provider_profile_id:null}),saveCompanyMapping:state.mapping}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,neq:()=>q,single:async()=>({data:{name:'Walla Investment LLC',status:'active'},error:null}),
    upsert:(value:any)=>{state.writes(value);return Promise.resolve({error:null});},
    then:(resolve:any)=>Promise.resolve({data:table==='companies'?[{id:'a',name:'Walla Investment LLC'}]:state.foreign?[{company_id:'b'}]:[],error:null}).then(resolve)};
  return q;
}}}));
import {findExistingEdiProvider} from '../ediExistingProfile.functions';
const run=()=> (findExistingEdiProvider as any)({data:{},context:{userId:'user',supabase:{rpc:async()=>({data:state.admin,error:null})}}});
describe('provider import authorization',()=>{
  beforeEach(()=>{state.admin=true;state.foreign=false;state.writes.mockClear();state.mapping.mockReset().mockResolvedValue({});state.fetch.mockReset().mockResolvedValue({ok:true,data:[{id:7,legal_name:'Walla Investment LLC',is_active:true}]});});
  it('rejects non-admin billing staff before querying providers',async()=>{
    state.admin=false;await expect(run()).rejects.toThrow('company admin');expect(state.fetch).not.toHaveBeenCalled();
  });
  it('cannot import another company’s provider',async()=>{
    state.foreign=true;await expect(run()).rejects.toThrow('another company');expect(state.writes).not.toHaveBeenCalled();expect(state.mapping).not.toHaveBeenCalled();
  });
  it('does not write when the backend has no company match',async()=>{
    state.fetch.mockResolvedValue({ok:true,data:[{id:1,legal_name:'London'}]});await expect(run()).rejects.toThrow('No existing');expect(state.writes).not.toHaveBeenCalled();
  });
  it('links the verified provider and preserves submission configuration',async()=>{
    await expect(run()).resolves.toEqual({provider_id:7});
    expect(state.mapping).toHaveBeenCalledWith(expect.anything(),'a',{edi_provider_profile_id:'7',provider_fingerprint:null});
    expect(state.writes).toHaveBeenCalledWith(expect.objectContaining({company_id:'a',billing_name:'Walla Investment LLC',sender_id:'keep-sender',environment:'test',production_enabled:false}));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1].method).toBe('GET');
  });
  it('finds a matching provider on a later backend page',async()=>{
    state.fetch.mockReset().mockResolvedValueOnce({ok:true,data:[{id:1,legal_name:'London'}],hasNextPage:true})
      .mockResolvedValueOnce({ok:true,data:[{id:7,legal_name:'Walla Investment LLC'}],hasNextPage:false});
    await expect(run()).resolves.toEqual({provider_id:7});
    expect(state.fetch.mock.calls[1][1].path).toBe('/api/v1/provider-billing-profiles/?page=2');
  });
});
