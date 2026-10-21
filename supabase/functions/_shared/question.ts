export class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function readQuestion(request: Request): Promise<string | null> {
  // Bound the request before parsing it or sending it to a paid API.
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("A question is required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new RequestError("Request is too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError("Invalid JSON", 400);
  }
  if (body?.health === true) return null;
  const question = body?.question;
  if (
    typeof question !== "string" || !question.trim() ||
    question.length > 4_000
  ) {
    throw new RequestError("Question must contain 1–4,000 characters", 400);
  }

  return question.trim();
}
