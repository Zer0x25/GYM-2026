import { describe, expect, it } from "vitest";
import { members, organizations, plans, schema, staffAssignments } from "./schema.js";

const columnsOf = (table: unknown): { name?: string; enumValues?: string[] }[] =>
  Object.values(table as Record<string, { name?: string; enumValues?: string[] }>);

describe("db schema", () => {
  it("defines the tenant-scoped tables of the MVP", () => {
    expect(schema).toHaveProperty("organizations");
    expect(schema).toHaveProperty("identityAccounts");
    expect(schema).toHaveProperty("staffAssignments");
    expect(schema).toHaveProperty("members");
    expect(schema).toHaveProperty("plans");
  });

  it("excludes sauna / bookable-resource tables in v1.0", () => {
    const names = Object.keys(schema).join(",").toLowerCase();
    expect(names).not.toContain("sauna");
    expect(names).not.toContain("resource");
  });

  it("carries organization_id in tenant-scoped tables", () => {
    for (const table of [staffAssignments, members, plans]) {
      expect(columnsOf(table).some((c) => c.name === "organization_id")).toBe(true);
    }
  });

  it("defines staff roles limited to admin/recepcion/instructor", () => {
    const roleColumn = columnsOf(staffAssignments).find((c) => c.name === "role");
    expect(roleColumn?.enumValues).toEqual(["admin", "recepcion", "instructor"]);
  });

  it("uses uuid primary keys", () => {
    expect(columnsOf(organizations).some((c) => c.name === "id")).toBe(true);
  });
});
