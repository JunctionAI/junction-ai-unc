import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SLACK_SCOPES } from "../adapters/slack";

describe("Slack setup manifest", () => {
  it("matches runtime scopes while keeping installation and listeners separate", () => {
    const manifest = JSON.parse(readFileSync("deploy/slack/setup-manifest.json", "utf8"));
    expect(manifest.oauth_config.scopes.bot.toSorted()).toEqual(SLACK_SCOPES.toSorted());
    expect(manifest.oauth_config.scopes.user).toBeUndefined();
    expect(manifest.oauth_config.redirect_urls).toEqual(["https://junction-unc.vercel.app/api/channels/slack/callback"]);
    expect(manifest.settings.event_subscriptions).toBeUndefined();
    expect(manifest.settings.interactivity.is_enabled).toBe(false);
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.org_deploy_enabled).toBe(false);
    expect(manifest.features.bot_user.always_online).toBe(false);
    expect(manifest).not.toHaveProperty("credentials");
  });
});
