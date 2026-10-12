import { describe, expect, it } from "vitest";
import { roleRank, isRoleAllowed } from "./roles.js";

describe("roles", () => {
  it("orders roles by authority", () => {
    expect(roleRank("admin")).toBeGreaterThan(roleRank("recepcion"));
    expect(roleRank("recepcion")).toBeGreaterThan(roleRank("instructor"));
    expect(roleRank("instructor")).toBeGreaterThan(roleRank("socio"));
  });

  it("allows only listed roles", () => {
    expect(isRoleAllowed("admin", ["admin", "recepcion"])).toBe(true);
    expect(isRoleAllowed("socio", ["admin", "recepcion"])).toBe(false);
    expect(isRoleAllowed("instructor", ["instructor", "socio"])).toBe(true);
  });
});
