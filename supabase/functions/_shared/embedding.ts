import { RequestError } from "./question.ts";

export async function embedQuestion(question: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new RequestError("Embedding service is not configured", 503);
  }
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: question,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Do not return upstream error bodies or credentials to the browser.
    console.error("Embedding provider returned status", response.status);
    throw new RequestError(
      "Embedding service unavailable; try again shortly",
      response.status === 429 ? 429 : 502,
    );
  }
  const result = await response.json();
  const embedding = result.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) || embedding.length !== 1536 ||
    !embedding.every((value: unknown) =>
      typeof value === "number" && Number.isFinite(value)
    )
  ) {
    throw new RequestError("Invalid embedding response", 502);
  }
  return embedding;
}
