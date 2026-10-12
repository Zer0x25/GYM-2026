import { z } from "zod";
import { ErrorCode, ErrorResponse } from "@gym/contracts";

/** Application error carrying a stable code. */
export class AppError extends Error {
  constructor(
    public readonly code: (typeof ErrorCode)["options"][number],
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const validationError = (details?: Record<string, unknown>) =>
  new AppError("VALIDATION_ERROR", "Request validation failed", details);
export const unauthenticated = (message = "Authentication required") =>
  new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "Not authorized for this resource") =>
  new AppError("FORBIDDEN", message);
export const notFound = (message = "Resource not found") =>
  new AppError("NOT_FOUND", message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("CONFLICT", message, details);
export const internalError = (message = "Internal error") =>
  new AppError("INTERNAL_ERROR", message);

/** Serializes any thrown value into the stable ErrorResponse shape. */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { error: { code: err.code, message: err.message, details: err.details } };
  }
  if (err instanceof z.ZodError) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) },
      },
    };
  }
  return { error: { code: "INTERNAL_ERROR", message: "Internal error" } };
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return ErrorResponse.safeParse(value).success;
}
