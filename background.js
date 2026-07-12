importScripts("config.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "sync") {
    sync(sender)
      .then(sendResponse)
      .catch(() => sendResponse({ activePolls: [], goalMoments: [], presence: "away" }));
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
  if (msg && msg.type === "penaltyVote") {
    submitPenaltyVotes(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg && msg.type === "penaltyBreakdown") {
    getPenaltyBreakdown(msg)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function sync(sender) {
  const { enabled, selectedGameId, afEventsLen } = await chrome.storage.local.get([
    "enabled",
    "selectedGameId",
    "afEventsLen"
  ]);
  if (!enabled) return { activePolls: [], goalMoments: [], presence: "away" };

  const presence = await resolvePresence(sender);

  let gameId = selectedGameId;
  if (!gameId) {
    const games = await listLiveGames();
    if (!games.length) return { presence, activePolls: [], goalMoments: [] };
    if (games.length === 1) {
      gameId = games[0].id;
      await chrome.storage.local.set({
        selectedGameId: gameId,
        selectedGameLabel: games[0].label,
        afEventsLen: null
      });
    } else {
      return { needGamePick: true, presence, games, activePolls: [], goalMoments: [] };
    }
  }

  const { finished, penaltyShootout, inPenalties } = await registerNewEvents(gameId, afEventsLen);
  if (finished) {
    await turnOffAfterMatch();
    return { presence, activePolls: [], goalMoments: [], matchOver: true };
  }

  const activePolls = await fetchActivePolls(gameId);
  const goalMoments =
    presence === "away" && !inPenalties ? await listPendingGoalMoments() : [];
  return {
    presence,
    activePolls,
    goalMoments,
    penaltyShootout
  };
}

async function resolvePresence(sender) {
  const tabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
  let { viewerTabId } = await chrome.storage.local.get("viewerTabId");
  if (viewerTabId == null && tabId != null) {
    await chrome.storage.local.set({ viewerTabId: tabId });
    viewerTabId = tabId;
  }
  if (tabId != null && tabId === viewerTabId) return "watching";
  return "away";
}

async function turnOffAfterMatch() {
  await chrome.storage.local.set({
    enabled: false,
    selectedGameId: null,
    selectedGameLabel: null,
    afEventsLen: null,
    viewerTabId: null,
    pendingGoalMoments: [],
    penaltyDoneFixtureId: null,
    vardictMode: null
  });
}

const GOAL_MOMENT_TTL_MS = 120000;

async function rememberGoalMoments(moments) {
  if (!moments.length) return;
  const now = Date.now();
  const { pendingGoalMoments = [] } = await chrome.storage.local.get("pendingGoalMoments");
  const byKey = new Map();
  for (const m of pendingGoalMoments) {
    if (m && m.key && now - (m.at || 0) < GOAL_MOMENT_TTL_MS) byKey.set(m.key, m);
  }
  for (const m of moments) {
    if (!m || !m.key) continue;
    byKey.set(m.key, { key: m.key, text: m.text, at: now });
  }
  await chrome.storage.local.set({ pendingGoalMoments: [...byKey.values()] });
}

async function listPendingGoalMoments() {
  const now = Date.now();
  const { pendingGoalMoments = [] } = await chrome.storage.local.get("pendingGoalMoments");
  const live = pendingGoalMoments.filter((m) => m && m.key && now - (m.at || 0) < GOAL_MOMENT_TTL_MS);
  if (live.length !== pendingGoalMoments.length) {
    await chrome.storage.local.set({ pendingGoalMoments: live });
  }
  return live.map(({ key, text }) => ({ key, text }));
}

async function registerNewEvents(gameId, afEventsLen) {
  const data = await fetchFixture(gameId);
  if (!data) return { finished: false, penaltyShootout: null, inPenalties: false };

  const events = Array.isArray(data.events) ? data.events : [];
  const status = data.fixture && data.fixture.status ? data.fixture.status.short : "";
  const finished = isMatchFullyOver(data);
  const voteTypes = EVENT_TYPES.vote || ["Card", "Var"];
  const alertTypes = EVENT_TYPES.alert || ["Goal"];
  const inPenalties = status === "P";
  const goalMoments = [];

  if (finished) {
    return { finished: true, penaltyShootout: null, inPenalties: false };
  }

  let penaltyShootout = null;
  if (inPenalties) {
    penaltyShootout = await ensurePenaltyShootout(gameId, data);
  }

  if (afEventsLen != null) {
    const fresh = events.slice(afEventsLen);
    const pollOpens = [];
    for (const event of fresh) {
      if (voteTypes.includes(event.type)) {
        const poll = buildPoll(event);
        pollOpens.push(openPoll(gameId, poll.question));
      }
      if (!inPenalties && alertTypes.includes(event.type)) {
        goalMoments.push(buildGoalMoment(event));
      }
    }
    if (pollOpens.length) {
      await Promise.all(pollOpens);
    }
    if (goalMoments.length) {
      await rememberGoalMoments(goalMoments);
    }
  }

  await chrome.storage.local.set({ afEventsLen: events.length });
  return { finished: false, penaltyShootout, inPenalties };
}

function isMatchFullyOver(data) {
  const short = data.fixture && data.fixture.status ? data.fixture.status.short : "";
  const terminal = APIFOOTBALL_CONFIG.finishedStatuses || ["AET", "PEN"];
  if (terminal.includes(short)) return true;
  if (short !== "FT") return false;

  const home = data.goals && data.goals.home;
  const away = data.goals && data.goals.away;
  if (home == null || away == null) return true;
  if (home !== away) return true;

  const round = data.league && data.league.round ? String(data.league.round) : "";
  const mayGoExtra = /round of|quarter|semi|final|play-?off|knockout/i.test(round);
  return !mayGoExtra;
}

async function ensurePenaltyShootout(gameId, data) {
  const { penaltyDoneFixtureId } = await chrome.storage.local.get("penaltyDoneFixtureId");
  if (penaltyDoneFixtureId != null && Number(penaltyDoneFixtureId) === Number(gameId)) {
    return null;
  }

  const home = data.teams && data.teams.home && data.teams.home.name ? data.teams.home.name : "Home";
  const away = data.teams && data.teams.away && data.teams.away.name ? data.teams.away.name : "Away";
  const question = penaltyMasterQuestion(gameId);
  const openedAt = await openPoll(gameId, question);
  return {
    fixtureId: gameId,
    home,
    away,
    openedAt: openedAt || new Date().toISOString()
  };
}

function penaltyMasterQuestion(fixtureId) {
  return `Penalty shootout ${fixtureId}`;
}

function penaltyShotQuestion(fixtureId, teamName, shotIndex) {
  return `Penalty ${fixtureId} · ${teamName} · shot ${shotIndex}`;
}

async function openPoll(fixtureId, question) {
  const { url, anonKey } = SUPABASE_CONFIG;
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/open_poll`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_fixture_id: fixtureId, p_question: question })
    });
    if (!res.ok) return null;
    const openedAt = await res.json().catch(() => null);
    return typeof openedAt === "string" ? openedAt : null;
  } catch (e) {
    return null;
  }
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

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededFakeVotes(question) {
  const min = FAKE_VOTES && FAKE_VOTES.min != null ? FAKE_VOTES.min : 18;
  const max = FAKE_VOTES && FAKE_VOTES.max != null ? FAKE_VOTES.max : 36;
  const h = hashString(question || "");
  const span = Math.max(0, max - min);
  const total = min + (h % (span + 1));
  const yesPct = 38 + (h % 25);
  const yes = Math.round((total * yesPct) / 100);
  return { total, yes, no: total - yes };
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

  const realTotal = Number(row.total) || 0;
  const realYes = Number(row.yes) || 0;
  const realNo = Number(row.no) || 0;
  const fake = seededFakeVotes(question);

  return {
    ok: true,
    total: realTotal + fake.total,
    yes: realYes + fake.yes,
    no: realNo + fake.no
  };
}

function asShotFlags(shots) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push(Boolean(shots && shots[i]));
  }
  return out;
}

async function submitPenaltyVotes(msg) {
  const fixtureId = msg.fixtureId;
  const home = msg.home;
  const away = msg.away;
  const homeShots = asShotFlags(msg.homeShots);
  const awayShots = asShotFlags(msg.awayShots);
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(submitVote(homeShots[i] ? "Yes" : "No", penaltyShotQuestion(fixtureId, home, i + 1)));
    tasks.push(submitVote(awayShots[i] ? "Yes" : "No", penaltyShotQuestion(fixtureId, away, i + 1)));
  }
  await Promise.all(tasks);
  await chrome.storage.local.set({ penaltyDoneFixtureId: fixtureId });
}

function consensusGoal(breakdown) {
  if (!breakdown || !breakdown.ok || !breakdown.total) return false;
  return breakdown.yes / breakdown.total >= 0.5;
}

async function getPenaltyBreakdown(msg) {
  const fixtureId = msg.fixtureId;
  const home = msg.home;
  const away = msg.away;
  const homeShots = [];
  const awayShots = [];
  for (let i = 1; i <= 5; i++) {
    const [h, a] = await Promise.all([
      getBreakdown(penaltyShotQuestion(fixtureId, home, i)),
      getBreakdown(penaltyShotQuestion(fixtureId, away, i))
    ]);
    homeShots.push(consensusGoal(h));
    awayShots.push(consensusGoal(a));
  }
  return { ok: true, home: homeShots, away: awayShots };
}
