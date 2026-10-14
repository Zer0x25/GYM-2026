import { webcrypto } from "node:crypto";
import { beforeAll, afterAll, vi, describe, expect, it } from "vitest";
import { encryptBundle, decryptBundle, checkLease } from "./offline-vault.js";
import type { OfflineLease } from "../api.js";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const issued = Date.now();
const lease: OfflineLease = {
  deviceId: "d",
  organizationId: "o",
  accountId: "a",
  issuedAt: new Date(issued).toISOString(),
  expiresAt: new Date(issued + 72 * 3600000).toISOString(),
  permit: "signed",
  members: [],
};
describe("SPEC 010 outbox cifrada", () => {
  it("cifrado no contiene datos claros, frase incorrecta y alteración fallan", async () => {
    const saved = await encryptBundle(
      { lease, events: [{ eventId: "private-event-id" }], results: [], lastClock: Date.now() },
      "frase-local-segura-010",
    );
    expect(JSON.stringify(saved)).not.toContain("private-event-id");
    expect(await decryptBundle(saved, "frase-local-segura-010")).toMatchObject({ lease });
    await expect(decryptBundle(saved, "otra-frase-local-010")).rejects.toThrow();
    await expect(
      decryptBundle(
        { ...saved, ciphertext: saved.ciphertext.slice(0, -4) + "AAAA" },
        "frase-local-segura-010",
      ),
    ).rejects.toThrow();
  });
  it("vence a 72h, no acepta reloj retrocedido ni cuenta ajena", () => {
    expect(() =>
      checkLease(lease, { accountId: "a", organizationId: "o" }, Date.now(), Date.now()),
    ).not.toThrow();
    expect(() =>
      checkLease(lease, { accountId: "b", organizationId: "o" }, Date.now(), Date.now()),
    ).toThrow();
    expect(() =>
      checkLease(
        lease,
        { accountId: "a", organizationId: "o" },
        new Date(lease.expiresAt).getTime() + 1,
        Date.now(),
      ),
    ).toThrow();
    expect(() =>
      checkLease(lease, { accountId: "a", organizationId: "o" }, Date.now() - 120000, Date.now()),
    ).toThrow();
  });
});
