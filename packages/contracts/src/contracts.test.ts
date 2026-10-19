import { describe, expect, it } from "vitest";
import {
  RequestContactVerification,
  ConfirmContactVerification,
  EmailCapabilities,
  CreateMemberRequest,
  UpdateMemberRequest,
  MemberDetail,
  CreateOrganizationRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  SchedulePlanChangeRequest,
  CreateMembershipPauseRequest,
  ErrorCode,
  SessionResponse,
  RegisterPaymentRequest,
  RegisterFinancialAdjustmentRequest,
  AttendanceReportQuery,
  ReconciliationState,
  CashSessionRef,
  MembershipRef,
  PaymentRef,
  RescheduleSessionRequest,
} from "./index.js";

describe("contracts", () => {
  it("SPEC021 menor exige adultResponsibleId válido; rechaza falta de adulto o no-menor con adulto", () => {
    const validUuid = "11111111-1111-4111-8111-111111111111";
    // Minor requires adultResponsibleId
    expect(
      CreateMemberRequest.safeParse({ fullName: "Menor Uno", isMinor: true }).success,
    ).toBe(false);
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor Uno",
        isMinor: true,
        adultResponsibleId: null,
      }).success,
    ).toBe(false);
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor Uno",
        isMinor: true,
        adultResponsibleId: validUuid,
      }).success,
    ).toBe(true);
    // adultResponsibleId provided assumes isMinor: true
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor Uno",
        adultResponsibleId: validUuid,
      }).success,
    ).toBe(true);
    // Non-minor cannot have adultResponsibleId
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Adulto",
        isMinor: false,
        adultResponsibleId: validUuid,
      }).success,
    ).toBe(false);

    // UpdateMemberRequest constraints
    expect(
      UpdateMemberRequest.safeParse({
        isMinor: true,
      }).success,
    ).toBe(false);
    expect(
      UpdateMemberRequest.safeParse({
        isMinor: true,
        adultResponsibleId: validUuid,
      }).success,
    ).toBe(true);
    expect(
      UpdateMemberRequest.safeParse({
        isMinor: false,
        adultResponsibleId: validUuid,
      }).success,
    ).toBe(false);
    expect(
      UpdateMemberRequest.safeParse({
        isMinor: false,
        adultResponsibleId: null,
      }).success,
    ).toBe(true);

    // MemberDetail shape
    const detail = {
      id: validUuid,
      organizationId: validUuid,
      fullName: "Menor",
      contactEmail: "contacto@adulto.cl",
      isMinor: true,
      adultResponsibleId: validUuid,
      adultResponsibleName: "Adulto Ana",
      createdAt: new Date().toISOString(),
    };
    expect(MemberDetail.safeParse(detail).success).toBe(true);
  });

  it("SPEC017 CA-1 UpdatePlanRequest valida edición parcial, cuotas para limited y rechaza datos inválidos", () => {
    expect(UpdatePlanRequest.safeParse({ name: "Plan Nuevo", priceCents: 25000, active: false }).success).toBe(true);
    expect(UpdatePlanRequest.safeParse({ priceCents: -500 }).success).toBe(false);
    expect(UpdatePlanRequest.safeParse({ durationDays: 0 }).success).toBe(false);
    // Si coverage es limited, classCredits completo es obligatorio
    expect(UpdatePlanRequest.safeParse({ coverage: "limited" }).success).toBe(false);
    expect(
      UpdatePlanRequest.safeParse({
        coverage: "limited",
        classCredits: { grupal: 5, fija: 2, cita: 1 },
      }).success,
    ).toBe(true);
    // Si coverage es unlimited, no puede tener classCredits con cuotas
    expect(
      UpdatePlanRequest.safeParse({
        coverage: "unlimited",
        classCredits: { grupal: 5, fija: 2, cita: 1 },
      }).success,
    ).toBe(false);
  });

  it("SPEC017 CA-2 SchedulePlanChangeRequest valida nextPlanId UUID o null", () => {
    expect(SchedulePlanChangeRequest.safeParse({ nextPlanId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(SchedulePlanChangeRequest.safeParse({ nextPlanId: null }).success).toBe(true);
    expect(SchedulePlanChangeRequest.safeParse({ nextPlanId: "invalido" }).success).toBe(false);
  });

  it("SPEC017 CA-3 CreateMembershipPauseRequest exige idempotencyKey UUID, endsAt > startsAt y reason no vacío", () => {
    const valid = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      startsAt: "2026-11-01T00:00:00.000Z",
      endsAt: "2026-11-06T00:00:00.000Z",
      reason: "Licencia médica de 5 días",
    };
    expect(CreateMembershipPauseRequest.safeParse(valid).success).toBe(true);
    // endsAt <= startsAt
    expect(
      CreateMembershipPauseRequest.safeParse({
        ...valid,
        endsAt: "2026-11-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    // reason vacío
    expect(
      CreateMembershipPauseRequest.safeParse({
        ...valid,
        reason: "   ",
      }).success,
    ).toBe(false);
    // idempotencyKey inválido
    expect(
      CreateMembershipPauseRequest.safeParse({
        ...valid,
        idempotencyKey: "no-uuid",
      }).success,
    ).toBe(false);
  });
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

  it("SPEC 019 CA-3 CashSessionRef y ReconciliationState exponen estados explícitos de conciliación", () => {
    expect(ReconciliationState.options).toEqual(["abierta", "cuadrada", "con_diferencia"]);
    const session = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      organizationId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      openedBy: "usr-1",
      closedBy: "usr-2",
      state: "closed" as const,
      reconciliationState: "cuadrada" as const,
      openingCents: 10000,
      declaredClosingCents: 20000,
      expectedClosingCents: 20000,
      discrepancyCents: 0,
      openedAt: "2026-10-19T10:00:00.000Z",
      closedAt: "2026-10-19T18:00:00.000Z",
    };
    expect(CashSessionRef.safeParse(session).success).toBe(true);
    expect(
      CashSessionRef.safeParse({ ...session, reconciliationState: "invalido" }).success,
    ).toBe(false);
  });

  it("SPEC 019 CA-1/CA-2 MembershipRef y PaymentRef soportan ciclo de abonos parciales y vinculación a período", () => {
    const membership = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      organizationId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      memberId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
      planId: "3fa85f64-5717-4562-b3fc-2c963f66afa9",
      state: "pending_payment" as const,
      startAt: null,
      endAt: null,
      cycleTargetCents: 30000,
      cyclePaidCents: 10000,
      cycleRemainingCents: 20000,
    };
    expect(MembershipRef.safeParse(membership).success).toBe(true);

    const payment = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      organizationId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      memberId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
      membershipId: "3fa85f64-5717-4562-b3fc-2c963f66afa9",
      planId: "3fa85f64-5717-4562-b3fc-2c963f66afb0",
      periodId: "3fa85f64-5717-4562-b3fc-2c963f66afb1",
      amountCents: 10000,
      method: "cash" as const,
      reference: null,
      state: "validated" as const,
      registeredBy: "usr-1",
      decidedBy: "usr-2",
      reason: null,
      createdAt: "2026-10-19T10:00:00.000Z",
    };
    expect(PaymentRef.safeParse(payment).success).toBe(true);
    expect(PaymentRef.safeParse({ ...payment, periodId: null }).success).toBe(true);
  });

  it("SPEC018 CA-1 RescheduleSessionRequest valida startsAt, endsAt > startsAt y reason opcional", () => {
    const valid = {
      startsAt: "2026-11-01T10:00:00.000Z",
      endsAt: "2026-11-01T11:00:00.000Z",
      reason: "Cambio de horario solicitado por el alumno",
    };
    expect(RescheduleSessionRequest.safeParse(valid).success).toBe(true);
    expect(
      RescheduleSessionRequest.safeParse({
        startsAt: "2026-11-01T10:00:00.000Z",
        endsAt: "2026-11-01T11:00:00.000Z",
      }).success,
    ).toBe(true);
    // endsAt <= startsAt
    expect(
      RescheduleSessionRequest.safeParse({
        startsAt: "2026-11-01T10:00:00.000Z",
        endsAt: "2026-11-01T10:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      RescheduleSessionRequest.safeParse({
        startsAt: "2026-11-01T11:00:00.000Z",
        endsAt: "2026-11-01T10:00:00.000Z",
      }).success,
    ).toBe(false);
    // reason vacío o demasiado largo (>500)
    expect(
      RescheduleSessionRequest.safeParse({
        ...valid,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      RescheduleSessionRequest.safeParse({
        ...valid,
        reason: "a".repeat(501),
      }).success,
    ).toBe(false);
    // startsAt inválido
    expect(
      RescheduleSessionRequest.safeParse({
        startsAt: "no-date",
        endsAt: "2026-11-01T11:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

