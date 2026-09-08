import {describe,it,expect} from "vitest";
import {imageAnchor,reviewPresentationSchema,parseReviewHistory} from "../reviewPresentation";
const id="00000000-0000-4000-8000-000000000001";
const review={output:{id,account_id:id,artifact_id:id,context_generation:1,revision:0,kind:"image",section_ids:[],duration_seconds:null},version:{revision:0,content:{imagePath:`/api/review/media/${id}_image`}},comments:[],jobs:[]};
describe('review presentation',()=>{
 it('keeps the same image point on narrow and wide screens',()=>{expect(imageAnchor(100,150,{left:0,top:0,width:200,height:300})).toEqual(imageAnchor(500,750,{left:0,top:0,width:1000,height:1500}));});
 it('rejects unloaded dimensions',()=>{expect(()=>imageAnchor(0,0,{left:0,top:0,width:0,height:1})).toThrow();});
 it('accepts only a proxied asset path',()=>{expect(reviewPresentationSchema.safeParse(review).success).toBe(true);for(const path of ['https://tracker.example/image','javascript:alert(1)','//evil.example/x','/api/review/media/../secret'])expect(reviewPresentationSchema.safeParse({...review,version:{revision:0,content:{imagePath:path}}}).success).toBe(false);});
 it('refuses mismatched rendered version',()=>{expect(reviewPresentationSchema.safeParse({...review,version:{...review.version,revision:2}}).success).toBe(false);});
 it('validates history context and rejects foreign media paths',()=>{
  const current=reviewPresentationSchema.parse({...review,output:{...review.output,revision:1},version:{...review.version,revision:1}});
  const page={output:current.output,versions:[{output_id:id,account_id:id,revision:0,content:review.version.content,created_at:'2026-09-09'}],nextCursor:null};
  expect(parseReviewHistory(page,current,null).versions[0].revision).toBe(0);
  expect(()=>parseReviewHistory({...page,output:{...page.output,revision:2}},current,null)).toThrow();
  expect(()=>parseReviewHistory({...page,versions:[{...page.versions[0],content:{imagePath:'/api/review/media/other_image'}}]},current,null)).toThrow();
  expect(()=>parseReviewHistory(page,current,0)).toThrow();
 });
});
