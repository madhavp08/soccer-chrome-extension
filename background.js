importScripts("config.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "checkEvents") {
    checkEvents()
      .then(sendResponse)
      .catch(() => sendResponse({ show: false }));
    return true;
  }
  if (msg && msg.type === "vote") {
    submitVote(msg.choice, msg.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function checkEvents() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (!enabled) return { show: false };

  let { afFixtureId, afEventsLen } = await chrome.storage.local.get([
    "afFixtureId",
    "afEventsLen"
  ]);

  if (!afFixtureId) {
    afFixtureId = await findLiveFixture();
    if (!afFixtureId) return { show: false };
    afEventsLen = null;
  }

  const data = await fetchFixture(afFixtureId);
  if (!data) return { show: false };

  const events = Array.isArray(data.events) ? data.events : [];
  const status = data.fixture && data.fixture.status ? data.fixture.status.short : "";
  const finished = APIFOOTBALL_CONFIG.finishedStatuses.includes(status);

  let result = { show: false };
  if (afEventsLen != null) {
    const fresh = events
      .slice(afEventsLen)
      .filter((e) => APIFOOTBALL_CONFIG.triggerTypes.includes(e.type));
    if (fresh.length) {
      result = { show: true, poll: buildPoll(fresh[fresh.length - 1]) };
    }
  }

  await chrome.storage.local.set({
    afFixtureId: finished ? null : afFixtureId,
    afEventsLen: finished ? null : events.length
  });

  return result;
}

async function findLiveFixture() {
  const json = await callProxy("action=live");
  const list = json && Array.isArray(json.response) ? json.response : [];
  return list.length ? list[0].fixture.id : null;
}

async function fetchFixture(id) {
  const json = await callProxy(`action=fixture&id=${id}`);
  const list = json && Array.isArray(json.response) ? json.response : [];
  return list.length ? list[0] : null;
}

async function callProxy(query) {
  const res = await fetch(`${APIFOOTBALL_CONFIG.functionUrl}?${query}`, {
    headers: { apikey: SUPABASE_CONFIG.anonKey }
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function buildPoll(event) {
  const team = event.team && event.team.name ? event.team.name : "";
  const player = event.player && event.player.name ? event.player.name : "";
  const elapsed = event.time && event.time.elapsed != null ? event.time.elapsed : null;
  const extra = event.time && event.time.extra ? `+${event.time.extra}` : "";
  const minute = elapsed != null ? `${elapsed}${extra}'` : "";
  const detail = event.detail || (event.type === "Card" ? "Card" : "VAR review");
  const context = event.comments || "";

  if (event.type === "Card") {
    const who = player ? `${player} (${team})` : team;
    const when = minute ? `, ${minute}` : "";
    return { question: `${detail} for ${who}${when} — right call?`, context };
  }

  const where = team ? ` (${team})` : "";
  const when = minute ? `, ${minute}` : "";
  return { question: `VAR: ${detail}${where}${when} — do you agree?`, context };
}

async function submitVote(choice, question) {
  const { url, anonKey, table } = SUPABASE_CONFIG;

  const headers = {
    apikey: anonKey,
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  };
  if (anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question, choice })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Save failed (${res.status}): ${detail}`);
  }
}
