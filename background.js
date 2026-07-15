importScripts("config.js");

const GOAL_MOMENT_TTL_MS = 120000;
const LIVE_CACHE_TTL_MS = 12000;
const LIVE_STALE_TTL_MS = 30000;
const FIXTURE_CACHE_TTL_MS = 4000;
const FIXTURE_STALE_TTL_MS = 15000;
const FETCH_TIMEOUT_MS = 8000;
const PENALTY_DIRECTIONS = ["Top Left", "Bottom Left", "Middle", "Bottom Right", "Top Right"];

const liveCache = { at: 0, data: null };
const fixtureCache = new Map();
const proxyInFlight = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "sync") {
    sync(sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ activePolls: [], goalMoments: [], penaltyKicks: [], presence: "away" })
      );
    return true;
  }

  if (msg.type === "selectGame") {
    const gameId = Number(msg.gameId);
    if (!Number.isFinite(gameId) || !msg.label) {
      sendResponse({ ok: false });
      return;
    }
    chrome.storage.local
      .set({
        selectedGameId: gameId,
        selectedGameLabel: String(msg.label),
        afEventsLen: null,
        pendingGoalMoments: [],
        penaltyDoneFixtureId: null
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "vote") {
    if (!msg.choice || !msg.question) {
      sendResponse({ ok: false, error: "Missing vote fields" });
      return;
    }
    submitVote(msg.choice, msg.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "breakdown") {
    if (!msg.question) {
      sendResponse({ ok: false });
      return;
    }
    getBreakdown(msg.question)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "penaltyVote") {
    submitPenaltyVotes(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "penaltyBreakdown") {
    getPenaltyBreakdown(msg)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "penaltyDirectionVote") {
    if (!msg.choice || !msg.question || !PENALTY_DIRECTIONS.includes(msg.choice)) {
      sendResponse({ ok: false, error: "Missing penalty direction fields" });
      return;
    }
    submitVote(msg.choice, msg.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "penaltyDirectionBreakdown") {
    if (!msg.question) {
      sendResponse({ ok: false });
      return;
    }
    getPenaltyDirectionBreakdown(msg.question)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "listLiveGames") {
    listLiveGames()
      .then((games) => sendResponse({ ok: true, games }))
      .catch(() => sendResponse({ ok: false, games: [] }));
    return true;
  }
});

function supabaseHeaders(extra) {
  const { anonKey } = SUPABASE_CONFIG;
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey && anonKey.startsWith("ey")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  return Object.assign(headers, extra || {});
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function sync(sender) {
  const { enabled, selectedGameId, afEventsLen } = await chrome.storage.local.get([
    "enabled",
    "selectedGameId",
    "afEventsLen"
  ]);
  if (!enabled) {
    return { activePolls: [], goalMoments: [], penaltyKicks: [], presence: "away" };
  }

  const presence = await resolvePresence(sender);

  let gameId = selectedGameId;
  if (!gameId) {
    const games = await listLiveGames();
    if (!games.length) return { presence, activePolls: [], goalMoments: [], penaltyKicks: [] };
    if (games.length === 1) {
      gameId = games[0].id;
      await chrome.storage.local.set({
        selectedGameId: gameId,
        selectedGameLabel: games[0].label,
        afEventsLen: null
      });
    } else {
      return {
        needGamePick: true,
        presence,
        games,
        activePolls: [],
        goalMoments: [],
        penaltyKicks: []
      };
    }
  }

  const { finished, penaltyShootout, inPenalties } = await registerNewEvents(gameId, afEventsLen);
  if (finished) {
    await turnOffAfterMatch();
    return { presence, activePolls: [], goalMoments: [], penaltyKicks: [], matchOver: true };
  }

  const pollsPromise = fetchActivePolls(gameId);
  const goalsPromise =
    presence === "away" && !inPenalties ? listPendingGoalMoments() : Promise.resolve([]);
  const [pollRows, goalMoments] = await Promise.all([pollsPromise, goalsPromise]);

  const activePolls = [];
  const penaltyKicks = [];
  for (const poll of pollRows) {
    if (!poll || !poll.question) continue;
    if (isPenaltyKickQuestion(poll.question)) {
      penaltyKicks.push(poll);
    } else if (!isPenaltyShootoutQuestion(poll.question)) {
      activePolls.push(poll);
    }
  }

  return {
    presence,
    activePolls,
    goalMoments,
    penaltyKicks,
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
  liveCache.at = 0;
  liveCache.data = null;
  fixtureCache.clear();
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
    const cursor = Math.min(Math.max(0, Number(afEventsLen) || 0), events.length);
    const fresh = events.slice(cursor);
    const pollOpens = [];
    for (const event of fresh) {
      if (!event || !event.type) continue;
      if (!inPenalties && isInGamePenaltyAward(event)) {
        const kick = buildPenaltyKickPoll(gameId, event);
        if (kick && kick.question) pollOpens.push(openPoll(gameId, kick.question));
        continue;
      }
      if (voteTypes.includes(event.type) && !isInGamePenaltyAward(event)) {
        const poll = buildPoll(event);
        if (poll && poll.question) pollOpens.push(openPoll(gameId, poll.question));
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
  const openedAt = await openPoll(gameId, penaltyMasterQuestion(gameId));
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
  const { url } = SUPABASE_CONFIG;
  try {
    const res = await fetchWithTimeout(`${url}/rest/v1/rpc/open_poll`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ p_fixture_id: fixtureId, p_question: question })
    });
    if (!res.ok) return null;
    const openedAt = await res.json().catch(() => null);
    return typeof openedAt === "string" ? openedAt : null;
  } catch (_e) {
    return null;
  }
}

async function fetchActivePolls(fixtureId) {
  const { url } = SUPABASE_CONFIG;
  try {
    const res = await fetchWithTimeout(`${url}/rest/v1/rpc/active_polls_for_fixture`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ p_fixture_id: fixtureId })
    });
    if (!res.ok) return [];
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && row.question && row.opened_at)
      .map((row) => ({
        question: row.question,
        openedAt: row.opened_at
      }));
  } catch (_e) {
    return [];
  }
}

