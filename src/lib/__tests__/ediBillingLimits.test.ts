import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(async () => ({ok:true})), own: vi.fn(async () => {}) }));
vi.mock('../ediBridge.server', () => ({ediFetch:mocks.send}));
vi.mock('../ediOwnership.server', () => ({assertFileOwned:mocks.own}));
import { fileUpload } from '../ediApi.server';
beforeEach(() => vi.clearAllMocks());
function db(miles: number) {
  const q: any = {select:()=>q, eq:()=>q, limit:async()=>({data:[{medicaid_trips:{miles,odometer_start:100,odometer_end:100+miles,medicaid_trip_legs:[]}}],error:null})};
  return {from:()=>q};
}
it('blocks an old EDI file containing an over-limit bill before upload', async () => {
  await expect(fileUpload(db(50.01),'company',123)).rejects.toThrow('Billing blocked');
  expect(mocks.send).not.toHaveBeenCalled();
});
it('allows an old EDI file exactly at the limit after checking ownership', async () => {
  await fileUpload(db(50),'company',123);
  expect(mocks.own).toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledOnce();
});
