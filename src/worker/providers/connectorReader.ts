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
  log?: Logger;
}

export class WorkerConnectorReader implements ConnectorReader {
  private readonly readers: Partial<Record<Platform, Reader>>;
  private readonly now: () => Date;

  constructor(private readonly deps: WorkerConnectorReaderDeps) {
    this.readers = deps.readers ?? READERS;
    this.now = deps.now ?? (() => new Date());
  }

  async read(source: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult> {
    const accountId = ctx.account.accountId;
    const creds = await this.deps.credentials.get(accountId, source, ctx.account);
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

    const validate = () => this.deps.credentials.validate?.(creds);
    await validate();
    const guardedFetch: typeof fetch | undefined = this.deps.credentials.validate ? async (input, init) => {
      await validate();
      const response = await (this.deps.fetch ?? fetch)(input, init);
      await validate();
      return response;
    } : this.deps.fetch;
    const opts: ReaderOptions = { now: this.now, fetch: guardedFetch, timeoutMs: this.deps.timeoutMs };
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
