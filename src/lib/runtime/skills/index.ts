/* The wave-1 skill cards, by routine id. */
import { abandonedCart } from "./abandonedCart";
import { campaignCalendar } from "./campaignCalendar";
import { contentGap } from "./contentGap";
import { customerQuestions } from "./customerQuestions";
import { founderContent } from "./founderContent";
import { keywordScan } from "./keywordScan";
import { leadResearch } from "./leadResearch";
import { meetingBrief } from "./meetingBrief";
import { outboundDrafts } from "./outboundDrafts";
import { socialRepurposing } from "./socialRepurposing";
import type { Skill } from "./types";

export const SKILLS: Skill[] = [founderContent, customerQuestions, socialRepurposing, keywordScan, contentGap, leadResearch, outboundDrafts, meetingBrief, abandonedCart, campaignCalendar];

export const SKILL_BY_ID: Record<string, Skill> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function skillFor(id: string): Skill | null {
  return SKILL_BY_ID[id] ?? null;
}

export type { Skill, SkillCheck, SkillContext, SkillProfile, SkillGoal, PriorArtifact, SkillFile, SkillExample } from "./types";
