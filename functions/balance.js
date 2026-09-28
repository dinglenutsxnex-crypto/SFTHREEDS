export async function onRequestGet() {
  return Response.json({
    version: {
      cur: "0.1.3.0.835-prod",
      url: "https://sfthreeds.adiforgottenme.workers.dev/cdn/config.zip",
    },
    load: { "127.0.0.1:9933": 0 },
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}
