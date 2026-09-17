import { collect } from "@fonte-is/nextjs/server";

export async function POST(request: Request) {
  const body = await collect.parse(request);
  const scope = body
    ? collect.acceptScope(body.scope, {
        siteUrl: process.env.FONTE_SITE_URL,
        requestOrigin: request.headers.get("origin"),
        userAgent: request.headers.get("user-agent"),
      })
    : null;
  const accepted = Boolean(body && scope);
  return Response.json(
    {
      disposition: accepted ? "unavailable" : "rejected",
      reason: "parser_fixture_has_no_durable_custody",
      eventType: body?.eventType ?? null,
    },
    { status: accepted ? 202 : 400 },
  );
}
