import { embedQuestion } from "../_shared/embedding.ts";
import { readQuestion, RequestError } from "../_shared/question.ts";
import { isAuthenticated } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

export async function handleRequest(request: Request): Promise<Response> {
  const headers = corsHeaders(request);
  headers.set("Cache-Control", "no-store");
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!await isAuthenticated(request)) {
      return json({ error: "Sign in to search" }, 401);
    }

    const question = await readQuestion(request);
    if (question === null) {
      return json({ ready: Boolean(Deno.env.get("OPENAI_API_KEY")) });
    }
    const embedding = await embedQuestion(question);
    return json({ embedding });
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Search service unavailable; try again shortly" },
      503,
    );
  }
}
