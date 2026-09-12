import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export async function createProvider() {
  const issuer = "https://identity.example.test/auth/v1";
  const codes = new Map();
  const access = new Set();
  const tokens = new Set();
  const errors = [];
  const consumerArguments = [];
  const counts = { browser: 0, refresh: 0, consumer: 0, rejectedRefresh: 0 };
  let refreshToken;
  let modelCredential = null;
  const secret = () => {
    const value = randomBytes(32).toString("base64url");
    tokens.add(value);
    return value;
  };
  const grant = () => {
    const accessToken = secret();
    access.add(accessToken);
    refreshToken = secret();
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 60,
      scope: "email",
    };
  };
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      errors.push("synthetic_provider_request_failed");
      if (!response.headersSent) json(response, { error: "server_error" }, 500);
      else response.end();
    });
  });
  const handle = async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (discovery(url, response, issuer)) return;
    if (url.pathname === "/auth/v1/authorize") {
      return authorize(url, response, { counts, secret, codes });
    }
    if (url.pathname === "/auth/v1/token") {
      return token(request, response);
    }
    if (url.pathname === "/auth/v1/userinfo") {
      if (
        !access.has(request.headers.authorization?.replace(/^Bearer /i, ""))
      ) {
        return json(response, { error: "invalid_token" }, 401);
      }
      return json(response, {
        sub: "synthetic-operator",
        email: "operator@example.test",
      });
    }
    if (url.pathname === "/consumer") {
      if (
        !access.has(request.headers.authorization?.replace(/^Bearer /i, ""))
      ) {
        return json(response, { error: "invalid_token" }, 401);
      }
      consumerArguments.push(JSON.parse(await body(request)));
      counts.consumer++;
      return json(response, { ok: true });
    }
    if (url.pathname === "/model-store") {
      if (request.method === "PUT") modelCredential = await body(request);
      if (request.method === "DELETE") modelCredential = null;
      return json(response, { value: modelCredential });
    }
    return json(response, { error: "unexpected_path" }, 404);
  };
  const token = async (request, response) => {
    const params = new URLSearchParams(await body(request));
    if (params.get("client_id") !== "synthetic-client")
      throw new Error("invalid_client");
    if (params.get("grant_type") === "authorization_code") {
      const code = params.get("code");
      const expected = codes.get(code);
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      codes.delete(code);
      if (!expected || expected !== challenge)
        return json(response, { error: "invalid_grant" }, 400);
      return json(response, grant());
    }
    if (
      params.get("grant_type") === "refresh_token" &&
      params.get("refresh_token") === refreshToken
    ) {
      refreshToken = undefined;
      counts.refresh++;
      // Widen races: a correct process lock must cover rotation and storage.
      await new Promise((resolve) => setTimeout(resolve, 75));
      return json(response, grant());
    }
    counts.rejectedRefresh++;
    return json(response, { error: "invalid_grant" }, 400);
  };
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    counts,
    errors,
    tokens,
    consumerArguments,
    hasModelCredential: () => modelCredential !== null,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function authorize(url, response, { counts, secret, codes }) {
  const params = url.searchParams;
  if (
    params.get("client_id") !== "synthetic-client" ||
    params.get("scope") !== "email" ||
    params.get("redirect_uri") !== "http://127.0.0.1:49671/callback" ||
    params.get("code_challenge_method") !== "S256" ||
    !params.get("state")
  ) {
    throw new Error("invalid_authorization_request");
  }
  counts.browser++;
  const code = secret();
  codes.set(code, params.get("code_challenge"));
  const callback = new URL(params.get("redirect_uri"));
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", params.get("state"));
  response.writeHead(302, { location: callback.href });
  response.end();
}

function discovery(url, response, issuer) {
  if (url.pathname === "/.well-known/fonte-cli.json") {
    json(response, {
      schema: "fonte.cli.hosted_config.v1",
      authorizationServer: issuer,
      clientId: "synthetic-client",
      coreApiBaseUrl: "https://api.example.test",
      redirectUri: "http://127.0.0.1:49671/callback",
      scopes: ["email"],
    });
    return true;
  }
  if (url.pathname.includes(".well-known/oauth-authorization-server")) {
    json(response, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
    return true;
  }
  return false;
}

function json(response, value, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
