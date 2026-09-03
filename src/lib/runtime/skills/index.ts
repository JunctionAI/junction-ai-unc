/* Skill cards, by routine id — every catalog routine has one. Wave-1 and the
   remaining draft-only chains PRODUCE through theirs; mutating routines carry
   the file for the inspector (and a future produce step) without changing execute. */
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
import { hookRotation } from "./hookRotation";
import { keywordScan } from "./keywordScan";
import { leadResearch } from "./leadResearch";
import { meetingBrief } from "./meetingBrief";
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
];

export const SKILL_BY_ID: Record<string, Skill> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function skillFor(id: string): Skill | null {
  return SKILL_BY_ID[id] ?? null;
}

export type { Skill, SkillCheck, SkillContext, SkillProfile, SkillGoal, PriorArtifact, SkillFile, SkillExample } from "./types";
