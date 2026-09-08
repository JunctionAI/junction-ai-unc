import {describe,it,expect,vi} from 'vitest';
import type {DbClient} from '../../lib/db/types';
import {runReviewQueueTick} from '../reviewQueue';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const env={JUNCTION_REVIEW_ENABLED:'true',JUNCTION_REVIEW_TEXT_QUEUE_ENABLED:'true',JUNCTION_REVIEW_ACCOUNT_IDS:a};
function setup(){
 const rpc=vi.fn().mockResolvedValue({data:[{id:b,account_id:a,context_generation:0}],error:null});
 const run=vi.fn().mockResolvedValue({status:'done',outputId:b,revision:1,duplicate:false});
 const budget=vi.fn().mockResolvedValue({ok:true});
 return {db:{rpc} as unknown as DbClient,rpc,run,budget,env};
}
describe('review queue tick (simulated dependencies)',()=>{
 it('disabled or malformed release does no database/model work',async()=>{for(const override of [{JUNCTION_REVIEW_TEXT_QUEUE_ENABLED:'false'},{JUNCTION_REVIEW_ACCOUNT_IDS:'*'},{JUNCTION_REVIEW_ENABLED:'false'}]){const d=setup();expect((await runReviewQueueTick(d.db,{...d,env:{...env,...override}})).status).toBe('disabled');expect(d.rpc).not.toHaveBeenCalled();expect(d.run).not.toHaveBeenCalled();}});
 it('idle queue does not call a model or budget provider',async()=>{const d=setup();d.rpc.mockResolvedValue({data:[],error:null});expect((await runReviewQueueTick(d.db,d)).status).toBe('idle');expect(d.budget).not.toHaveBeenCalled();expect(d.run).not.toHaveBeenCalled();});
 it('starts one scoped job through the existing claiming worker',async()=>{const d=setup();expect((await runReviewQueueTick(d.db,d)).status).toBe('processed');expect(d.run).toHaveBeenCalledExactlyOnceWith(d.db,{accountId:a,contextGeneration:0},b);});
 it('does not claim while spend is unavailable or exhausted',async()=>{const d=setup();d.budget.mockResolvedValue({ok:false});expect((await runReviewQueueTick(d.db,d)).status).toBe('idle');expect(d.run).not.toHaveBeenCalled();});
 it('rejects a cross-account candidate',async()=>{const d=setup();d.rpc.mockResolvedValue({data:[{id:b,account_id:b,context_generation:0}],error:null});await expect(runReviewQueueTick(d.db,d)).rejects.toThrow();expect(d.run).not.toHaveBeenCalled();});
 it('does not retry uncertain outcomes',async()=>{const d=setup();d.run.mockResolvedValue({status:'uncertain'});expect(await runReviewQueueTick(d.db,d)).toMatchObject({status:'processed',outcome:{status:'uncertain'}});expect(d.run).toHaveBeenCalledTimes(1);});
 it('rejects more candidates than the discovery contract permits',async()=>{const d=setup();d.rpc.mockResolvedValue({data:[{id:b,account_id:a,context_generation:0},{id:a,account_id:a,context_generation:0}],error:null});await expect(runReviewQueueTick(d.db,d)).rejects.toThrow();expect(d.run).not.toHaveBeenCalled();});
});
