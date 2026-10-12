import { describe, expect, it } from "vitest";
import { MembersService, type MemberActor } from "./members.js";
import { AppError } from "../errors.js";
import type { Database } from "@gym/db";

const S1 = "aaaaaaaa-0000-0000-0000-000000000001";
const S2 = "aaaaaaaa-0000-0000-0000-000000000002";

const socio: MemberActor = { organizationId: "org-a", role: "socio", memberId: S1 };

describe("MembersService — authorization rules", () => {
  it("rejects a socio updating another member's contact with FORBIDDEN (REQ-7)", async () => {
    const service = new MembersService({} as unknown as Database);
    await expect(service.updateContact(socio, S2, "otro@correo.cl")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects me() when the session is not linked to a member", async () => {
    const service = new MembersService({} as unknown as Database);
    await expect(service.me({ organizationId: "org-a", role: "socio" })).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
