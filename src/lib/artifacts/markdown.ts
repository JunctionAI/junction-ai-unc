/* A tiny markdown reader for artifact bodies — headings, paragraphs, bullet / numbered lists,
   bold, italics, inline code. No dependency, no HTML in, no HTML out: it yields blocks and
   inline runs that DraftCard turns into React elements (and a plain-text fallback for
   channel messages). Anything it doesn't recognise is a paragraph. Pure. */

export type InlineRun = { kind: "text" | "bold" | "em" | "code"; text: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: InlineRun[][] }
  | { type: "quote"; runs: InlineRun[] }
  | { type: "rule" };

const INLINE_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;

export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ kind: "text", text: text.slice(last, at) });
    if (m[2] !== undefined || m[3] !== undefined) runs.push({ kind: "bold", text: m[2] ?? m[3] });
    else if (m[4] !== undefined) runs.push({ kind: "code", text: m[4] });
    else runs.push({ kind: "em", text: m[5] ?? m[6] });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last) });
  return runs.length ? runs : [{ kind: "text", text }];
}

export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", runs: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, runs: parseInline(h[2].trim()) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      flushList();
      blocks.push({ type: "rule" });
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1].trim());
      continue;
    }
    const q = /^>\s?(.*)$/.exec(t);
    if (q) {
      flushPara();
      flushList();
      blocks.push({ type: "quote", runs: parseInline(q[1]) });
      continue;
    }
    if (list) {
      // a wrapped list line continues the last item
      list.items[list.items.length - 1] += ` ${t}`;
      continue;
    }
    para.push(t);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Markdown → plain text (channel messages, the copy button's fallback). */
export function markdownToPlain(body: string): string {
  return parseMarkdown(body)
    .map((b) => {
      const text = (runs: InlineRun[]) => runs.map((r) => r.text).join("");
      switch (b.type) {
        case "heading":
          return text(b.runs).toUpperCase();
        case "paragraph":
        case "quote":
          return text(b.runs);
        case "list":
          return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "•"} ${text(it)}`).join("\n");
        case "rule":
          return "—";
      }
    })
    .join("\n\n");
}

/** The first non-empty lines, for a card preview. */
export function firstLines(body: string, n = 2, maxChars = 220): string {
  const lines = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^#{1,3}\s+/, "").replace(/\*\*|__|`/g, "").trim())
    .filter(Boolean);
  return lines.slice(0, n).join(" · ").slice(0, maxChars);
}
