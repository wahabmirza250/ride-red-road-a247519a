import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  let validate = (data: any) => data;
  const fn: any = { middleware: () => fn, inputValidator: (v: any) => { validate=v; return fn; }, handler: (h: any) => (args: any) => h({...args,data:validate(args.data)}) };
  return fn;
} }));
vi.mock('@tanstack/react-start/server', () => ({getRequestHeader:vi.fn(),getRequestIP:vi.fn()}));
vi.mock('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
vi.mock('../company.server', () => ({ assertCompanyActive: async () => ({id:'a',url_slug:'alpha'}) }));
vi.mock('../staffGuard.server', () => ({ requireStaff: async () => ({isAdmin:true}) }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: {from:(table:string) => {
  let rows = state.tables[table] ?? [], patch: any, deleting = false;
  const run = (single=false) => {
    if (single && rows.length !== 1) return {data:null,error:{message:'Record unavailable'}};
    if (patch) rows.forEach(r=>Object.assign(r,patch));
    if (deleting) state.tables[table]=state.tables[table].filter(r=>!rows.includes(r));
    return {data:single?rows[0]:rows,error:null};
  };
  const q:any = {select:()=>q,eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return q;},order:()=>q,limit:()=>q,update:(p:any)=>{patch=p;return q;},delete:()=>{deleting=true;return q;},single:async()=>run(true),then:(resolve:any)=>Promise.resolve(run()).then(resolve)};
  return q;
}}}));
import { listActiveEvents, upsertEvent, deleteEvent } from '../events.functions';
import { listPublicNews, listPublicGames } from '../passengerPublic.functions';
const invoke=async(fn:any,data?:any)=>fn({data,context:{userId:'admin'}});
describe('privileged company content functions',()=>{
  beforeEach(()=> {state.tables=Object.fromEntries(['events','games','news_items'].map(table=>[table,[{id:'a-item',company_id:'a',is_active:true,title:'A'},{id:'b-item',company_id:'b',is_active:true,title:'B'}]]));});
  it.each([['events',listActiveEvents],['games',listPublicGames],['news_items',listPublicNews]])('only reads own %s using the privileged client',async (_table,fn)=>{
    expect((await invoke(fn)).map((r:any)=>r.id)).toEqual(['a-item']);
  });
  it('cannot edit or move another company’s event',async()=>{
    await expect(invoke(upsertEvent,{id:'b-item',title:'Changed',starts_at:'2030-01-01'})).rejects.toThrow('unavailable');
    expect(state.tables.events[1]).toMatchObject({company_id:'b',title:'B'});
  });
  it('cannot delete another company’s event',async()=>{
    await expect(invoke(deleteEvent,{id:'b-item'})).rejects.toThrow('unavailable');
    expect(state.tables.events).toHaveLength(2);
  });
  it('can edit and delete its own event',async()=>{
    await invoke(upsertEvent,{id:'a-item',title:'Changed',starts_at:'2030-01-01'});
    expect(state.tables.events[0].title).toBe('Changed');
    await invoke(deleteEvent,{id:'a-item'});
    expect(state.tables.events.map(r=>r.id)).toEqual(['b-item']);
  });
  it.each([{starts_at:'invalid'},{starts_at:'2030-01-02',ends_at:'2030-01-01'}])('rejects invalid event times before saving',async times=>{
    await expect(invoke(upsertEvent,{id:'a-item',title:'Changed',...times})).rejects.toThrow();
    expect(state.tables.events[0].title).toBe('A');
  });
});
