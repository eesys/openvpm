import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Consistent error envelope for the public REST API: `{ error: { message } }`. */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: { message } }, { status });
}

export function notFound(resource = "Resource"): NextResponse {
  return apiError(`${resource} not found`, 404);
}

/** Turn a ZodError into a 400 with field-level detail. */
export function validationError(err: ZodError): NextResponse {
  return NextResponse.json(
    {
      error: {
        message: "Validation failed",
        fields: err.flatten().fieldErrors,
      },
    },
    { status: 400 },
  );
}

/** Wrap a handler body so uncaught errors become a 500 instead of leaking. */
export async function withErrorHandling(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    console.error("[api/v1] unhandled error:", error);
    return apiError("Internal server error", 500);
  }
}
