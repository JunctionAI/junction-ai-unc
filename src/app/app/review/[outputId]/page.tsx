import ReviewWorkspace from "@/components/review/ReviewWorkspace";
import {accountChoicesForRequest} from "@/lib/db/accountChoices";
import {selectAccountMembership} from "@/lib/db/accountSelection";
import {accountContextGeneration} from "@/lib/db/contextGeneration";
import {asDb} from "@/lib/db/client";
import {getServiceSupabase} from "@/lib/db/server";
import {z} from "zod";
import {reviewReleasedFor} from "@/lib/artifacts/reviewRelease";
export const dynamic="force-dynamic";
export default async function ReviewPage({params,searchParams}:{params:Promise<{outputId:string}>;searchParams:Promise<{account?:string|string[]}>}){
 if(process.env.JUNCTION_REVIEW_ENABLED!=="true")return <main style={{padding:32}}>The review workspace is still being connected. <a href="/app">Back to Junction</a></main>;
 const [{outputId},{account},access]=await Promise.all([params,searchParams,accountChoicesForRequest()]);
 const selected=selectAccountMembership(access.choices,account);
 if(access.error||!selected.ok||!z.uuid().safeParse(outputId).success)return <main style={{padding:32}}>This review is unavailable in your selected workspace. <a href="/app">Choose your workspace</a></main>;
 const accountId=selected.membership.accountId;
 if(!reviewReleasedFor(accountId))return <main style={{padding:32}}>Review testing is not enabled for this workspace. <a href="/app">Back to Junction</a></main>;
 const generation=await accountContextGeneration(asDb(getServiceSupabase()),accountId);
 return <ReviewWorkspace key={`${accountId}:${generation}:${outputId}`} accountId={accountId} generation={generation} outputId={outputId}/>;
}
