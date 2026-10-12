import { describe, expect, it } from "vitest";
import { resolveSession } from "./resolve-session.js";
import type { Database } from "@gym/db";

const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ACC_STAFF = "cccccccc-0000-0000-0000-00000000000c";
const ACC_SOCIO = "dddddddd-0000-0000-0000-00000000000d";
const ACC_NONE = "eeeeeeee-0000-0000-0000-00000000000e";
const MEMBER_1 = "aaaaaaaa-0000-0000-0000-000000000001";

/** Minimal fake of the two queries resolveSession performs. */
function fakeDb(opts: {
  assignments: { accountId: string; organizationId: string; role: string; active: boolean }[];
  membersByEmail: { id: string; organizationId: string; contactEmail: string }[];
}) {
  const state = {
    from: "" as string,
    joinCalled: false,
  };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = (table as { [k: string]: unknown } | undefined)?.constructor?.name ?? "";
        state.from = name;
        return {
          innerJoin: (_other: unknown) => {
            state.joinCalled = true;
            return {
              where: () => ({
                limit: async () =>
                  opts.assignments
                    .filter((a) => a.active && a.accountId === CURRENT_ACCOUNT)
                    .map((a) => ({ staff_assignments: a })),
              }),
            };
          },
          where: () => ({
            limit: async () =>
              opts.membersByEmail
                .filter((m) => m.contactEmail === CURRENT_EMAIL)
                .map((m) => m),
          }),
        };
      },
    }),
  };
  return { db: db as unknown as Database, state };
}

let CURRENT_ACCOUNT = "";
let CURRENT_EMAIL = "";

describe("resolveSession", () => {
  it("returns staff context with organization and role from the active assignment", async () => {
    CURRENT_ACCOUNT = ACC_STAFF;
    CURRENT_EMAIL = "admin@a.cl";
    const { db } = fakeDb({
      assignments: [
        { accountId: ACC_STAFF, organizationId: ORG_A, role: "admin", active: true },
      ],
      membersByEmail: [],
    });
    const ctx = await resolveSession(db, { id: ACC_STAFF, email: "admin@a.cl" });
    expect(ctx).toMatchObject({
      organizationId: ORG_A,
      role: "admin",
      actorId: ACC_STAFF,
    });
    expect(ctx?.memberId).toBeUndefined();
  });

  it("returns socio context with memberId scoped to the linked member", async () => {
    CURRENT_ACCOUNT = ACC_SOCIO;
    CURRENT_EMAIL = "socio@a.cl";
    const { db } = fakeDb({
      assignments: [],
      membersByEmail: [{ id: MEMBER_1, organizationId: ORG_A, contactEmail: "socio@a.cl" }],
    });
    const ctx = await resolveSession(db, { id: ACC_SOCIO, email: "socio@a.cl" });
    expect(ctx).toMatchObject({ role: "socio", organizationId: ORG_A, memberId: MEMBER_1 });
  });

  it("returns undefined when the account has no active binding (401, not a downgrade)", async () => {
    CURRENT_ACCOUNT = ACC_NONE;
    CURRENT_EMAIL = "nadie@a.cl";
    const { db } = fakeDb({ assignments: [], membersByEmail: [] });
    const ctx = await resolveSession(db, { id: ACC_NONE, email: "nadie@a.cl" });
    expect(ctx).toBeUndefined();
  });

  it("ignores inactive staff assignments", async () => {
    CURRENT_ACCOUNT = ACC_STAFF;
    CURRENT_EMAIL = "admin@a.cl";
    const { db } = fakeDb({
      assignments: [
        { accountId: ACC_STAFF, organizationId: ORG_A, role: "admin", active: false },
      ],
      membersByEmail: [],
    });
    const ctx = await resolveSession(db, { id: ACC_STAFF, email: "admin@a.cl" });
    expect(ctx).toBeUndefined();
  });
});
