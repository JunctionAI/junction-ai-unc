/* Bounded React hook harness. Tests callback correlation, not rendered browser acceptance. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ArtifactView } from "@/lib/artifacts/handlers";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[] }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      const i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = initial;
      return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }];
    },
    useRef: (current: unknown) => { const i = h.cursor++; return h.slots[i] ?? (h.slots[i] = { current }); },
    useEffect: (fn: () => (() => void) | void) => {
      const i = h.cursor++; if (h.slots[i]) return;
      h.slots[i] = true; const cleanup = fn(); if (cleanup) h.cleanups.push(cleanup);
    },
  };
});
import DraftCard from "../DraftCard";
import Drafts from "../Drafts";

const artifact: ArtifactView = { id: "draft", accountId: "a", contextGeneration: 1, revision: 4, runId: "run", routineId: "D03-W01",
  routineName: "Keyword opportunity", category: "SEO", kind: "keyword_list", title: "Discovery seed", body: "golf travel bag",
  editedBody: null, items: [], meta: {}, evidence: [], status: "draft", preview: "golf travel bag", createdAt: "2026-09-05T00:00:00Z" };
type Element = ReactElement<Record<string, unknown>>;
function find(tree: unknown, testid: string): Element | undefined {
  if (Array.isArray(tree)) return tree.map(t => find(t, testid)).find(Boolean);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return;
  const e = tree as Element;
  return e.props["data-testid"] === testid ? e : find(e.props.children, testid);
}
function render(onChange = vi.fn()) {
  h.cursor = 0;
  const bound = DraftCard({ artifact, channels: ["slack"], defaultOpen: true, onChange });
  return (bound.type as (p: typeof bound.props) => Element)(bound.props);
}
const click = (tree: Element, id: string) => (find(tree, id)!.props.onClick as () => void)();
beforeEach(() => { h.slots = []; h.cursor = 0; h.cleanups = []; });
afterEach(() => { h.cleanups.forEach(fn => fn()); vi.unstubAllGlobals(); });

describe("draft delivery callback lifecycle", () => {
  it("captures account/generation/revision, blocks double clicks, and calls queued not sent", async () => {
    let finish!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => { finish = r; }));
    vi.stubGlobal("fetch", fetcher);
    const tree = render();
    click(tree, "artifact-send-slack"); click(tree, "artifact-send-slack");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ "x-unc-account-id": "a", "x-unc-context-generation": "1" });
    expect(JSON.parse(String(init.body))).toMatchObject({ expectedRevision: 4, action: "send", channel: "slack" });
    finish(Response.json({ sent: [{ channel: "slack", status: "queued" }] }));
    await vi.waitFor(() => expect(find(render(), "artifact-note")?.props.children).toContain("not sent yet"));
    click(render(), "artifact-send-slack");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retry = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(retry.body).toBe(init.body);
    finish(Response.json({ sent: [{ channel: "slack", status: "sent" }] }));
  });

  it("does not apply a late decision to a disposed card", async () => {
    let finish!: (r: Response) => void;
    const changed = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { finish = r; })));
    click(render(changed), "artifact-approve");
    h.cleanups.forEach(fn => fn());
    finish(Response.json({ artifact: { ...artifact, status: "approved", revision: 5 } }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled();
    expect(find(render(changed), "artifact-status")?.props.children).toBe("Waiting on you");
  });

  it("rejects a returned artifact for a different account", async () => {
    const changed = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ artifact: { ...artifact, accountId: "other", status: "approved" } })));
    click(render(changed), "artifact-approve");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled();
    expect(find(render(changed), "artifact-status")?.props.children).toBe("Waiting on you");
  });

  it("account reset/revision changes replace the card/list lifecycle", () => {
    const key = DraftCard({ artifact }).key;
    expect(DraftCard({ artifact: { ...artifact, contextGeneration: 2 } }).key).not.toBe(key);
    expect(DraftCard({ artifact: { ...artifact, revision: 5 } }).key).not.toBe(key);
    const props = { accountMode: true, accountId: "a", contextGeneration: 1, anyOn: true, onOpenRoutine: vi.fn() };
    expect(Drafts({ ...props, contextGeneration: 2 }).key).not.toBe(Drafts(props).key);
  });
});
