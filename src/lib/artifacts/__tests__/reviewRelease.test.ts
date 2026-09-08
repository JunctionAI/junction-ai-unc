import {describe,it,expect} from 'vitest';
import {reviewReleasedFor} from '../reviewRelease';
const id='55a377a5-c12e-4de6-a085-0d9a50ccd488';
describe('review account release',()=>{
 it('requires both flag and exact account allowlist',()=>{expect(reviewReleasedFor(id,{JUNCTION_REVIEW_ENABLED:'true',JUNCTION_REVIEW_ACCOUNT_IDS:id})).toBe(true);for(const env of [{},{JUNCTION_REVIEW_ENABLED:'true'},{JUNCTION_REVIEW_ACCOUNT_IDS:id}])expect(reviewReleasedFor(id,env)).toBe(false);});
 it('refuses wildcards, malformed lists and another account',()=>{for(const list of ['*',id+',',id+',invalid','00000000-0000-4000-8000-000000000001'])expect(reviewReleasedFor(id,{JUNCTION_REVIEW_ENABLED:'true',JUNCTION_REVIEW_ACCOUNT_IDS:list})).toBe(false);});
});
