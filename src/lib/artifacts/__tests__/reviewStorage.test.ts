import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reviewStorage} from '../reviewStorage';
function setup(){const asStream=vi.fn().mockResolvedValue({data:null,error:{statusCode:'404'}}),upload=vi.fn().mockResolvedValue({error:null}),getBucket=vi.fn().mockResolvedValue({data:{public:false},error:null});const download=vi.fn(()=>({asStream}));return {asStream,upload,getBucket,adapter:reviewStorage({storage:{getBucket,from:()=>({download,upload})}} as unknown as Pick<SupabaseClient,'storage'>)};}
describe('Supabase review storage adapter (simulated SDK)',()=>{
 it('accepts only a confirmed private bucket',async()=>{const d=setup();expect(await d.adapter.isPrivate()).toBe(true);d.getBucket.mockResolvedValue({data:{public:true},error:null});expect(await d.adapter.isPrivate()).toBe(false);});
 it('recognizes only explicit not-found, not authorization or transport failure',async()=>{const d=setup();expect(await d.adapter.read('key',3)).toBeNull();for(const statusCode of ['401','403','500']){d.asStream.mockResolvedValue({data:null,error:{statusCode}});await expect(d.adapter.read('key',3)).rejects.toThrow();}});
 it('uploads create-only',async()=>{const d=setup();const bytes=new Uint8Array([1,2]);await d.adapter.create('key',bytes,'image/png');expect(d.upload).toHaveBeenCalledWith('key',bytes,{upsert:false,contentType:'image/png',cacheControl:'0'});});
});
