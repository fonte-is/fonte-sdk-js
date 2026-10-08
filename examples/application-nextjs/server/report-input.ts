import "server-only";
import type { ReportInput } from "../ports.js";

/** Report content goes only to the existing business store, never to Fonte. */
export function reportInput(title: unknown, body: unknown): ReportInput {
  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.length > 80 ||
    typeof body !== "string" ||
    body.length > 5_000
  )
    throw new Error("report_input_invalid");
  return { title, body };
}