async function listLiveGames(options) {
  const allowStale = !(options && options.fresh);
  const now = Date.now();
  if (liveCache.data && now - liveCache.at < LIVE_CACHE_TTL_MS) {
    return liveCache.data;
  }
  if (allowStale && liveCache.data && now - liveCache.at < LIVE_STALE_TTL_MS) {
    refreshLiveGames();
    return liveCache.data;
  }
  return refreshLiveGames();
}

async function refreshLiveGames() {
  if (proxyInFlight.has("live")) {
    return proxyInFlight.get("live");
  }
  const task = (async () => {
    const json = await callProxy("action=live");
    const list = json && Array.isArray(json.response) ? json.response : [];
    const games = list
      .filter((item) => item && item.fixture && item.fixture.id != null)
      .map((item) => {
        const home = item.teams && item.teams.home ? item.teams.home.name : "Home";
        const away = item.teams && item.teams.away ? item.teams.away.name : "Away";
        const gh = item.goals && item.goals.home != null ? item.goals.home : null;
        const ga = item.goals && item.goals.away != null ? item.goals.away : null;
        const score = gh != null && ga != null ? ` (${gh}-${ga})` : "";
        const competition = item.league && item.league.name ? String(item.league.name) : "";
        const matchup = `${home} vs ${away}${score}`;
        return {
          id: item.fixture.id,
          label: competition ? `${competition} · ${matchup}` : matchup
        };
      });
    liveCache.at = Date.now();
    liveCache.data = games;
    return games;
  })();
  proxyInFlight.set("live", task);
  try {
    return await task;
  } finally {
    proxyInFlight.delete("live");
  }
}

