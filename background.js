importScripts("config.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "sync") {
    sync()
      .then(sendResponse)
      .catch(() => sendResponse({ activePolls: [] }));
    return true;
  }
  if (msg && msg.type === "selectMode") {
    if (!MODES[msg.mode]) {
      sendResponse({ ok: false });
      return;
    }
    chrome.storage.local
      .set({ vardictMode: msg.mode, afEventsLen: null })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "selectGame") {
    chrome.storage.local
      .set({
        selectedGameId: msg.gameId,
        selectedGameLabel: msg.label,
        afEventsLen: null
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "vote") {
    submitVote(msg.choice, msg.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg && msg.type === "breakdown") {
    getBreakdown(msg.question)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function sync() {
  const { enabled, selectedGameId, afEventsLen, vardictMode } = await chrome.storage.local.get([
    "enabled",
    "selectedGameId",
    "afEventsLen",
    "vardictMode"
  ]);
  if (!enabled) return { activePolls: [] };
  if (!vardictMode || !MODES[vardictMode]) return { needModePick: true, activePolls: [] };

  let gameId = selectedGameId;
  if (!gameId) {
    const games = await listLiveGames();
    if (!games.length) return { mode: vardictMode, activePolls: [], goalMoments: [] };
    if (games.length === 1) {
      gameId = games[0].id;
      await chrome.storage.local.set({
        selectedGameId: gameId,
        selectedGameLabel: games[0].label,
        afEventsLen: null
      });
    } else {
      return { needGamePick: true, mode: vardictMode, games, activePolls: [], goalMoments: [] };
    }
  }

  const goalMoments = await registerNewEvents(gameId, afEventsLen, vardictMode);
  const activePolls = await fetchActivePolls(gameId);
  return {
    mode: vardictMode,
    activePolls,
    goalMoments: vardictMode === "moments" ? goalMoments : []
  };
}

function pollEventTypes(mode) {
  if (mode === "moments") {
    return MODES.moments.pollTypes || ["Card", "Var"];
  }
  return triggersForMode(mode);
}

function momentEventTypes(mode) {
  if (mode !== "moments") return [];
  return MODES.moments.momentTypes || ["Goal"];
}

function triggersForMode(mode) {
  return MODES[mode] ? MODES[mode].triggerTypes : [];
}

async function registerNewEvents(gameId, afEventsLen, mode) {
  const data = await fetchFixture(gameId);
  if (!data) return [];

  const events = Array.isArray(data.events) ? data.events : [];
  const status = data.fixture && data.fixture.status ? data.fixture.status.short : "";
  const finished = APIFOOTBALL_CONFIG.finishedStatuses.includes(status);
  const triggers = triggersForMode(mode);
  const polls = pollEventTypes(mode);
  const moments = momentEventTypes(mode);
  const goalMoments = [];

  if (afEventsLen != null && !finished) {
    const fresh = events.slice(afEventsLen).filter((e) => triggers.includes(e.type));
    for (const event of fresh) {
      if (polls.includes(event.type)) {
        const poll = buildPoll(event);
        await openPoll(gameId, poll.question);
      }
      if (moments.includes(event.type)) {
        goalMoments.push(buildGoalMoment(event));
      }
    }
  }

  if (!finished) {
    await chrome.storage.local.set({ afEventsLen: events.length });
  }

  return goalMoments;
}

async function openPoll(fixtureId, question) {
  const { url, anonKey } = SUPABASE_CONFIG;
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  await fetch(`${url}/rest/v1/rpc/open_poll`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_fixture_id: fixtureId, p_question: question })
  });
}

async function fetchActivePolls(fixtureId) {
  const { url, anonKey } = SUPABASE_CONFIG;
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  const res = await fetch(`${url}/rest/v1/rpc/active_polls_for_fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_fixture_id: fixtureId })
  });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    question: row.question,
    openedAt: row.opened_at
  }));
}

async function listLiveGames() {
  const json = await callProxy("action=live");
  const list = json && Array.isArray(json.response) ? json.response : [];
  return list.map((item) => {
    const home = item.teams && item.teams.home ? item.teams.home.name : "Home";
    const away = item.teams && item.teams.away ? item.teams.away.name : "Away";
    const gh = item.goals && item.goals.home != null ? item.goals.home : null;
    const ga = item.goals && item.goals.away != null ? item.goals.away : null;
    const score = gh != null && ga != null ? ` (${gh}-${ga})` : "";
    return {
      id: item.fixture.id,
      label: `${home} vs ${away}${score}`
    };
  });
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

function buildGoalMoment(event) {
  const team = event.team && event.team.name ? event.team.name : "";
  const player = event.player && event.player.name ? event.player.name : "";
  const elapsed = event.time && event.time.elapsed != null ? event.time.elapsed : null;
  const extra = event.time && event.time.extra ? `+${event.time.extra}` : "";
  const minute = elapsed != null ? `${elapsed}${extra}'` : "";
  const when = minute ? ` · ${minute}` : "";
  const who = player ? `${player} (${team})` : team || "Unknown";
  const detail = event.detail ? ` (${event.detail})` : "";

  return {
    key: `goal:${minute}:${team}:${player}:${event.detail || ""}`,
    text: `Goal${when}${detail} — ${who}`
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

async function getBreakdown(question) {
  const { url, anonKey } = SUPABASE_CONFIG;

  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  const res = await fetch(`${url}/rest/v1/rpc/vote_breakdown`, {
    method: "POST",
    headers,
    body: JSON.stringify({ q: question })
  });
  if (!res.ok) return { ok: false };

  const data = await res.json().catch(() => null);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false };

  return {
    ok: true,
    total: Number(row.total) || 0,
    yes: Number(row.yes) || 0,
    no: Number(row.no) || 0
  };
}
