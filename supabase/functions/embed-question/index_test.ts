import { strict as assert } from "node:assert";
import { handleRequest } from "./handler.ts";

Deno.test("embed-question authentication, validation, and provider boundaries", async (t) => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "test-public-key");
  Deno.env.set("OPENAI_API_KEY", "test-provider-key");
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let validUser = true;
  let providerStatus = 200;
  let dimensions = 1536;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-session",
      );
      return Promise.resolve(Response.json(
        validUser ? { id: "test-user", role: "authenticated" } : {},
        { status: validUser ? 200 : 401 },
      ));
    }
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-provider-key",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: "How can I find peace?",
    });
    return Promise.resolve(Response.json(
      { data: [{ embedding: Array(dimensions).fill(0.1) }] },
      { status: providerStatus },
    ));
  };
  const request = (body: string, authenticated = true) =>
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "http://localhost:5500",
        ...(authenticated ? { authorization: "Bearer test-session" } : {}),
      },
      body,
    });
  const question = JSON.stringify({ question: " How can I find peace? " });
  try {
    await t.step("preflight does not call auth or the provider", async () => {
      const response = await handleRequest(
        new Request("https://example.test", { method: "OPTIONS" }),
      );
      assert.equal(response.status, 204);
      assert.equal(calls.length, 0);
    });
    await t.step(
      "missing and invalid sessions never call the paid provider",
      async () => {
        assert.equal(
          (await handleRequest(request(question, false))).status,
          401,
        );
        assert.equal(calls.length, 0);
        validUser = false;
        assert.equal((await handleRequest(request(question))).status, 401);
        assert.equal(calls.length, 1);
        validUser = true;
      },
    );
    await t.step(
      "rejects malformed, empty, and oversized input before embedding",
      async () => {
        calls.length = 0;
        for (
          const body of ["{", "null", '{"question":" "}', '{"question":42}']
        ) {
          assert.equal((await handleRequest(request(body))).status, 400);
        }
        assert.equal(
          (await handleRequest(request("x".repeat(20_000)))).status,
          413,
        );
        assert.ok(calls.every((url) => url.endsWith("/auth/v1/user")));
      },
    );
    await t.step(
      "valid session returns a finite 1536-dimensional vector and CORS headers",
      async () => {
        const response = await handleRequest(request(question));
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("access-control-allow-origin"),
          "http://localhost:5500",
        );
        assert.equal((await response.json()).embedding.length, 1536);
      },
    );
    await t.step(
      "wrong model dimensions and provider throttling are surfaced safely",
      async () => {
        dimensions = 384;
        assert.equal((await handleRequest(request(question))).status, 502);
        providerStatus = 429;
        assert.equal((await handleRequest(request(question))).status, 429);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (
      const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENAI_API_KEY"]
    ) Deno.env.delete(name);
  }
});
