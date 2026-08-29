# `@fonte-is/nextjs`

Next.js App Router integration over `@fonte-is/core` and `@fonte-is/react`.

```sh
npm install @fonte-is/core @fonte-is/react @fonte-is/nextjs next react react-dom
```

```ts
// app/api/fonte/collect/route.ts
import { createClient } from "@fonte-is/core/server";
import { collect } from "@fonte-is/nextjs/server";

const fonte = createClient({ tenantApiKey: process.env.FONTE_TENANT_API_KEY! });

export async function POST(request: Request) {
  const body = await collect.parse(request);
  const scope =
    body &&
    collect.acceptScope(body.scope, {
      siteUrl: process.env.FONTE_SITE_URL,
      requestOrigin: request.headers.get("origin"),
      userAgent: request.headers.get("user-agent"),
    });
  if (!body || !scope) return new Response(null, { status: 400 });

  const result = await fonte.touch(
    collect.toTouchInput(body, scope, "next_app_router"),
  );
  return Response.json(result);
}
```

Set `FONTE_SITE_URL` to the canonical public origin, such as
`https://shop.example.test`; do not derive it from the incoming `Origin`
header. The response is an ingestion result, not an attribution or
economic-finality decision. Control Plane remains evidence-acceptance and
attribution authority. Obtain the non-secret browser posture with
`fonte.collectionPosture()` on the server; do not expose the tenant API key or
invent a visitor choice in this adapter.