async function fetchFixture(id) {
  const key = String(id);
  const now = Date.now();
  const cached = fixtureCache.get(key);
  if (cached && now - cached.at < FIXTURE_CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached && now - cached.at < FIXTURE_STALE_TTL_MS) {
    refreshFixture(key);
    return cached.data;
  }
  return refreshFixture(key);
}

async function refreshFixture(key) {
  const flightKey = `fixture:${key}`;
  if (proxyInFlight.has(flightKey)) {
    return proxyInFlight.get(flightKey);
  }
  const task = (async () => {
    const json = await callProxy(`action=fixture&id=${encodeURIComponent(key)}`);
    const list = json && Array.isArray(json.response) ? json.response : [];
    const data = list.length ? list[0] : null;
    fixtureCache.set(key, { at: Date.now(), data });
    if (fixtureCache.size > 20) {
      const oldest = fixtureCache.keys().next().value;
      fixtureCache.delete(oldest);
    }
    return data;
  })();
  proxyInFlight.set(flightKey, task);
  try {
    return await task;
  } finally {
    proxyInFlight.delete(flightKey);
  }
}

async function callProxy(query) {
  try {
    const res = await fetchWithTimeout(`${APIFOOTBALL_CONFIG.functionUrl}?${query}`, {
      headers: { apikey: SUPABASE_CONFIG.anonKey }
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (_e) {
    return null;
  }
}

function isInGamePenaltyAward(event) {
  if (!event) return false;
  const detail = String(event.detail || "");
  const comments = String(event.comments || "");
  const blob = `${detail} ${comments}`;
  if (event.type === "Var") {
    return /penalty\s+(confirmed|awarded)/i.test(blob) || /^penalty$/i.test(detail.trim());
  }
  return false;
}

function isPenaltyKickQuestion(question) {
  return String(question || "").startsWith("Penalty kick ·");
}

function isPenaltyShootoutQuestion(question) {
  return String(question || "").startsWith("Penalty shootout ");
}

function buildPenaltyKickPoll(fixtureId, event) {
  const team = event.team && event.team.name ? event.team.name : "";
  const player = event.player && event.player.name ? event.player.name : "";
  const who = [player, team].filter(Boolean).join(" ") || "Unknown";
  const elapsed = event.time && event.time.elapsed != null ? event.time.elapsed : null;
  const extra = event.time && event.time.extra ? `+${event.time.extra}` : "";
  const minute = elapsed != null ? `${elapsed}${extra}'` : "";
  const stamp = minute || String(event.detail || "spot");
  return {
    question: `Penalty kick · ${fixtureId} · ${stamp} · ${who}`
  };
}

function buildPoll(event) {
  const team = event.team && event.team.name ? event.team.name : "";
  const player = event.player && event.player.name ? event.player.name : "";
  const context = event.comments || "";
  const who = [player, team].filter(Boolean).join(" ");

  if (event.type === "Card") {
    const detail = event.detail || "Card";
    return {
      question: who ? `${detail} for ${who}.` : `${detail}.`,
      context
    };
  }

  let detail = String(event.detail || "").trim();
  detail = detail.replace(/^VAR\s*/i, "").trim();
  if (!detail || /^VAR$/i.test(detail)) detail = "review";

  if (who) {
    return { question: `VAR · ${detail} for ${who}.`, context };
  }
  return { question: `VAR · ${detail}.`, context };
}

function buildGoalMoment(event) {
  const team = event.team && event.team.name ? event.team.name : "";
  const player = event.player && event.player.name ? event.player.name : "";
  const elapsed = event.time && event.time.elapsed != null ? event.time.elapsed : null;
  const extra = event.time && event.time.extra ? `+${event.time.extra}` : "";
  const minute = elapsed != null ? `${elapsed}${extra}'` : "";
  const who = [player, team].filter(Boolean).join(" ") || "Unknown";

  return {
    key: `goal:${minute}:${team}:${player}:${event.detail || ""}`,
    text: minute ? `Goal for ${who}, ${minute}.` : `Goal for ${who}.`
  };
}

async function submitVote(choice, question) {
  const { url, table } = SUPABASE_CONFIG;
  const res = await fetchWithTimeout(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ question, choice })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
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

function seededFakeChoiceCounts(question, choices) {
  const min = FAKE_VOTES && FAKE_VOTES.min != null ? FAKE_VOTES.min : 18;
  const max = FAKE_VOTES && FAKE_VOTES.max != null ? FAKE_VOTES.max : 36;
  const h0 = hashString(question || "");
  const span = Math.max(0, max - min);
  const total = min + (h0 % (span + 1));
  const weights = choices.map((choice, i) => {
    const h = hashString(`${question || ""}::${choice}::${i}`);
    return 3 + (h % 10);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map((w) => Math.floor((total * w) / weightSum));
  let used = counts.reduce((a, b) => a + b, 0);
  let idx = 0;
  while (used < total) {
    counts[idx % counts.length] += 1;
    used += 1;
    idx += 1;
  }
  return counts;
}

function percentParts(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) {
    const even = Math.floor(100 / counts.length);
    const parts = counts.map(() => even);
    let rem = 100 - even * counts.length;
    for (let i = 0; rem > 0; i++, rem--) parts[i % parts.length] += 1;
    return parts;
  }
  const raw = counts.map((c) => (c * 100) / total);
  const floors = raw.map((r) => Math.floor(r));
  let rem = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) {
    floors[order[k % order.length].i] += 1;
  }
  return floors;
}

async function getBreakdown(question) {
  const { url } = SUPABASE_CONFIG;
  try {
    const res = await fetchWithTimeout(`${url}/rest/v1/rpc/vote_breakdown`, {
      method: "POST",
      headers: supabaseHeaders(),
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
      no: realNo + fake.no,
      valid: realYes + fake.yes,
      invalid: realNo + fake.no
    };
  } catch (_e) {
    return { ok: false };
  }
}

async function getPenaltyDirectionBreakdown(question) {
  const { url } = SUPABASE_CONFIG;
  const choices = PENALTY_DIRECTIONS.slice();
  const real = choices.map(() => 0);
  try {
    const res = await fetchWithTimeout(`${url}/rest/v1/rpc/vote_choice_counts`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ q: question })
    });
    if (res.ok) {
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row || row.choice == null) continue;
          const idx = choices.indexOf(String(row.choice));
          if (idx >= 0) real[idx] = Number(row.n) || 0;
        }
      }
    }
  } catch (_e) {
    // Fake pad still returned below.
  }

  const fake = seededFakeChoiceCounts(question, choices);
  const counts = choices.map((_, i) => real[i] + fake[i]);
  const percents = percentParts(counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    ok: true,
    total,
    choices: choices.map((choice, i) => ({
      choice,
      count: counts[i],
      percent: percents[i]
    }))
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
  if (fixtureId == null || !home || !away) {
    throw new Error("Missing penalty fields");
  }
  const homeShots = asShotFlags(msg.homeShots);
  const awayShots = asShotFlags(msg.awayShots);
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(submitVote(homeShots[i] ? "Goal" : "Miss", penaltyShotQuestion(fixtureId, home, i + 1)));
    tasks.push(submitVote(awayShots[i] ? "Goal" : "Miss", penaltyShotQuestion(fixtureId, away, i + 1)));
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
  if (fixtureId == null || !home || !away) return { ok: false };

  const tasks = [];
  for (let i = 1; i <= 5; i++) {
    tasks.push(getBreakdown(penaltyShotQuestion(fixtureId, home, i)));
    tasks.push(getBreakdown(penaltyShotQuestion(fixtureId, away, i)));
  }
  const rows = await Promise.all(tasks);
  const homeShots = [];
  const awayShots = [];
  for (let i = 0; i < 5; i++) {
    homeShots.push(consensusGoal(rows[i * 2]));
    awayShots.push(consensusGoal(rows[i * 2 + 1]));
  }
  return { ok: true, home: homeShots, away: awayShots };
}
