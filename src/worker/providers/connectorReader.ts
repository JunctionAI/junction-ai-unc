/* The worker's ConnectorReader: resolves credentials through the injected
   CredentialProvider, dispatches by platform to a reader, and maps the
   reader's answer onto the engine's ReadResult.

   "couldn't ask" vs "nothing happened":
     reader {ok:false}   → throws → the engine fails the run with a receipt
                           naming the platform + reason (an incident)
     reader {ok:true, 0} → ReadResult provenance "empty" (the platform
                           answered; there was nothing)
     fixture data        → provenance "fixture" so no receipt can be mistaken
                           for a live read
   Platforms with no reader yet (instagram, gorgias, gmail, …) answer an
   empty fixture result under fixture credentials and "couldn't ask" under
   anything else. */

import type { ConnectorReader, Platform, ReadQuery, ReadResult, RunContext } from "../../lib/runtime/types";
import { describeCredential, type CredentialProvider } from "../credentials";
import type { Logger } from "../log";
import * as ga4 from "../readers/ga4";
import * as googleAds from "../readers/googleAds";
import * as hubspot from "../readers/hubspot";
import * as klaviyo from "../readers/klaviyo";
import * as meta from "../readers/meta";
import * as shopify from "../readers/shopify";
import type { Reader, ReaderOptions } from "../readers/types";

export const READERS: Partial<Record<Platform, Reader>> = {
  shopify: shopify.read,
  klaviyo: klaviyo.read,
  ga4: ga4.read,
  meta_ads: meta.read,
  google_ads: googleAds.read,
  hubspot: hubspot.read,
};

export interface WorkerConnectorReaderDeps {
  credentials: CredentialProvider;
  readers?: Partial<Record<Platform, Reader>>;
  now?: () => Date;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Across credential resolution, all pages, bodies and final grant validation. */
  totalTimeoutMs?: number;
  log?: Logger;
}

export const DEFAULT_TOTAL_READ_TIMEOUT_MS = 30_000;

export class WorkerConnectorReader implements ConnectorReader {
  private readonly readers: Partial<Record<Platform, Reader>>;
  private readonly now: () => Date;

  constructor(private readonly deps: WorkerConnectorReaderDeps) {
    this.readers = deps.readers ?? READERS;
    this.now = deps.now ?? (() => new Date());
  }

  async read(source: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult> {
    const totalTimeoutMs = this.deps.totalTimeoutMs ?? DEFAULT_TOTAL_READ_TIMEOUT_MS;
    if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > 2_147_483_647)
      throw new Error("invalid total read timeout");
    const controller = new AbortController();
    const timeoutError = new Error(`couldn't ask ${source} ${query.resource}: total read timeout after ${totalTimeoutMs}ms`);
    const deadlineAt = Date.now() + totalTimeoutMs;
    const assertActive = () => {
      // JSON parsing or other synchronous work can delay the timer callback.
      // Do not certify a late result merely because its microtask won that race.
      if (Date.now() >= deadlineAt && !controller.signal.aborted) controller.abort(timeoutError);
      controller.signal.throwIfAborted();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(timeoutError); reject(timeoutError); }, totalTimeoutMs);
    });
    try {
      // Racing bounds even a custom credential/reader promise that ignores abort.
      // The guards below prevent its later completion from starting another fetch
      // or becoming an accepted read. This does not cancel arbitrary DB promises.
      return await Promise.race([this.readWithinDeadline(source, query, ctx, controller.signal, assertActive), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readWithinDeadline(source: Platform, query: ReadQuery, ctx: RunContext, signal: AbortSignal, assertActive: () => void): Promise<ReadResult> {
    const accountId = ctx.account.accountId;
    const creds = await this.deps.credentials.get(accountId, source, ctx.account);
    assertActive();
    if (!creds) throw new Error(`couldn't ask ${source} ${query.resource}: nothing connected for this account`);

    const reader = this.readers[source];
    const fetchedAt = this.now().toISOString();
    if (!reader) {
      if (creds.kind === "fixture") {
        this.deps.log?.debug("read.no_reader_fixture", { accountId, platform: source, resource: query.resource });
        return { rows: [], metrics: {}, fetchedAt, provenance: "fixture" };
      }
      throw new Error(`couldn't ask ${source} ${query.resource}: no reader for this platform yet (Wave 2)`);
    }

    const validate = async () => {
      assertActive();
      await this.deps.credentials.validate?.(creds);
      assertActive();
    };
    await validate();
    const guardedFetch: typeof fetch = async (input, init) => {
      await validate();
      const requestSignal = AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]);
      requestSignal.throwIfAborted();
      const response = await (this.deps.fetch ?? fetch)(input, { ...init, signal: requestSignal });
      await validate();
      return response;
    };
    const opts: ReaderOptions = { now: this.now, fetch: guardedFetch, timeoutMs: this.deps.timeoutMs, signal };
    const res = await reader(query, creds, opts);
    await validate();
    if (!res.ok) {
      this.deps.log?.warn("read.failed", { accountId, platform: source, resource: query.resource, credKind: describeCredential(creds), reason: res.reason });
      throw new Error(`couldn't ask ${source} ${query.resource}: ${res.reason}`);
    }
    this.deps.log?.debug("read.ok", { accountId, platform: source, resource: query.resource, source: res.provenance.source, rows: res.count });
    return {
      rows: res.rows,
      metrics: res.metrics,
      fetchedAt: res.provenance.fetchedAt,
      provenance: res.provenance.source === "fixture" ? "fixture" : res.count ? "ok" : "empty",
      ...(res.provenance.note ? { sourceNote: res.provenance.note } : {}),
    };
  }
}
