/* D04-W03 Meeting brief builder → meeting_brief (who, where the deal sits, the opening question). */
import { minimum, need, rows, type Skill } from "./types";

export const meetingBrief: Skill = {
  id: "D04-W03",
  routineId: "D04-W03",
  name: "Meeting brief builder",
  kind: "meeting_brief",
  maxItems: 5,
  purpose: "A one-page brief per external meeting: who they are, where the deal sits, the last threads, the question to open with",
  inputs: ["today's external meetings (calendar, when connected)", "the attendees' HubSpot records (when connected)", "recent threads with them (Gmail, when connected)", "a meeting the founder describes"],
  file: {
    goal: "One page per meeting: who, where the deal sits, last threads, the opening question",
    owns: ["the meeting_brief artifact"],
    reads: ["calendar", "HubSpot", "Gmail threads", "a meeting the founder describes"],
    decides: ["which meetings are external", "the one question that moves the deal"],
    writes: ["a meeting_brief artifact"],
    never: ["invent who they are", "join the call", "write a brief from an empty calendar without asking"],
    apply: "Drafts. I keep the same opener when you keep using it.",
    examples: [
      { when: "founder says 'coffee with Sam from Harbour'", does: "one brief from that note, Who = what they told me, Open with one question" },
    ],
  },
  minimum: minimum("today's meetings from a calendar or HubSpot, or tell me who you're meeting", [], ["meeting"], ["hubspot", "gmail"]),
  domain: "sales",
  prompt: `CRAFT — meeting brief:
- One item per meeting (max 5). Title = who + company + time if known. Body sections: **Who** (only facts from the CRM rows, threads or the founder's note), **Where it sits** (deal stage / last activity from the rows, else "no record yet"), **Last three threads** (subjects + one-line gist, from the material), **Open with** (one question that moves the deal), **Watch for** (one risk).
- Never invent history, titles or sentiment. Missing material reads as "not on file".
- meta per item: { company: "…", stage: "<from CRM or null>", attendees: [] }.`,
  outputSpec: `{"kind":"meeting_brief","title":"Briefs for <n> meeting(s) today","body":"one line per meeting: the point of it","items":[{"title":"…","body":"<markdown sections>","meta":{"company":"…","stage":null,"attendees":[]}}],"evidence":[{"source":"read:meetings|read:contacts|read:threads|input:meeting","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const m = rows(ctx, "meetings").length;
    if (m) using.push(`${m} meetings`);
    if (rows(ctx, "contacts").length) using.push("CRM records");
    if (rows(ctx, "threads").length) using.push("recent threads");
    if (ctx.inputs.meeting) using.push("the meeting you described");
    if (m || ctx.inputs.meeting) return { ok: true, using };
    return { ok: false, needs: [need.platform("hubspot", "the deal record for who you're meeting"), need.input("meeting", "or tell me who you're meeting, when, and what it's about")], note: "A calendar connector is coming; until then the meeting comes from HubSpot or from you." };
  },
};
