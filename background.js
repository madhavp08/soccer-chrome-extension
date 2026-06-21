importScripts("config.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "checkFouls") {
    checkFouls()
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

async function checkFouls() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (!enabled) return { show: false };

  const matchId = await getLiveMatchId();
  if (!matchId) return { show: false };

  const foul = await getNewFoul(matchId);
  if (!foul) return { show: false };

  return { show: true, foul };
}

async function getLiveMatchId() {
  const { key, secret, base, competitionId } = LIVESCORE_CONFIG;
  const url = `${base}/matches/live.json?key=${key}&secret=${secret}&competition_id=${competitionId}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const matches = json && json.data && json.data.match;
  const list = Array.isArray(matches) ? matches : matches ? [matches] : [];
  return list.length ? list[0].id : null;
}

async function getNewFoul(matchId) {
  const { key, secret, base, commentaryPath, triggerEvents } = LIVESCORE_CONFIG;
  const url = `${base}/${commentaryPath}?key=${key}&secret=${secret}&match_id=${matchId}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const events = json && json.data && json.data.commentary;
  if (!Array.isArray(events)) return null;

  const maxSecond = events.reduce(
    (max, e) => Math.max(max, Number(e.match_second) || 0),
    0
  );

  const state = await chrome.storage.local.get(["lsMatchId", "lsLastSecond"]);

  if (state.lsMatchId !== matchId) {
    await chrome.storage.local.set({
      lsMatchId: matchId,
      lsLastSecond: maxSecond
    });
    return null;
  }

  const lastSecond = state.lsLastSecond || 0;
  const fouls = events
    .filter(
      (e) =>
        triggerEvents.includes(e.event_type) &&
        Number(e.match_second) > lastSecond
    )
    .sort((a, b) => Number(a.match_second) - Number(b.match_second));

  await chrome.storage.local.set({
    lsMatchId: matchId,
    lsLastSecond: Math.max(maxSecond, lastSecond)
  });

  if (!fouls.length) return null;

  const latest = fouls[fouls.length - 1];
  return {
    player: latest.player && latest.player.name ? latest.player.name : "",
    team: latest.team && latest.team.name ? latest.team.name : "",
    minute: latest.minute || "",
    text: latest.text || ""
  };
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
