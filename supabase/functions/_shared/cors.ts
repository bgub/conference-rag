const allowedOrigins = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://bgub.github.io",
]);

export function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}
