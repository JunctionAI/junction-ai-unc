/* D02-W05 Creator whitelisting → outreach_draft (permission requests; the founder sends). */
import { minimum, need, rows, type Skill } from "./types";

export const creatorWhitelist: Skill = {
  id: "D02-W05",
  routineId: "D02-W05",
  name: "Creator whitelisting",
  kind: "outreach_draft",
  maxItems: 3,
  purpose: "Partnership-ad permission requests for the creator posts worth running as ads — drafted, never sent",
  inputs: ["Instagram media tagged to the brand (when connected)", "Meta partnership-ad insights (when connected)", "a creator post URL or handle the founder pastes"],
  file: {
    goal: "Up to three permission-request drafts the founder sends to creators",
    owns: ["the outreach_draft permission requests"],
    reads: ["tagged Instagram posts", "partnership ad insights when connected", "a pasted post URL/handle"],
    decides: ["which creator posts are worth whitelisting", "the ask in each request"],
    writes: ["an outreach_draft of up to three permission requests"],
    never: ["invent plays, saves or a creator handle", "send the permission request", "publish the whitelist ad"],
    apply: "Drafts. Sending the permission request stays yours.",
    examples: [
      { when: "two tagged posts with strong saves", does: "two requests naming the permalink and handle from the rows; founder sends" },
      { when: "founder pastes a creator post URL", does: "one request for that handle; no invented follower count" },
    ],
  },
  minimum: minimum("creator posts tagged to the brand — or paste a post URL/handle", [], ["creator_post"], ["instagram", "meta_ads"]),
  domain: "paid",
  prompt: `CRAFT — creator whitelist requests:
- One item per creator post, max 3. Prefer tagged Instagram rows (username, permalink, plays, saves). If the founder pasted a URL or handle, that is the first item. Never invent a handle, permalink, play count or save count.
- Each item is a permission request the founder sends: short, specific, names the post, asks to run it as a partnership ad from the brand's ad account, says the creator keeps the content credit. No money figure unless it is in the material.
- Partnership-ad insights (when present) can rank which creators already convert; cite CPA/CTR only if those fields are on the ads rows. Never invent ROAS, spend, frequency or CPA.
- Unc never sends the request and never publishes the ad. The founder sends; the ad runs only after the creator accepts.
- meta per item: { to: "<handle>", permalink: "<or null>", subject: "…" }.`,
  outputSpec: `{"kind":"outreach_draft","title":"<n> whitelist requests","body":"which posts, why those, and that you send the request","items":[{"title":"<handle>: <post hook>","body":"<the permission request>","meta":{"to":"…","permalink":null,"subject":"…"}}],"evidence":[{"source":"read:creators|read:ads|input:creator_post","ref":"…"}]}`,
  check(ctx) {
    const creators = rows(ctx, "creators").length;
    const using: string[] = [];
    if (creators) using.push(`${creators} tagged creator posts`);
    if (rows(ctx, "ads").length) using.push("partnership ad insights");
    if (ctx.inputs.creator_post) using.push("the creator post you pasted");
    if (creators || ctx.inputs.creator_post) return { ok: true, using };
    return { ok: false, needs: [need.platform("instagram", "creator posts tagged to the brand"), need.input("creator_post", "or paste the post URL/handle to whitelist")] };
  },
};
