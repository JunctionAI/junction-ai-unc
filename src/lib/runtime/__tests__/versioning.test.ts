import { describe, expect, it } from "vitest";
import { catalogSpec } from "../catalog-specs";
import { PromoteRefusedError, discardDraft, effectiveSpec, getOrInitState, promoteDraft, saveDraft, setEnabled, validateDraft } from "../versioning";
import { FailingReader } from "../providers";
import { SPEND_FIXTURE, adapters, budgetMoveSpec, input } from "./helpers";
import type { Node } from "../types";

const ACCT = "acct-1";

describe("draft → validate → promote", () => {
  it("initialises v1 with no draft and the catalog spec as the effective spec", async () => {
    const { store } = adapters();
    const state = await getOrInitState({ store }, ACCT, "D02-W01");
    expect(state).toMatchObject({ version: 1, enabled: false, draftSpec: null, liveSpec: null });
    expect(effectiveSpec(state, catalogSpec("D02-W01"))).toMatchObject({ id: "D02-W01", version: 1 });
  });

  it("promote refuses when there is no draft", async () => {
    const { store } = adapters();
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(PromoteRefusedError);
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(/no draft/);
  });

  it("promote refuses without a dry run of the draft", async () => {
    const { store } = adapters();
    const base = budgetMoveSpec();
    const state = await saveDraft({ store }, ACCT, base, base.nodes);
    expect(state.draftSpec?.version).toBe(2);
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(/no dry run has been recorded for draft v2/);
  });

  it("promote refuses when the last dry run failed", async () => {
    const { adapters: a, store } = adapters();
    a.reader = new FailingReader("Meta unreachable");
    const base = budgetMoveSpec();
    await saveDraft({ store }, ACCT, base, base.nodes);
    const outcome = await validateDraft({ store }, a, ACCT, "D02-W01", input());
    expect(outcome.passed).toBe(false);
    expect(outcome.run.status).toBe("failed");
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(/last dry run .* failed: read failed: Meta unreachable/);
  });

  it("promote succeeds after a passing dry run and increments the version", async () => {
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE });
    const base = budgetMoveSpec();
    const edited: Node[] = base.nodes.map((n) => (n.kind === "gate" ? { ...n, expiryHours: 12 } : n));
    await saveDraft({ store }, ACCT, base, edited);
    const outcome = await validateDraft({ store }, a, ACCT, "D02-W01", input());
    expect(outcome.passed).toBe(true);
    expect(outcome.run.mode).toBe("dry_run");
    expect(outcome.run.version).toBe(2);

    const promoted = await promoteDraft({ store }, ACCT, "D02-W01");
    expect(promoted.version).toBe(2);
    expect(promoted.draftSpec).toBeNull();
    expect(promoted.liveSpec?.version).toBe(2);
    expect(promoted.liveSpec?.nodes.find((n) => n.kind === "gate")).toMatchObject({ expiryHours: 12 });

    // next draft is v3 on top of the promoted spec
    const next = await saveDraft({ store }, ACCT, base, { nodes: edited });
    expect(next.draftSpec?.version).toBe(3);
    expect(next.liveSpec?.version).toBe(2);
  });

  it("a dry run that skipped at a check still counts as passing", async () => {
    const { adapters: a, store } = adapters({ fixtures: { "meta_ads:insights": { rows: [], metrics: { spend: 0 } } } });
    const base = budgetMoveSpec();
    await saveDraft({ store }, ACCT, base, base.nodes);
    const outcome = await validateDraft({ store }, a, ACCT, "D02-W01", input());
    expect(outcome.run.status).toBe("skipped");
    expect(outcome.passed).toBe(true);
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).resolves.toMatchObject({ version: 2 });
  });

  it("editing the draft after the dry run invalidates it (spec hash mismatch)", async () => {
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE });
    const base = budgetMoveSpec();
    await saveDraft({ store }, ACCT, base, base.nodes);
    await validateDraft({ store }, a, ACCT, "D02-W01", input());
    const edited: Node[] = base.nodes.map((n) => (n.kind === "gate" ? { ...n, expiryHours: 6 } : n));
    await saveDraft({ store }, ACCT, base, edited);
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(/no dry run has been recorded/);
  });

  it("a live dry run of the same version does not count — only mode dry_run", async () => {
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE });
    const base = budgetMoveSpec();
    const state = await saveDraft({ store }, ACCT, base, base.nodes);
    // a live run of the draft spec (should never happen, but must not unlock promote)
    const { runRoutine } = await import("../engine");
    await runRoutine(state.draftSpec!, input(), a, { mode: "live" });
    await expect(promoteDraft({ store }, ACCT, "D02-W01")).rejects.toThrow(/no dry run/);
  });

  it("saveDraft rejects structurally invalid drafts", async () => {
    const { store } = adapters();
    const base = budgetMoveSpec();
    const noGate = base.nodes.filter((n) => n.kind !== "gate");
    await expect(saveDraft({ store }, ACCT, base, noGate)).rejects.toThrow(/execute requires a gate/);
    expect((await getOrInitState({ store }, ACCT, "D02-W01")).draftSpec).toBeNull();
  });

  it("discardDraft and setEnabled leave the live version untouched", async () => {
    const { store } = adapters();
    const base = budgetMoveSpec();
    await saveDraft({ store }, ACCT, base, base.nodes);
    const discarded = await discardDraft({ store }, ACCT, "D02-W01");
    expect(discarded.draftSpec).toBeNull();
    expect(discarded.version).toBe(1);
    const enabled = await setEnabled({ store }, ACCT, "D02-W01", true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.version).toBe(1);
  });
});
