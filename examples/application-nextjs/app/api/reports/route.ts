import { reportInput } from "../../../server/report-input";
import { applicationJourney } from "../../../server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input: unknown = await request.json();
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return Response.json({ error: "report_input_invalid" }, { status: 400 });
  const { title, body } = input as Record<string, unknown>;
  const result = await applicationJourney.saveReport(reportInput(title, body));
  return Response.json(result);
}
