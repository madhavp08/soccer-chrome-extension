const AF_BASE = "https://v3.football.api-sports.io";
const UPSTREAM_TIMEOUT_MS = 12000;
const LIVE_EDGE_TTL_MS = 5000;
const FIXTURE_EDGE_TTL_MS = 3000;

// World Cup, Premier League, La Liga, Bundesliga, Serie A, Ligue 1,
// Champions League, European Championship, Copa America
const LIVE_LEAGUES = "1-39-140-78-135-61-2-4-9";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const edgeCache = new Map();
const inFlight = new Map();

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
    let ttlMs = 0;
    let cacheKey = "";
    if (action === "live") {
      target = `${AF_BASE}/fixtures?live=${LIVE_LEAGUES}`;
      ttlMs = LIVE_EDGE_TTL_MS;
      cacheKey = "live";
    } else if (action === "fixture") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) {
        return jsonResponse({ error: "Bad id" }, 400);
      }
      target = `${AF_BASE}/fixtures?id=${id}`;
      ttlMs = FIXTURE_EDGE_TTL_MS;
      cacheKey = `fixture:${id}`;
    } else {
      return jsonResponse({ error: "Unknown action" }, 400);
    }

    const cached = edgeCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < ttlMs) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "HIT" }
      });
    }

    if (inFlight.has(cacheKey)) {
      const shared = await inFlight.get(cacheKey);
      return new Response(shared.body, {
        status: shared.status,
        headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "SHARE" }
      });
    }

    const fetchPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const res = await fetch(target, {
          headers: { "x-apisports-key": apiKey },
          signal: controller.signal
        });
        const body = await res.text();
        const packed = { status: res.status, body, at: Date.now() };
        if (res.ok) {
          edgeCache.set(cacheKey, packed);
          if (edgeCache.size > 40) {
            const oldest = edgeCache.keys().next().value;
            edgeCache.delete(oldest);
          }
        }
        return packed;
      } finally {
        clearTimeout(timer);
      }
    })();

    inFlight.set(cacheKey, fetchPromise);
    let packed;
    try {
      packed = await fetchPromise;
    } finally {
      inFlight.delete(cacheKey);
    }

    return new Response(packed.body, {
      status: packed.status,
      headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "MISS" }
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
