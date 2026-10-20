import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { apiError } from "@/lib/api/route";
import { AppError } from "@/lib/errors";

/** Runs a handler and converts thrown {@link AppError}s into the API envelope. */
export function guarded<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiError(error);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION", "Send a JSON body.", 400);
  }
}

export function fieldErrors(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return new AppError("VALIDATION", "Check the highlighted fields.", 400, fields);
}
