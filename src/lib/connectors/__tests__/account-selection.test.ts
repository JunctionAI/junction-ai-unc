import { describe, expect, it } from "vitest";
import { listMemberships } from "@/lib/db/accountState";
import { accountForUser } from "../store";
import { seededDb } from "./helpers";

describe("canonical multi-account selection", () => {
  it("session-facing and connector helpers both choose an owned account before an older member account", async () => {
    const { db, accountId: ownerAccount, userId } = seededDb();
    const memberAccount = db.insertRow("accounts", { name: "Older client", currency: "NZD" }).id as string;
    db.tables.set("account_members", [
      { account_id: memberAccount, user_id: userId, role: "member", created_at: "2026-01-01T00:00:00.000Z" },
      { account_id: ownerAccount, user_id: userId, role: "owner", created_at: "2026-02-01T00:00:00.000Z" },
    ]);

    expect((await listMemberships(db, userId))[0]).toEqual({ accountId: ownerAccount, role: "owner" });
    expect(await accountForUser(db, userId)).toBe(ownerAccount);
  });
});
