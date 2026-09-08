import {describe,it,expect,vi} from "vitest";
import type {RevisionInput} from "../reviewRevision";
import {textRevisionProducer} from "../reviewTextRevision";
const id="00000000-0000-4000-8000-000000000001";
const ref={accountId:id,artifactId:id,outputId:id,revision:0};
const input:RevisionInput={output:{ref,kind:'article',sectionIds:[],durationSeconds:null},comment:{id,output:ref,anchor:{kind:'whole'},text:'Shorter please',intent:'change_output'},content:{title:'Title',body:'The original article'}};
describe('bounded text revision producer (simulated LLM)',()=>{
 it('requests a complete structured revision once with a token cap',async()=>{const call=vi.fn().mockResolvedValue({stopReason:'end',text:'{"title":"Title","body":"Revised article"}'});expect(await textRevisionProducer(call)(input)).toEqual({title:'Title',body:'Revised article'});expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0][0].maxTokens).toBe(6000);});
 it('refuses rendered creative and unmapped section edits before spending',async()=>{const call=vi.fn();for(const candidate of [{...input,output:{...input.output,kind:'email' as const}},{...input,comment:{...input.comment,anchor:{kind:'section' as const,sectionId:'hero'}}}])await expect(textRevisionProducer(call)(candidate)).rejects.toThrow();expect(call).not.toHaveBeenCalled();});
 it('never presents truncation, refusal or placeholder output as a completed revision',async()=>{for(const result of [null,{stopReason:'max_tokens',text:'{}'},{stopReason:'end',text:'{"blocked":true}'},{stopReason:'end',text:'{"title":"T","body":""}'}])await expect(textRevisionProducer(vi.fn().mockResolvedValue(result))(input)).rejects.toThrow();});
});
