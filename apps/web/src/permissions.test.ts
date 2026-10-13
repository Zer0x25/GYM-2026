/**
 * Permissions unit tests: these helpers MIRROR the backend RBAC matrix
 * (docs/api/README.md "Matriz RBAC"). They gate UX only (the API is the
 * authority), but they must stay in lockstep with the server or staff
 * sees nav/actions the backend will 403. This test is that lockstep guard.
 */
import { describe, expect, it } from "vitest";
import {
  canUseMostrador,
  canUseCash,
  canUsePayments,
  canDecidePayments,
  canManageMembers,
  canReadMembers,
  canUseClasses,
} from "./permissions";

describe("RBAC mirror (front ↔ backend matrix)", () => {
  // Mostrador / check-in → admin, recepcion (POST /checkin, /checkins/recent).
  it("mostrador: admin+recepcion only", () => {
    expect(canUseMostrador("admin")).toBe(true);
    expect(canUseMostrador("recepcion")).toBe(true);
    expect(canUseMostrador("instructor")).toBe(false);
    expect(canUseMostrador("socio")).toBe(false);
    expect(canUseMostrador(undefined)).toBe(false);
  });

  // Cash → admin, recepcion (all /cash/*).
  it("cash: admin+recepcion only", () => {
    expect(canUseCash("admin")).toBe(true);
    expect(canUseCash("recepcion")).toBe(true);
    expect(canUseCash("instructor")).toBe(false);
    expect(canUseCash("socio")).toBe(false);
  });

  // Payments tray → admin, recepcion (GET/POST /payments).
  it("payments tray: admin+recepcion only", () => {
    expect(canUsePayments("admin")).toBe(true);
    expect(canUsePayments("recepcion")).toBe(true);
    expect(canUsePayments("instructor")).toBe(false);
    expect(canUsePayments("socio")).toBe(false);
  });

  // Validate/reject → admin only (separation of functions, SPEC:PAY-02).
  it("payment decision: admin only", () => {
    expect(canDecidePayments("admin")).toBe(true);
    expect(canDecidePayments("recepcion")).toBe(false);
    expect(canDecidePayments("instructor")).toBe(false);
    expect(canDecidePayments("socio")).toBe(false);
  });

  // Create members / register payments → admin, recepcion.
  it("manage members: admin+recepcion only", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("recepcion")).toBe(true);
    expect(canManageMembers("instructor")).toBe(false);
    expect(canManageMembers("socio")).toBe(false);
  });

  // Read members list → admin, recepcion, instructor (GET /members).
  it("read members: staff incl. instructor, never socio", () => {
    expect(canReadMembers("admin")).toBe(true);
    expect(canReadMembers("recepcion")).toBe(true);
    expect(canReadMembers("instructor")).toBe(true);
    expect(canReadMembers("socio")).toBe(false);
  });

  // Classes/agenda/attendance → admin, recepcion, instructor.
  it("classes: all staff, never socio (own portal is separate)", () => {
    expect(canUseClasses("admin")).toBe(true);
    expect(canUseClasses("recepcion")).toBe(true);
    expect(canUseClasses("instructor")).toBe(true);
    expect(canUseClasses("socio")).toBe(false);
  });
});
