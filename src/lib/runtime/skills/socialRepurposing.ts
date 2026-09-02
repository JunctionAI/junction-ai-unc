/* D01-W05 Social repurposing → post_set (one post → five formats). */
import { minimum, need, rows, type Skill } from "./types";

export const socialRepurposing: Skill = {
  id: "D01-W05",
  routineId: "D01-W05",
  name: "Social repurposing",
  kind: "post_set",
  maxItems: 5,
  purpose: "The best recent post repurposed into five formats: reel script, carousel, LinkedIn post, email blurb, X thread",
  inputs: ["recent Instagram posts with plays/saves (when connected)", "LinkedIn posts (when connected)", "YouTube videos + transcripts (when connected)", "a post the founder pastes"],
  minimum: minimum("at least one recent post — from a connected social account or pasted by you", [], ["source_post"], ["instagram", "linkedin", "youtube"]),
  domain: "content",
  prompt: `CRAFT — repurposing:
- Pick the strongest source post (highest saves/plays when you have them; the pasted one otherwise) and name it in the body.
- Five items, one per format, each complete and ready to post: (1) reel script with spoken lines and on-screen text, (2) carousel: 6–8 slide headlines + a caption, (3) LinkedIn post: hook, three short paragraphs, question, (4) email blurb: subject + 80–120 words, (5) X thread: 5–7 tweets, each under 260 characters.
- Keep the source's claims and facts exactly; change the shape, not the substance. No new statistics, no new customer stories.
- meta per item: { format: "reel" | "carousel" | "linkedin" | "email" | "x_thread", source_ref: "<post caption / title>" }.`,
  outputSpec: `{"kind":"post_set","title":"<source post, five ways>","body":"which post you chose and why (its numbers if you have them)","items":[{"title":"<format>: <hook>","body":"<the full piece, markdown>","meta":{"format":"…","source_ref":"…"}}],"evidence":[{"source":"read:ig|read:li|read:yt|input:source_post","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    for (const [alias, label] of [["ig", "Instagram posts"], ["li", "LinkedIn posts"], ["yt", "YouTube videos"]] as const) {
      const n = rows(ctx, alias).length;
      if (n) using.push(`${n} ${label}`);
    }
    if (ctx.inputs.source_post) using.push("the post you pasted");
    if (using.length) return { ok: true, using };
    return { ok: false, needs: [need.input("source_post", "paste the post (caption or script) you want repurposed — or connect Instagram, LinkedIn or YouTube and I’ll pick the best recent one")] };
  },
};
