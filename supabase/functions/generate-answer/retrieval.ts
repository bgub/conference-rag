import { RequestError } from "../_shared/question.ts";

interface Match {
  talk_id: string;
  similarity: number;
}
interface Sentence {
  title: string;
  speaker: string;
  url: string;
  sentence_num: number;
  text: string;
}
export interface Talk {
  id: number;
  title: string;
  speaker: string;
  url: string;
  text: string;
}

// Forward the caller's JWT on every database request so Postgres enforces RLS.
export async function retrieveTalks(
  request: Request,
  embedding: number[],
): Promise<Talk[]> {
  const base = `${Deno.env.get("SUPABASE_URL")}/rest/v1`;
  const headers = {
    apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    authorization: request.headers.get("authorization") ?? "",
    "Content-Type": "application/json",
  };
  const matchesResponse = await fetch(`${base}/rpc/match_sentences`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query_embedding: embedding, match_count: 20 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!matchesResponse.ok) {
    throw new RequestError("Talk search unavailable", 503);
  }
  const matches: Match[] = await matchesResponse.json();
  const scores = new Map<string, number[]>();
  for (const match of matches) {
    if (
      !/^[0-9a-f-]{36}$/i.test(match.talk_id) ||
      !Number.isFinite(match.similarity)
    ) {
      throw new RequestError("Invalid search response", 502);
    }
    const group = scores.get(match.talk_id) ?? [];
    group.push(match.similarity);
    scores.set(match.talk_id, group);
  }
  const average = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const topIds = [...scores].sort((a, b) => average(b[1]) - average(a[1]))
    .slice(0, 3);
  return await Promise.all(topIds.map(async ([talkId], index) => {
    const rows: Sentence[] = [];
    // Page explicitly: PostgREST caps responses at 1,000 rows.
    for (let offset = 0;; offset += 1000) {
      const params = new URLSearchParams({
        select: "title,speaker,url,sentence_num,text",
        talk_id: `eq.${talkId}`,
        order: "sentence_num.asc",
        limit: "1000",
        offset: String(offset),
      });
      const response = await fetch(`${base}/sentence_embeddings?${params}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new RequestError("Could not load source talks", 503);
      }
      const page: Sentence[] = await response.json();
      rows.push(...page);
      if (rows.reduce((size, row) => size + row.text.length, 0) > 150_000) {
        throw new RequestError("Source talk exceeds the context limit", 503);
      }
      if (page.length < 1000) break;
    }
    if (!rows.length) {
      throw new RequestError("Source talk is no longer available", 503);
    }
    const url = new URL(rows[0].url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.churchofjesuschrist.org"
    ) {
      throw new RequestError("Invalid source URL", 502);
    }
    return {
      id: index + 1,
      title: rows[0].title,
      speaker: rows[0].speaker,
      url: url.href,
      text: rows.map((row) => row.text).join(" "),
    };
  }));
}
