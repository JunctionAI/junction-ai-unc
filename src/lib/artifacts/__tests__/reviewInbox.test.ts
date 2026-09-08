import {describe,it,expect,vi} from 'vitest';
import {readReviewInbox} from '../reviewInbox';
import type {DbClient} from '../../db/types';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const item={id,accountId:id,revision:2,kind:'brief',title:'Saved work',excerpt:'An actual saved excerpt',image:null,video:null,createdAt:'2026-09-09T00:00:00.123456+00:00'};
const page={accountId:id,contextGeneration:0,items:[item],nextCursor:null};
function setup(data:unknown=page){const rpc=vi.fn().mockResolvedValue({data,error:null});return {rpc,identity:{accountId:id,contextGeneration:0,userId:other,db:{rpc} as unknown as DbClient}};}
describe('review inbox adapter (simulated RPC)',()=>{
 it('uses captured identity and accepts microsecond timestamps',async()=>{const d=setup();expect(await readReviewInbox(d.identity,null)).toEqual(page);expect(d.rpc).toHaveBeenCalledWith('read_review_inbox',{acct:id,generation:0,actor:other,before_at:null,before_id:null});});
 it('rejects foreign parent, item or generation',async()=>{for(const data of [{...page,accountId:other},{...page,contextGeneration:1},{...page,items:[{...item,accountId:other}]}])await expect(readReviewInbox(setup(data).identity,null)).rejects.toThrow();});
 it('refuses duplicate rows and a cursor without a full page',async()=>{for(const data of [{...page,items:[item,item]},{...page,nextCursor:{createdAt:item.createdAt,id}}])await expect(readReviewInbox(setup(data).identity,null)).rejects.toThrow();});
 it('passes exact cursor precision to SQL',async()=>{const d=setup();const cursor={id:other,createdAt:item.createdAt};await readReviewInbox(d.identity,cursor);expect(d.rpc).toHaveBeenCalledWith('read_review_inbox',expect.objectContaining({before_at:cursor.createdAt,before_id:other}));});
 it('does not substitute empty success for storage failure',async()=>{const d=setup();d.rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(readReviewInbox(d.identity,null)).rejects.toThrow();});
});
