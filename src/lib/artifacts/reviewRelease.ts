import {z} from 'zod';
/** No wildcard/default rollout: a release flag without an explicit valid account list
 * exposes nothing. Membership still must be checked independently. */
export function reviewReleasedFor(accountId:string,env:Record<string,string|undefined>=process.env){
  if(env.JUNCTION_REVIEW_ENABLED!=='true'||!z.uuid().safeParse(accountId).success)return false;
  const accounts=(env.JUNCTION_REVIEW_ACCOUNT_IDS??'').split(',').map(id=>id.trim());
  if(!accounts.length||accounts.some(id=>!z.uuid().safeParse(id).success))return false;
  return accounts.includes(accountId);
}
