import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createCoreFonteMcpServer, MCP_HOSTED_TOOLS } from "./mcp-core-server.js";
import type { CoreRequester } from "./operator-core-request.js";
export { MCP_HOSTED_TOOLS };
export { createCoreRequester } from "./operator-core-request.js";

/** Authentication and CoreRequester are supplied by the owning Core API.
 * A new registry/transport for each request prevents identity and session mixing.
 * JSON responses complete before disposal; Core operation URIs provide polling. */
export async function handleCoreMcpRequest(
  request: Request, requester: CoreRequester, coreApiBaseUrl: string,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  const server = createCoreFonteMcpServer(requester, coreApiBaseUrl);
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // Consume the finite JSON response before closing its transport.
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, {
      status: response.status, statusText: response.statusText,
      headers: { ...Object.fromEntries(response.headers), "Cache-Control": "no-store" },
    });
  } finally {
    await server.close();
  }
}
