import {z} from 'zod';
import type {ReviewIdentity} from './reviewApi';
export const reviewInboxCursor=z.object({createdAt:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
export const reviewInboxSchema=z.object({accountId:z.uuid(),contextGeneration:z.number().int().nonnegative(),
 items:z.array(z.object({id:z.uuid(),accountId:z.uuid(),revision:z.number().int().nonnegative(),kind:z.enum(['email','sms','image','video','article','outreach','decision','brief']),title:z.string().max(300),excerpt:z.string().max(240),image:z.boolean().nullable(),video:z.boolean().nullable(),createdAt:z.iso.datetime({offset:true})})).max(10),nextCursor:reviewInboxCursor.nullable()});
export type ReviewInbox=z.infer<typeof reviewInboxSchema>;
export async function readReviewInbox(identity:ReviewIdentity,cursor:z.infer<typeof reviewInboxCursor>|null){
 if(cursor)reviewInboxCursor.parse(cursor);
 const r=await identity.db.rpc('read_review_inbox',{acct:identity.accountId,generation:identity.contextGeneration,actor:identity.userId,before_at:cursor?.createdAt??null,before_id:cursor?.id??null});
 if(r.error)throw new Error('Review inbox unavailable');
 const data=reviewInboxSchema.parse(r.data);
 if(data.accountId!==identity.accountId||data.contextGeneration!==identity.contextGeneration||data.items.some(i=>i.accountId!==identity.accountId)||new Set(data.items.map(i=>i.id)).size!==data.items.length)throw new Error('Review inbox context mismatch');
 const last=data.items.at(-1);
 if(data.nextCursor&&(data.items.length!==10||data.nextCursor.id!==last?.id||data.nextCursor.createdAt!==last.createdAt))throw new Error('Review inbox cursor mismatch');
 return data;
}
