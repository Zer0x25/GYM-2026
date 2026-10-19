import { describe, expect, it } from "vitest";
import {
  RequestContactVerification,
  ConfirmContactVerification,
  EmailCapabilities,
  CreateMemberRequest,
  CreateOrganizationRequest,
  CreatePlanRequest,
  ErrorCode,
  SessionResponse,
  RegisterPaymentRequest,
  RegisterFinancialAdjustmentRequest,
  AttendanceReportQuery,
} from "./index.js";

describe("contracts", () => {
  it("SPEC016 cuotas limitadas son completas, enteras y separadas por modalidad", () => {
    const plan = { name: "Limitado", priceCents: 10000, durationDays: 30, coverage: "limited" };
    for (const classCredits of [
      undefined,
      { grupal: 1 },
      { grupal: -1, fija: 2, cita: 0 },
      { grupal: 1.5, fija: 2, cita: 0 },
    ])
      expect(CreatePlanRequest.safeParse({ ...plan, classCredits }).success).toBe(false);
    expect(
      CreatePlanRequest.safeParse({ ...plan, classCredits: { grupal: 1, fija: 2, cita: 0 } })
        .success,
    ).toBe(true);
    expect(
      CreatePlanRequest.safeParse({
        ...plan,
        coverage: "unlimited",
        classCredits: { grupal: 1, fija: 2, cita: 0 },
      }).success,
    ).toBe(false);
  });
  it("SPEC015 exige correo y token opaco; capacidad es explícita", () => {
    expect(RequestContactVerification.parse({ email: " nuevo@example.test " }).email).toBe(
      "nuevo@example.test",
    );
    expect(RequestContactVerification.safeParse({ email: "invalido" }).success).toBe(false);
    expect(ConfirmContactVerification.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(ConfirmContactVerification.safeParse({ token: "adivinado" }).success).toBe(false);
    expect(
      EmailCapabilities.safeParse({ passwordReset: false, contactVerification: false }).success,
    ).toBe(true);
    expect(ErrorCode.safeParse("SERVICE_UNAVAILABLE").success).toBe(true);
  });
  it("SPEC 014 exige intención, motivo e importe positivo de compensación", () => {
    const base = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      kind: "refund",
      amountCents: 5000,
      reason: " Corrección autorizada ",
    };
    expect(RegisterFinancialAdjustmentRequest.parse(base).reason).toBe("Corrección autorizada");
    for (const invalid of [
      { reason: " " },
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: 2147483648 },
      { idempotencyKey: "bad" },
      { kind: "income" },
    ])
      expect(RegisterFinancialAdjustmentRequest.safeParse({ ...base, ...invalid }).success).toBe(
        false,
      );
  });
  it("SPEC 012 CA-1 acepta Transbank externo con operación y comentario", () => {
    expect(
      RegisterPaymentRequest.safeParse({
        membershipId: "11111111-1111-4111-8111-111111111111",
        amountCents: 30000,
        method: "transbank",
        reference: " OP-123 ",
        comment: " Terminal externo ",
      }),
    ).toMatchObject({
      success: true,
      data: { method: "transbank", reference: "OP-123", comment: "Terminal externo" },
    });
  });
  it("SPEC 012 CA-1 rechaza evidencia vacía o excesiva y métodos desconocidos", () => {
    const base = {
      membershipId: "11111111-1111-4111-8111-111111111111",
      amountCents: 30000,
      method: "transbank",
      reference: "OP-123",
      comment: "Terminal externo",
    };
    for (const invalid of [
      { reference: " " },
      { comment: " " },
      { reference: undefined },
      { comment: undefined },
      { reference: "x".repeat(201) },
      { comment: "x".repeat(1001) },
      { method: "card-api" },
    ]) {
      expect(RegisterPaymentRequest.safeParse({ ...base, ...invalid }).success).toBe(false);
    }
  });
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

  it("SPEC 020 CA-2 AttendanceReportQuery valida rango de fechas y límite de 93 días", () => {
    expect(
      AttendanceReportQuery.safeParse({ from: "2026-10-01", to: "2026-10-15" }).success,
    ).toBe(true);
    expect(
      AttendanceReportQuery.safeParse({ from: "2026-10-15", to: "2026-10-15" }).success,
    ).toBe(true);
    // from > to
    expect(
      AttendanceReportQuery.safeParse({ from: "2026-10-16", to: "2026-10-15" }).success,
    ).toBe(false);
    // > 93 days
    expect(
      AttendanceReportQuery.safeParse({ from: "2026-01-01", to: "2026-04-10" }).success,
    ).toBe(false);
    // invalid date formats or non-existent dates
    expect(
      AttendanceReportQuery.safeParse({ from: "invalido", to: "2026-10-15" }).success,
    ).toBe(false);
    expect(
      AttendanceReportQuery.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success,
    ).toBe(false);
  });
});
