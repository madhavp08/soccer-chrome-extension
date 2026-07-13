const AF_BASE = "https://v3.football.api-sports.io";
const UPSTREAM_TIMEOUT_MS = 12000;

// World Cup, Premier League, La Liga, Bundesliga, Serie A, Ligue 1,
// Champions League, European Championship, Copa America
const LIVE_LEAGUES = "1-39-140-78-135-61-2-4-9";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const apiKey = Deno.env.get("APIFOOTBALL_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "Server not configured" }, 500);
    }

    const allowed = Deno.env.get("ALLOWED_APIKEY");
    if (allowed && req.headers.get("apikey") !== allowed) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    let target;
    if (action === "live") {
      target = `${AF_BASE}/fixtures?live=${LIVE_LEAGUES}`;
    } else if (action === "fixture") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) {
        return jsonResponse({ error: "Bad id" }, 400);
      }
      target = `${AF_BASE}/fixtures?id=${id}`;
    } else {
      return jsonResponse({ error: "Unknown action" }, 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(target, {
        headers: { "x-apisports-key": apiKey },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (_err) {
    return jsonResponse({ error: "Upstream unavailable" }, 502);
  }
});

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
