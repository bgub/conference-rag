import { strict as assert } from "node:assert";
import { handleRequest } from "./handler.ts";

Deno.test("generate-answer retrieval, RLS, and grounding boundaries", async (t) => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "public-key");
  Deno.env.set("OPENAI_API_KEY", "provider-key");
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";
  let validUser = true;
  let empty = false;
  let dbFailure = false;
  let providerStatus = 200;
  let resultStatus = "completed";
  let answer = {
    answer: "Prayer can help us find peace. [1]",
    cited_source_ids: [1],
    insufficient_evidence: false,
  };
  globalThis.fetch = (input, init) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    if (url.includes("example.supabase.co")) {
      assert.equal(headers.get("authorization"), "Bearer user-session");
      assert.equal(headers.get("apikey"), "public-key");
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(
        Response.json(validUser ? { id: "user", role: "authenticated" } : {}, {
          status: validUser ? 200 : 401,
        }),
      );
    }
    if (url.endsWith("/embeddings")) {
      return Promise.resolve(
        Response.json({ data: [{ embedding: Array(1536).fill(0.1) }] }),
      );
    }
    if (url.endsWith("/rpc/match_sentences")) {
      assert.equal(JSON.parse(String(init?.body)).match_count, 20);
      return Promise.resolve(
        Response.json(
          empty ? [] : [{ talk_id: second, similarity: 0.5 }, {
            talk_id: first,
            similarity: 0.8,
          }, { talk_id: first, similarity: 0.6 }],
          { status: dbFailure ? 500 : 200 },
        ),
      );
    }
    if (url.includes("/sentence_embeddings?")) {
      assert.ok(url.includes("order=sentence_num.asc"));
      const id = new URL(url).searchParams.get("talk_id");
      return Promise.resolve(Response.json([{
        title: id === `eq.${first}` ? "Peace" : "Faith",
        speaker: "A speaker",
        url:
          "https://www.churchofjesuschrist.org/study/general-conference/2020/04/peace",
        sentence_num: 0,
        text: "Prayer helps us find peace.",
      }]));
    }
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(headers.get("authorization"), "Bearer provider-key");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.store, false);
    assert.equal(payload.text.format.strict, true);
    const context = JSON.parse(payload.input);
    assert.equal(context.sources[0].title, "Peace");
    assert.equal(context.sources[0].text, "Prayer helps us find peace.");
    assert.ok(!payload.input.includes("FAKE CLIENT CONTEXT"));
    return Promise.resolve(
      Response.json({
        status: resultStatus,
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(answer) }],
        }],
      }, { status: providerStatus }),
    );
  };
  const request = (body: unknown, auth = true) =>
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "http://localhost:5500",
        ...(auth ? { authorization: "Bearer user-session" } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const question = {
    question: "How can I find peace?",
    context_talks: [{ text: "FAKE CLIENT CONTEXT" }],
  };
  try {
    await t.step(
      "preflight and unauthenticated requests never call providers",
      async () => {
        assert.equal(
          (await handleRequest(
            new Request("https://example.test", { method: "OPTIONS" }),
          )).status,
          204,
        );
        assert.equal(
          (await handleRequest(request(question, false))).status,
          401,
        );
        assert.equal(calls.length, 0);
        validUser = false;
        assert.equal((await handleRequest(request(question))).status, 401);
        validUser = true;
      },
    );
    await t.step(
      "health and invalid questions make no paid calls",
      async () => {
        calls.length = 0;
        assert.deepEqual(
          await (await handleRequest(request({ health: true }))).json(),
          { ready: true },
        );
        for (
          const body of ["{", "null", { question: " " }, {
            question: "x".repeat(4001),
          }]
        ) assert.equal((await handleRequest(request(body))).status, 400);
        assert.equal(
          (await handleRequest(request("x".repeat(20000)))).status,
          413,
        );
        assert.ok(calls.every((url) => url.endsWith("/auth/v1/user")));
      },
    );
    await t.step(
      "server retrieves ordered talks under caller RLS and returns only cited metadata",
      async () => {
        const response = await handleRequest(request(question));
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("access-control-allow-origin"),
          "http://localhost:5500",
        );
        const result = await response.json();
        assert.equal(result.sources.length, 1);
        assert.equal(result.sources[0].title, "Peace");
        assert.equal(result.sources[0].id, 1);
        assert.ok(!("text" in result.sources[0]));
      },
    );
    await t.step(
      "no matches skip generation; unsupported questions return no citations",
      async () => {
        empty = true;
        calls.length = 0;
        const result = await (await handleRequest(request(question))).json();
        assert.equal(result.insufficient_evidence, true);
        assert.ok(!calls.some((url) => url.endsWith("/responses")));
        empty = false;
        answer = {
          answer: "The supplied talks do not cover this topic.",
          // Regression: model abstains but lists candidates without inline citations.
          cited_source_ids: [1, 2],
          insufficient_evidence: true,
        };
        assert.deepEqual(
          (await (await handleRequest(request(question))).json()).sources,
          [],
        );
      },
    );
    await t.step(
      "invented or missing citations, truncated output, database errors and throttling fail safely",
      async () => {
        for (
          const invalid of [
            {
              answer: "Claim [99]",
              cited_source_ids: [99],
              insufficient_evidence: false,
            },
            {
              answer: "Claim [2]",
              cited_source_ids: [1],
              insufficient_evidence: false,
            },
            {
              answer: "Uncited claim",
              cited_source_ids: [],
              insufficient_evidence: false,
            },
          ]
        ) {
          answer = invalid;
          assert.equal((await handleRequest(request(question))).status, 502);
        }
        resultStatus = "incomplete";
        assert.equal((await handleRequest(request(question))).status, 502);
        resultStatus = "completed";
        providerStatus = 429;
        assert.equal((await handleRequest(request(question))).status, 429);
        dbFailure = true;
        calls.length = 0;
        assert.equal((await handleRequest(request(question))).status, 503);
        assert.ok(!calls.some((url) => url.endsWith("/responses")));
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENAI_API_KEY"]) {
      Deno.env.delete(key);
    }
  }
});
