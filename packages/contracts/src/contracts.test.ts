import { describe, expect, it } from "vitest";
import {
  CreateMemberRequest,
  CreateOrganizationRequest,
  CreatePlanRequest,
  ErrorCode,
  SessionResponse,
} from "./index.js";

describe("contracts", () => {
  it("accepts a valid create-organization request", () => {
    const parsed = CreateOrganizationRequest.safeParse({ name: "Gimnasio Piloto" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty organization name with a stable error code", () => {
    const parsed = CreateOrganizationRequest.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid member email", () => {
    const parsed = CreateMemberRequest.safeParse({
      fullName: "Socio Uno",
      contactEmail: "no-es-email",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates plan coverage values", () => {
    expect(
      CreatePlanRequest.safeParse({
        name: "Plan Full",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
      }).success,
    ).toBe(true);
    expect(
      CreatePlanRequest.safeParse({
        name: "Plan Raro",
        priceCents: 30000,
        durationDays: 30,
        coverage: "ilimitado",
      }).success,
    ).toBe(false);
  });

  it("exposes stable error codes including UNAUTHENTICATED and FORBIDDEN", () => {
    expect(ErrorCode.options).toContain("UNAUTHENTICATED");
    expect(ErrorCode.options).toContain("FORBIDDEN");
  });

  it("validates a session response with role and organization", () => {
    const parsed = SessionResponse.safeParse({
      user: { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", email: "admin@gym.cl", name: "Admin" },
      organization: { id: "3fa85f64-5717-4562-b3fc-2c963f66afa7", name: "Gym A" },
      role: "admin",
    });
    expect(parsed.success).toBe(true);
  });
});
