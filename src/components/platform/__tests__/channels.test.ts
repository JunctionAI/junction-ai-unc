/* ConnectChannelStep + ChannelsSettings rendered to a string (react-dom/server): the copy
   floor, honest "not switched on" states, and the linked state — no fetch, no DOM. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChannelsSettings, { describeLink, EMPTY_LINE, SETTINGS_LINE } from "../ChannelsSettings";
import ConnectChannelStep, { APP_ONLY_LABEL, LATER_LABEL, NOT_ON_LINE, STEP_LINE, STEP_TITLE, verifiedFor, type LinksListing, type WireLink } from "../ConnectChannelStep";

const channels: LinksListing["channels"] = [
  { channel: "telegram", configured: true, botUsername: "UncBot" },
  { channel: "whatsapp", configured: false },
  { channel: "slack", configured: true },
  { channel: "sms", configured: false },
  { channel: "email", configured: false },
  { channel: "apple", configured: false, setupNote: "Apple Messages is awaiting provider setup." },
];
const tg: WireLink = { id: "l1", channel: "telegram", label: "Telegram", verified: true, handle: "tomh", displayName: "Tom", verifiedAt: "2026-09-02T09:00:00.000Z", codeExpiresAt: null, prefs: { brief: true, approvals: true, drafts: false, quiet_hours: { start: "22:00", end: "07:00" } }, lastInboundAt: null, workspace: null };

describe("ConnectChannelStep", () => {
  it("asks where to reach you, names the same-conversation promise, and is honest about what is switched on", () => {
    const html = renderToStaticMarkup(createElement(ConnectChannelStep, { initial: { links: [], channels } }));
    expect(html).toContain(STEP_TITLE);
    expect(html).toContain(STEP_LINE);
    expect(html).toContain(LATER_LABEL);
    expect(html).toContain(APP_ONLY_LABEL);
    expect(html).toContain('data-testid="choice-telegram" data-configured="1"');
    expect(html).toContain('data-testid="choice-whatsapp" data-configured="0"');
    expect(html).toContain('data-testid="choice-apple" data-configured="0"');
    expect(html).toContain("Apple Messages is awaiting provider setup.");
    expect((html.match(new RegExp(NOT_ON_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBe(2); // whatsapp + sms
    expect(html).not.toContain("Linked");
    expect(html).not.toContain("!");
  });

  it("shows the linked state per channel and the summary line", () => {
    const html = renderToStaticMarkup(createElement(ConnectChannelStep, { initial: { links: [tg], channels } }));
    expect(html).toContain("Linked");
    expect(html).toContain("Reaching you on Telegram.");
    expect(verifiedFor({ links: [tg], channels }, "telegram")?.id).toBe("l1");
    expect(verifiedFor({ links: [tg], channels }, "slack")).toBeNull();
  });
});

describe("ChannelsSettings", () => {
  it("empty: the app-only line + the connect step inline", () => {
    const html = renderToStaticMarkup(createElement(ChannelsSettings, { initial: { links: [], channels } }));
    expect(html).toContain(SETTINGS_LINE);
    expect(html).toContain(EMPTY_LINE);
    expect(html).toContain('data-testid="connect-channel-step"');
  });

  it("a linked channel: toggles reflect prefs, quiet hours show their times, unlink + add another", () => {
    const html = renderToStaticMarkup(createElement(ChannelsSettings, { initial: { links: [tg], channels } }));
    expect(html).toContain('data-testid="link-telegram"');
    expect(html).toContain("Tom · tomh");
    expect(html).toContain('aria-checked="true" aria-label="Morning brief on Telegram"');
    expect(html).toContain('aria-checked="false" aria-label="Drafts on Telegram"');
    expect(html).toContain('value="22:00"');
    expect(html).toContain('value="07:00"');
    expect(html).toContain('data-testid="unlink"');
    expect(html).toContain('data-testid="add-channel"');
    expect(html).not.toContain(EMPTY_LINE);
    expect(describeLink({ ...tg, channel: "slack", workspace: "Acme" })).toBe("Acme workspace");
    expect(describeLink({ ...tg, displayName: null, handle: null })).toBe("this device");
  });
});
