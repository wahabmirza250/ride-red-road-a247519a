import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueClip, queuedClips, removeClip } from '../recordingQueue';
describe('durable recording queue',()=>{
 beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
 afterEach(()=>vi.unstubAllGlobals());
 const clip=(id:string,account='a',age=0)=>({id,account,capturedAt:new Date(Date.now()-age).toISOString(),blob:new Blob(['video'],{type:'video/webm'}),mime:'video/webm' as const});
 it('persists clips, isolates accounts and removes uploaded files',async()=>{
   await enqueueClip(clip('a'));await enqueueClip(clip('b','b'));
   expect((await queuedClips('a')).map(c=>c.id)).toEqual(['a']);
   expect((await queuedClips('b')).map(c=>c.id)).toEqual(['b']);
   await removeClip('a');expect(await queuedClips('a')).toEqual([]);
 });
 it('deletes expired footage regardless of which account opens the queue',async()=>{
   await enqueueClip(clip('expired','b',7*86400_000+1000));await enqueueClip(clip('current'));
   expect(await queuedClips('b')).toEqual([]);expect((await queuedClips('a')).length).toBe(1);
 });
 it('refuses to silently discard footage when the pending queue is full',async()=>{
   const large={...clip('large'),blob:new Blob([new Uint8Array(200*1024*1024)])};
   await enqueueClip(large);await expect(enqueueClip(clip('overflow'))).rejects.toThrow('storage is full');
   expect((await queuedClips('a')).map(c=>c.id)).toEqual(['large']);
 });
});
