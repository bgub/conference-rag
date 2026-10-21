export async function isAuthenticated(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return false;

  // Validate with Supabase Auth rather than trusting a decoded JWT payload.
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      authorization,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const user = await response.json();
  return typeof user.id === "string" && user.role === "authenticated";
}
