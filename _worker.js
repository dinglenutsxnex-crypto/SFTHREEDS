export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // 1. Balancer — exact shape NetworkBalancerManager + BalancerSettings expects:
    // {"version":{"cur":"<full>-<serverName>","url":"<config.zip url>"},"load":{"ip:port":float}}
    if (url.pathname === "/balance") {
      const body = {
        version: {
          cur: "0.1.3.0.835-prod",
          url: `${url.origin}/cdn/config.zip`,
        },
        // BalancerItem.cs splits key on ':' -> ip + port. Points at local SFS mock for now.
        // Change to your TCP host once you run one (Workers can't listen on TCP).
        load: { "127.0.0.1:9933": 0 },
      };
      return Response.json(body, { headers: cors });
    }

    // 2. Config zip placeholder — only hit if balancer cur version > local archive.bytes version.
    // Real client (NetworkConfigsDownloader) expects a ZIP containing version.json/server.json/config.json.
    if (url.pathname === "/cdn/config.zip") {
      return Response.json(
        { error: "config.zip not implemented yet — keep balancer cur == 0.1.3.0.835-prod to skip this step" },
        { status: 501, headers: cors }
      );
    }

    // 3. Debug: echo what client asked for (check Cloudflare logs)
    if (url.pathname === "/debug") {
      return Response.json({ path: url.pathname, now: new Date().toISOString() }, { headers: cors });
    }

    // 4. Root status (replaces old index.html "test")
    if (url.pathname === "/") {
      return new Response("sf3 worker alive. GET /balance for balancer JSON.", { headers: cors });
    }

    return Response.json({ error: "not found", path: url.pathname }, { status: 404, headers: cors });
  },
};
