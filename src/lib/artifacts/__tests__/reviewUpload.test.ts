import {describe,it,expect,vi} from 'vitest';
import {uploadReviewMedia} from '../reviewUpload';
import type {ReviewOutput} from '../reviewContract';
const id='00000000-0000-4000-8000-000000000001';
const output:ReviewOutput={ref:{accountId:id,artifactId:id,outputId:id,revision:0},kind:'image',sectionIds:[],durationSeconds:null};
const bytes=new Uint8Array([1,2,3]);
function setup(){let saved:Uint8Array|null=null;return {isPrivate:vi.fn().mockResolvedValue(true),read:vi.fn(async()=>saved),create:vi.fn(async(_path:string,value:Uint8Array)=>{saved=value;})};}
describe('immutable media upload (simulated storage)',()=>{
 it('creates once, verifies bytes and then reuses on retry',async()=>{const s=setup();expect((await uploadReviewMedia(output,1,'image','png',bytes,s)).duplicate).toBe(false);expect((await uploadReviewMedia(output,1,'image','png',bytes,s)).duplicate).toBe(true);expect(s.create).toHaveBeenCalledTimes(1);});
 it('refuses a public bucket before reading or writing',async()=>{const s=setup();s.isPrivate.mockResolvedValue(false);await expect(uploadReviewMedia(output,1,'image','png',bytes,s)).rejects.toThrow();expect(s.read).not.toHaveBeenCalled();expect(s.create).not.toHaveBeenCalled();});
 it('never overwrites different bytes at the immutable key',async()=>{const s=setup();s.read.mockResolvedValue(new Uint8Array([4,5,6]));await expect(uploadReviewMedia(output,1,'image','png',bytes,s)).rejects.toThrow('Immutable media conflict');expect(s.create).not.toHaveBeenCalled();});
 it('reconciles an ambiguous write with matching readback, without retrying',async()=>{const s=setup();s.read.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);s.create.mockRejectedValue(new Error('timeout'));expect((await uploadReviewMedia(output,1,'image','png',bytes,s)).duplicate).toBe(false);expect(s.create).toHaveBeenCalledTimes(1);});
 it('does not claim delivery if readback is missing or changed',async()=>{for(const value of [null,new Uint8Array([3,2,1])]){const s=setup();s.read.mockResolvedValue(value);await expect(uploadReviewMedia(output,1,'image','png',bytes,s)).rejects.toThrow();}});
});
