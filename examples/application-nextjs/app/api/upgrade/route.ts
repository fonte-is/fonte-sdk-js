import { applicationJourney } from "../../../server/runtime";

export const runtime = "nodejs";

export async function POST() {
  const result = await applicationJourney.upgradeToPro();
  return Response.json(result);
}
