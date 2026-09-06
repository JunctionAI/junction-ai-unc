/* The built-in skill cards for every catalog routine, by routine id.

   A ProduceNode is a replaceable seam: an account-registered n8n workflow may
   produce the same artifact contract, with this built-in skill as the honest
   fallback. Mutation skills prepare an inspectable proposal; the runtime gate
   and action executor remain the only path to an outward change. */
import { abandonedCart } from "./abandonedCart";
import { adFatigue } from "./adFatigue";
import { aiVisibility } from "./aiVisibility";
import { budgetPacing } from "./budgetPacing";
import { campaignCalendar } from "./campaignCalendar";
import { competitorWatch } from "./competitorWatch";
import { contentGap } from "./contentGap";
import { contentPerformance } from "./contentPerformance";
import { creativeTesting } from "./creativeTesting";
import { creatorWhitelist } from "./creatorWhitelist";
import { customerQuestions } from "./customerQuestions";
import { dailyPaid } from "./dailyPaid";
import { followUp } from "./followUp";
import { founderContent } from "./founderContent";
import { gadsBofuPlan } from "./gadsBofuPlan";
import { hookRotation } from "./hookRotation";
import { keywordScan } from "./keywordScan";
import { leadResearch } from "./leadResearch";
import { meetingBrief } from "./meetingBrief";
import { newsletterDraft } from "./newsletterDraft";
import { onPageSeo } from "./onPageSeo";
import { organicToPaid } from "./organicToPaid";
import { outboundDrafts } from "./outboundDrafts";
import { pipelineHygiene } from "./pipelineHygiene";
import { postPurchase } from "./postPurchase";
import { reviewTiming } from "./reviewTiming";
import { segmentation } from "./segmentation";
import { serpWatch } from "./serpWatch";
import { socialRepurposing } from "./socialRepurposing";
import { testPlanner } from "./testPlanner";
import { trendWatch } from "./trendWatch";
import { ugcCreators } from "./ugcCreators";
import { viralHooks } from "./viralHooks";
import { welcomeFlow } from "./welcomeFlow";
import { winback } from "./winback";
import { winningElements } from "./winningElements";
import { winLoss } from "./winLoss";
import type { Skill } from "./types";

export const SKILLS: Skill[] = [
  founderContent,
  viralHooks,
  customerQuestions,
  ugcCreators,
  socialRepurposing,
  winningElements,
  trendWatch,
  contentPerformance,
  dailyPaid,
  creativeTesting,
  hookRotation,
  adFatigue,
  creatorWhitelist,
  testPlanner,
  budgetPacing,
  organicToPaid,
  gadsBofuPlan,
  keywordScan,
  contentGap,
  aiVisibility,
  onPageSeo,
  serpWatch,
  competitorWatch,
  leadResearch,
  outboundDrafts,
  meetingBrief,
  followUp,
  winLoss,
  pipelineHygiene,
  welcomeFlow,
  abandonedCart,
  segmentation,
  winback,
  postPurchase,
  reviewTiming,
  campaignCalendar,
  newsletterDraft,
];

export const SKILL_BY_ID: Record<string, Skill> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function skillFor(id: string): Skill | null {
  return SKILL_BY_ID[id] ?? null;
}

export type { Skill, SkillCheck, SkillContext, SkillProfile, SkillGoal, PriorArtifact, SkillFile, SkillExample } from "./types";
