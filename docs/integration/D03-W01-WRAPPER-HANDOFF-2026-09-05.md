# D03-W01 wrapper handoff: received, not yet activated

Checked 5 September 2026, approximately 04:43 UTC. This records Nguyen's delivery and Codex's independent browser inspection. It is not an execution attestation or permission to start paid provider calls.

## Confirmed identifiers

| Field | Value / evidence |
|---|---|
| Workflow | `XiXJKuph1fAeH9pe` — `TEST — AVGAR — Unc D03-W01 — Keyword Shadow Wrapper`; UI says Published |
| Reported published revision | `4fb2f570-705f-40ed-99cd-fdbdf041420b` |
| Saved denial execution | [Execution 72](https://junctionai8.app.n8n.cloud/workflow/XiXJKuph1fAeH9pe/executions/72), 2026-09-05 03:49:06 UTC; 1.787 seconds; UI history link identifies that exact revision (`issue41-bind-creds`) |
| Receiver | `POST https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow` |
| Trigger node | `Unc Keyword Webhook`, `n8n-nodes-base.webhook`, rendered node ID `c934c229-1191-43b7-b035-5fc641fbe0d0` |
| Receiver credential reference | Header Auth → `Unc — AVGAR shadow receiver`; secret not opened or compared |
| Response mode | Using Respond to Webhook Node |
| Pilot binding | `aa5cfc84-2569-4c99-9b40-67003ae55eda`, `D03-W01`, `keyword_opportunity`, `unc.keyword-shadow.v1` |

Execution 72's trace contains only Webhook → Wrapper Config → Parse Request → Pinned Origin Ready? → Respond Origin Unset. No Shadow Authority or DataForSEO node ran. The n8n execution status is Succeeded because the refusal branch completed; it is **not keyword/provider success**. Its `token_example`, `run_local_failclosed`, `travel bag` and location 2840 are synthetic denial inputs, not an authorized Unc run or approved business configuration.

DataForSEO binding and absence of provider mutations are Nguyen's reported handoff evidence. Codex saw the provider endpoint and denial branch but has not proved credential health, the whole success contract, or an API-readable saved successful execution. UI inspection of a saved execution does not replace the runtime independent reader.

## Origin/revision correction

In `Wrapper Config`, `pinned_junction_origin` is a **fixed node field**, currently `CODEX_MUST_SET_PINNED_JUNCTION_ORIGIN`. It is not an already-configured deployment variable.

The correct value is exactly:

```text
https://junction-unc.vercel.app
```

The receiver should call `GET https://junction-unc.vercel.app/api/n8n/shadow-authority`. Do not append `/app`, use a changing preview origin, follow redirects, or take the authority destination from incoming `dataBaseUrl`.

Changing this field requires saving/republishing the wrapper, producing a **new final revision**. The current frozen revision evidences the unset-origin refusal only. Validate the configured wrapper and its connections, test refusal paths, publish once, then hand off/freeze the new revision. Reconfirm the webhook node ID against that revision. Do not register the old revision as the configured implementation.

Codex's current tool set has no n8n validation/update/publish tools. The installed n8n lifecycle skill requires validation and test evidence before publication, so Codex did not edit/publish a partial draft through the browser. Nguyen can make this one origin change with his existing n8n tooling and return the final revision. No new version lookup or receipt field is needed in the workflow.

## Ownership and remaining activation gates

1. **Nguyen:** apply the exact origin above, validate graph/denials, publish and freeze the resulting revision; retain actual workflow/execution IDs with `workflowVersion: null`, `revisionEvidence: "pending_unc_verification"`. Preserve Header Auth/DataForSEO bindings and the original SEO TEST. No paid authorized test until Codex issues the bounded run context.
2. **Codex:** pin the final wrapper/revision/webhook node and receiver URL; complete independent reader health/access verification, account-scoped registration, captured-context/admission and duplicate/uncertain-run controls; release the matching app/worker and issue the valid run-scoped data token. Signing roots, receiver secrets and execution API keys stay server-side, never relayed in chat.
3. **Owner/provider access:** the Cloud UI still shows a free trial. [Official n8n API documentation](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/authentication.md) says API access requires leaving the trial; non-Enterprise keys have broad account capability. Review supported access, plan cost and key permissions before provisioning. No purchase/key creation or private browser-cookie API workaround was performed.
4. **Tom:** confirm the exact keyword seed. US/NZ/AU are approved and must remain separate queries/results; the old test keyword is not an approval. No invented budget, business goal or product-price binding.
5. **Codex + Nguyen:** one bounded authorized shadow round trip after those gates, followed by independent saved-execution read and correlated Unc artifact/receipt readback. Test denial, duplicate and uncertain outcomes; no blind provider retry or LLM fallback.

Registration/dispatch remain inactive. AVGAR remains paused. Publishing content, customer messaging and ad mutation/spend activation remain disabled. The broader backend register remains open; Nguyen is not the only remaining dependency.

## Copyable reply to Nguyen

Thanks — I independently checked execution 72: the expected revision completed the missing-origin refusal in 1.787s and did not reach DataForSEO. Your receipt shape is correct: actual workflowId/executionId, workflowVersion null, revisionEvidence pending_unc_verification. Unc will establish the actual revision independently from the saved execution.

The canonical origin is https://junction-unc.vercel.app. Your Wrapper Config currently holds it as a fixed placeholder, so please set pinned_junction_origin to that exact value, validate/test the denial paths, and republish/freeze the new revision. Send that final revision; we must not pin 4fb2f570-705f-40ed-99cd-fdbdf041420b as though it already contains the origin. No change to the original SEO TEST or receipt schema is needed.

I own the Unc-side authority endpoint, final account/URL/revision/node registration, execution-reader configuration, run admission and valid dataToken. Supported execution API access and the owner-approved seed are still pending, so don't start the paid shadow test yet. I'll supply the bounded authorized run context after those gates are verified.
