import { isAuthenticated } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { embedQuestion } from "../_shared/embedding.ts";
import { readQuestion, RequestError } from "../_shared/question.ts";
import { retrieveTalks } from "./retrieval.ts";
import { answerFromTalks } from "./generation.ts";

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
      return json({ error: "Sign in to ask a question" }, 401);
    }
    const question = await readQuestion(request);
    const ready = Boolean(Deno.env.get("OPENAI_API_KEY"));
    if (question === null) return json({ ready });
    if (!ready) return json({ error: "Answer service is not configured" }, 503);
    const embedding = await embedQuestion(question);
    const talks = await retrieveTalks(request, embedding);
    return json(await answerFromTalks(question, talks));
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Answer service unavailable; try again shortly" },
      503,
    );
  }
}
