// Admin-only, bounded backfill: keep the large vector transfer in the data center.
Deno.serve(async (request: Request) => {
  const key = request.headers.get("apikey");
  const serverKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  if (!key || !Object.values(serverKeys).includes(key)) {
    return Response.json({ error: "Admin key required" }, { status: 401 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "Provider not configured" }, { status: 503 });
  }
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const headers = { apikey: key, "Content-Type": "application/json" };
  try {
    const pending = await fetch(
      `${baseUrl}/rest/v1/sentence_embeddings?select=*&embedding=is.null&order=id&limit=400`,
      { headers, signal: AbortSignal.timeout(60_000) },
    );
    if (!pending.ok) {
      return Response.json({ error: "Database read failed" }, { status: 502 });
    }
    const rows = await pending.json();
    if (!rows.length) return Response.json({ embedded: 0 });

    const generated = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        dimensions: 1536,
        input: rows.map((row: { text: string }) => row.text),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!generated.ok) {
      return Response.json({
        error: "Provider failed",
        status: generated.status,
      }, { status: 502 });
    }
    const result = await generated.json();
    if (result.data?.length !== rows.length) {
      return Response.json({ error: "Incomplete embedding batch" }, {
        status: 502,
      });
    }
    const seen = new Set<number>();
    for (const item of result.data) {
      if (
        !Number.isInteger(item.index) || item.index < 0 ||
        item.index >= rows.length ||
        seen.has(item.index) || !Array.isArray(item.embedding) ||
        item.embedding.length !== 1536 ||
        !item.embedding.every((value: unknown) =>
          typeof value === "number" && Number.isFinite(value)
        )
      ) {
        return Response.json({ error: "Invalid embedding batch" }, {
          status: 502,
        });
      }
      seen.add(item.index);
      rows[item.index].embedding = item.embedding;
    }
    const saved = await fetch(
      `${baseUrl}/rest/v1/sentence_embeddings?on_conflict=id`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!saved.ok) {
      return Response.json({ error: "Database write failed" }, { status: 502 });
    }
    return Response.json({ embedded: rows.length });
  } catch {
    return Response.json({
      error: "Backfill request failed; retry pending rows",
    }, { status: 503 });
  }
});
