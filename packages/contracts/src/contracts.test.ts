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
  CreateSupportGrantRequest,
  SupportGrantRef,
  SupportDiagnosticSummary,
  DeviceRevokeReason,
  RegisterDeviceRequest,
  RevokeDeviceRequest,
  DeviceDetail,
  MinorPolicyResponse,
  UpdateMinorPolicyRequest,
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
      guardianConsentRef: "ACTA-2026-0042",
      guardianConsentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    expect(MemberDetail.safeParse(detail).success).toBe(true);

    // SPEC025: Create/Update Member con guardianConsentRef
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor con acta",
        isMinor: true,
        adultResponsibleId: validUuid,
        guardianConsentRef: "ACTA-2026-0099",
      }).success,
    ).toBe(true);
    expect(
      UpdateMemberRequest.safeParse({
        guardianConsentRef: "ACTA-2026-MODIF",
      }).success,
    ).toBe(true);
    // guardianConsentRef vacío o mayor a 200 rechazado
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor invalido",
        isMinor: true,
        adultResponsibleId: validUuid,
        guardianConsentRef: "",
      }).success,
    ).toBe(false);
    expect(
      CreateMemberRequest.safeParse({
        fullName: "Menor invalido",
        isMinor: true,
        adultResponsibleId: validUuid,
        guardianConsentRef: "A".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("SPEC025 CA-1 MinorPolicyResponse y UpdateMinorPolicyRequest validan contratos de política de menores", () => {
    expect(
      MinorPolicyResponse.safeParse({
        enabled: true,
        orgEnabled: true,
        serverLocked: false,
      }).success,
    ).toBe(true);
    expect(
      MinorPolicyResponse.safeParse({
        enabled: false,
        orgEnabled: true,
        serverLocked: true,
      }).success,
    ).toBe(true);
    expect(MinorPolicyResponse.safeParse({ enabled: "true" }).success).toBe(false);

    expect(UpdateMinorPolicyRequest.safeParse({ enabled: true }).success).toBe(true);
    expect(UpdateMinorPolicyRequest.safeParse({ enabled: false }).success).toBe(true);
    expect(UpdateMinorPolicyRequest.safeParse({}).success).toBe(false);
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

  it("SPEC 026 CA-1: CreateSupportGrantRequest valida email, reason (5..500) y durationMinutes (15..1440)", () => {
    const valid = {
      supportEmail: "soporte@gym.cl",
      reason: "Revisión de sincronización offline",
      durationMinutes: 60,
    };
    expect(CreateSupportGrantRequest.safeParse(valid).success).toBe(true);

    // Default scope is diagnostic
    const parsed = CreateSupportGrantRequest.parse(valid);
    expect(parsed.scope).toBe("diagnostic");

    // Explicit read_only scope
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, scope: "read_only" }).success,
    ).toBe(true);

    // Invalid scope
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, scope: "admin_write" }).success,
    ).toBe(false);

    // Invalid email
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, supportEmail: "not-an-email" }).success,
    ).toBe(false);

    // Reason too short (< 5) or too long (> 500)
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, reason: "1234" }).success,
    ).toBe(false);
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, reason: "a".repeat(501) }).success,
    ).toBe(false);

    // durationMinutes < 15 or > 1440
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, durationMinutes: 14 }).success,
    ).toBe(false);
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, durationMinutes: 1441 }).success,
    ).toBe(false);
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, durationMinutes: 15 }).success,
    ).toBe(true);
    expect(
      CreateSupportGrantRequest.safeParse({ ...valid, durationMinutes: 1440 }).success,
    ).toBe(true);

    const grantRefSample = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      grantedByAccountId: "admin-1",
      supportEmail: "soporte@gym.cl",
      reason: "Revisión técnica autorizada",
      scope: "diagnostic" as const,
      tokenHash: "abc123hash",
      expiresAt: new Date().toISOString(),
      revokedAt: null,
      revokedByAccountId: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(SupportGrantRef.safeParse(grantRefSample).success).toBe(true);
  });

  it("SPEC 026 CA-2: SupportDiagnosticSummary valida estructura agregada y prohíbe datos sensibles", () => {
    const validSummary = {
      organization: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Gym Central",
      },
      counts: {
        members: 120,
        activePlans: 3,
        memberships: 110,
        outboxEvents: 0,
      },
      cashSession: {
        id: "22222222-2222-4222-8222-222222222222",
        state: "open",
        openedAt: new Date().toISOString(),
      },
      offlinePolicy: {
        enabled: true,
        freshnessHours: 72,
      },
      timestamp: new Date().toISOString(),
      grant: {
        id: "33333333-3333-4333-8333-333333333333",
        supportEmail: "soporte@gym.cl",
        scope: "diagnostic" as const,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    };
    expect(SupportDiagnosticSummary.safeParse(validSummary).success).toBe(true);
  });

  it("SPEC024 contratos de dispositivos: custodia, revocación estructurada y detalle", () => {
    // RegisterDeviceRequest
    expect(
      RegisterDeviceRequest.safeParse({
        accountId: "acc-1",
        label: "Tablet Mostrador",
      }).success,
    ).toBe(true);

    expect(
      RegisterDeviceRequest.safeParse({
        accountId: "acc-1",
        label: "Tablet Mostrador",
        custodyReference: "ACTA-EQ-01",
      }).success,
    ).toBe(true);

    // custodyReference vacío no pasa min(1) tras trim
    expect(
      RegisterDeviceRequest.safeParse({
        accountId: "acc-1",
        label: "Tablet Mostrador",
        custodyReference: "   ",
      }).success,
    ).toBe(false);

    // custodyReference > 200 chars
    expect(
      RegisterDeviceRequest.safeParse({
        accountId: "acc-1",
        label: "Tablet Mostrador",
        custodyReference: "x".repeat(201),
      }).success,
    ).toBe(false);

    // RevokeDeviceRequest retrocompatible
    const emptyRevoke = RevokeDeviceRequest.parse({});
    expect(emptyRevoke.reason).toBe("otro");

    const undefinedRevoke = RevokeDeviceRequest.parse(undefined);
    expect(undefinedRevoke.reason).toBe("otro");

    const structuredRevoke = RevokeDeviceRequest.parse({
      reason: "perdida_robo",
      notes: "Extraviado en recepción",
    });
    expect(structuredRevoke.reason).toBe("perdida_robo");
    expect(structuredRevoke.notes).toBe("Extraviado en recepción");

    expect(DeviceRevokeReason.safeParse("rotacion").success).toBe(true);
    expect(DeviceRevokeReason.safeParse("perdida_robo").success).toBe(true);
    expect(DeviceRevokeReason.safeParse("baja_operador").success).toBe(true);
    expect(DeviceRevokeReason.safeParse("otro").success).toBe(true);
    expect(DeviceRevokeReason.safeParse("invalido").success).toBe(false);

    // Invalid reason
    expect(
      RevokeDeviceRequest.safeParse({
        reason: "invalido",
      }).success,
    ).toBe(false);

    // notes > 500 chars
    expect(
      RevokeDeviceRequest.safeParse({
        reason: "rotacion",
        notes: "y".repeat(501),
      }).success,
    ).toBe(false);

    // DeviceDetail schema
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      accountId: "acc-1",
      label: "Tablet Mostrador",
      state: "habilitado" as const,
      custodyReference: "ACTA-EQ-01",
      custodyConfirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    expect(DeviceDetail.safeParse(detail).success).toBe(true);
  });
});

