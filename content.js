let overlayEl = null;
let overlayCleanup = null;
let busy = false;
let gamePickerOpen = false;
let presence = null;
let syncInFlight = false;
let breakdownWakeTimer = null;
let overlayOffset = null;
let pendingPenalty = null;
let penaltyHandledKey = null;
let enabledCache = false;
let syncTimer = null;
const activeTimeouts = new Set();
const activeIntervals = new Set();

const voteQueue = [];
const kickQueue = [];
const momentQueue = [];
const pendingBreakdowns = [];
const handled = new Set();
const voted = new Set();
const shownMoments = new Set();

const VALID_COLOR = "#00b86b";
const INVALID_COLOR = "#e5342b";
const RESULTS_SHOW_MS = 6000;
const VOTE_SAVE_TIMEOUT_MS = 8000;
const PENALTY_DIRECTIONS = ["Top Left", "Bottom Left", "Middle", "Bottom Right", "Top Right"];

function isKey(e, name) {
  return e.key === name || e.key.toLowerCase() === name.toLowerCase();
}

function isCode(e, code) {
  return e.code === code;
}

function bindOverlayKeyboard(items, options) {
  const opts = options || {};
  let index = 0;

  function liveItems() {
    return (items || []).filter((el) => el && !el.disabled && el.isConnected);
  }

  function paint() {
    const list = liveItems();
    for (const el of items || []) {
      if (el) el.classList.remove("vardict-btn--focused");
    }
    if (!list.length) return;
    if (index < 0) index = list.length - 1;
    if (index >= list.length) index = 0;
    list[index].classList.add("vardict-btn--focused");
  }

  function move(delta) {
    const list = liveItems();
    if (!list.length) return;
    index = (index + delta + list.length * 8) % list.length;
    paint();
  }

  function activate() {
    const list = liveItems();
    const el = list[index];
    if (!el) return;
    el.click();
  }

  function onKey(e) {
    if (opts.isActive && !opts.isActive()) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    const prev = isCode(e, "KeyW") || isKey(e, "w") || e.key === "ArrowUp";
    const next = isCode(e, "KeyS") || isKey(e, "s") || e.key === "ArrowDown";

    if (typeof opts.onValidInvalid === "function") {
      if (isCode(e, "KeyA") || isKey(e, "a") || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        opts.onValidInvalid("valid");
        return;
      }
      if (isCode(e, "KeyD") || isKey(e, "d") || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        opts.onValidInvalid("invalid");
        return;
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      move(-1);
      return;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      move(1);
      return;
    }

    if (prev) {
      e.preventDefault();
      e.stopPropagation();
      move(-1);
      return;
    }
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      move(1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      activate();
    }
  }

  document.addEventListener("keydown", onKey, true);
  paint();

  return () => {
    document.removeEventListener("keydown", onKey, true);
    for (const el of items || []) {
      if (el) el.classList.remove("vardict-btn--focused");
    }
  };
}

const PREVIEW = {
  question: "Yellow Card for Example Player Example Team.",
  varQuestion: "VAR · Goal cancelled for Example Player Example Team.",
  goal: "Goal for Example Player Example Team, 67'.",
  penaltyKick: "Penalty kick · 0 · 67' · Example Player Example Team"
};

function trackTimeout(fn, ms) {
  const id = setTimeout(() => {
    activeTimeouts.delete(id);
    fn();
  }, ms);
  activeTimeouts.add(id);
  return id;
}

function trackInterval(fn, ms) {
  const id = setInterval(fn, ms);
  activeIntervals.add(id);
  return id;
}

function clearTracked(id) {
  if (id == null) return;
  if (activeTimeouts.has(id)) {
    clearTimeout(id);
    activeTimeouts.delete(id);
  }
  if (activeIntervals.has(id)) {
    clearInterval(id);
    activeIntervals.delete(id);
  }
}

function clearAllTracked() {
  for (const id of activeTimeouts) clearTimeout(id);
  for (const id of activeIntervals) clearInterval(id);
  activeTimeouts.clear();
  activeIntervals.clear();
  if (breakdownWakeTimer) {
    clearTimeout(breakdownWakeTimer);
    breakdownWakeTimer = null;
  }
}

ensureOverlayStyles();
chrome.storage.local.get("overlayOffset", ({ overlayOffset: saved }) => {
  if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
    overlayOffset = saved;
  }
});

document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);

function isOverlayHost() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (window !== window.top) {
    return Boolean(fs);
  }
  if (fs && String(fs.tagName).toUpperCase() === "IFRAME") {
    return false;
  }
  return true;
}

function getOverlayRoot() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fs) return document.body;
  const tag = String(fs.tagName).toUpperCase();
  if (tag === "IFRAME") return null;
  if (tag === "VIDEO" || tag === "AUDIO") {
    const host = fs.parentElement;
    return host || document.body;
  }
  return fs;
}

function prepareOverlayRoot(root) {
  if (!root || root === document.body) return;
  const style = getComputedStyle(root);
  if (style.position === "static") {
    root.style.position = "relative";
  }
  if (style.overflow === "hidden" || style.overflow === "clip") {
    root.dataset.vardictOverflow = style.overflow;
    root.style.overflow = "visible";
  }
}

function mountOverlay(el) {
  const root = getOverlayRoot();
  if (!root) return false;
  prepareOverlayRoot(root);
  root.appendChild(el);
  return true;
}

function onFullscreenChange() {
  ensureSyncTimer();
  reparentOverlayIfNeeded();
  if (!document.hidden && isOverlayHost()) syncTick();
}

function reparentOverlayIfNeeded() {
  if (!overlayEl || !overlayEl.parentNode) return;
  const root = getOverlayRoot();
  if (!root) {
    clearOverlay();
    busy = false;
    return;
  }
  prepareOverlayRoot(root);
  if (overlayEl.parentNode !== root) {
    root.appendChild(overlayEl);
  }
}

function ensureOverlayStyles() {
  if (document.getElementById("vardict-overlay-styles")) return;
  const style = document.createElement("style");
  style.id = "vardict-overlay-styles";
  style.textContent = `
    .vardict-glass {
      background: #121212;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      color: #ffffff;
      -webkit-font-smoothing: antialiased;
      cursor: grab;
      touch-action: none;
    }
    .vardict-glass.vardict-dragging {
      cursor: grabbing;
      user-select: none;
    }
    .vardict-glass--compact .vardict-glass-inner {
      padding: 14px 18px;
    }
    .vardict-heading {
      font-size: 17px;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 8px;
    }
    .vardict-muted {
      font-size: 12px;
      color: #888888;
      margin-bottom: 16px;
    }
    .vardict-btn {
      font-family: inherit;
      font-weight: 600;
      color: #ffffff;
      background: #121212;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease, color 0.15s ease;
    }
    .vardict-btn:hover:not(:disabled) {
      background: #1a1a1a;
      border-color: rgba(255, 255, 255, 0.45);
    }
    .vardict-btn:active:not(:disabled) {
      transform: scale(0.98);
      background: #1a1a1a;
    }
    .vardict-btn:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .vardict-btn--block {
      display: block;
      width: 100%;
      min-height: 44px;
      margin-bottom: 8px;
      padding: 12px;
      font-size: 14px;
      text-align: left;
      box-sizing: border-box;
    }
    .vardict-btn--vote {
      flex: 1 1 0;
      min-width: 0;
      min-height: 44px;
      padding: 12px 0;
      font-size: 16px;
      box-sizing: border-box;
    }
    .vardict-btn--selected {
      background: #2a2a2a;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.85);
    }
    .vardict-btn--selected:hover:not(:disabled) {
      background: #333333;
      border-color: #ffffff;
    }
    .vardict-btn--focused {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
      border-color: rgba(255, 255, 255, 0.95);
    }
    .vardict-pen-dot.vardict-btn--focused {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
      border-color: #ffffff;
    }
    .vardict-btn-title {
      font-weight: 700;
      margin-bottom: 4px;
    }
    .vardict-btn-hint {
      font-size: 12px;
      color: #888888;
      font-weight: 400;
    }
    .vardict-btn--selected .vardict-btn-hint {
      color: #aaaaaa;
    }
    .vardict-pen-row {
      display: flex;
      gap: 10px;
      margin: 8px 0 14px;
    }
    .vardict-pen-dot {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      background: #e5342b;
      padding: 0;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
    }
    .vardict-pen-dot:hover:not(:disabled) {
      transform: scale(1.06);
      border-color: rgba(255, 255, 255, 0.7);
    }
    .vardict-pen-dot.is-goal {
      background: #00b86b;
      border-color: rgba(255, 255, 255, 0.55);
    }
    .vardict-pen-dot:disabled {
      cursor: default;
      opacity: 0.95;
    }
    .vardict-pen-team {
      font-size: 13px;
      font-weight: 700;
      margin-top: 4px;
    }
    .vardict-dir-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 10px 12px;
      align-items: stretch;
    }
    .vardict-dir-cell {
      min-height: 48px;
    }
    .vardict-dir-cell--empty {
      pointer-events: none;
    }
    .vardict-btn--dir {
      width: 100%;
      min-height: 48px;
      padding: 10px 4px;
      font-size: 11px;
      line-height: 1.15;
      text-align: center;
      box-sizing: border-box;
      white-space: nowrap;
    }
    .vardict-dir-results {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 10px 12px;
      margin-top: 4px;
    }
    .vardict-dir-result-cell {
      min-height: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 8px 4px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      box-sizing: border-box;
      text-align: center;
    }
    .vardict-dir-result-cell--empty {
      border: none;
      min-height: 0;
      padding: 0;
    }
    .vardict-dir-result-name {
      font-size: 11px;
      font-weight: 600;
      color: #cccccc;
      white-space: nowrap;
    }
    .vardict-dir-result-pct {
      font-size: 15px;
      font-weight: 700;
    }
  `;
  document.documentElement.appendChild(style);
}

function makeButton(className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `vardict-btn ${className}`;
  return btn;
}

function ensureSyncTimer() {
  const want = window === window.top || isOverlayHost();
  if (want && !syncTimer) {
    syncTimer = setInterval(syncTick, POLL.syncSeconds * 1000);
  } else if (!want && syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

ensureSyncTimer();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.overlayOffset) {
    const saved = changes.overlayOffset.newValue;
    overlayOffset =
      saved && typeof saved.left === "number" && typeof saved.top === "number" ? saved : null;
  }
  if (changes.selectedGameId) {
    clearSessionQueues(true);
    if (enabledCache && !document.hidden) syncTick();
  }
  if (changes.enabled) {
    enabledCache = Boolean(changes.enabled.newValue);
    if (enabledCache) {
      syncTick();
    } else {
      resetSessionState();
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncTick();
});

chrome.storage.local.get("enabled", ({ enabled }) => {
  enabledCache = Boolean(enabled);
  if (enabledCache) syncTick();
});

function clearSessionQueues(keepPresence) {
  voteQueue.length = 0;
  kickQueue.length = 0;
  momentQueue.length = 0;
  pendingBreakdowns.length = 0;
  handled.clear();
  voted.clear();
  shownMoments.clear();
  pendingPenalty = null;
  penaltyHandledKey = null;
  gamePickerOpen = false;
  syncInFlight = false;
  clearAllTracked();
  if (overlayEl) clearOverlay();
  busy = false;
  if (!keepPresence) presence = null;
}

function resetSessionState() {
  clearSessionQueues(false);
}

function syncTick() {
  ensureSyncTimer();
  if (!isOverlayHost() || document.hidden || overlayEl || busy || gamePickerOpen || syncInFlight) {
    return;
  }
  if (!chrome.runtime || !chrome.runtime.id) return;
  if (!enabledCache) return;

  syncInFlight = true;
  try {
    chrome.runtime.sendMessage({ type: "sync" }, (res) => {
      syncInFlight = false;
      if (chrome.runtime.lastError) return;
      if (!enabledCache) return;
      if (res && res.matchOver) {
        enabledCache = false;
        resetSessionState();
        return;
      }
      if (res && res.needGamePick && res.games && res.games.length) {
        showGamePicker(res.games);
        return;
      }
      presence = res && res.presence === "watching" ? "watching" : "away";
      if (res && res.penaltyShootout) {
        queuePenalty(res.penaltyShootout);
      }
      if (presence === "away") {
        handleAwaySync(res);
      } else {
        handleWatchingSync(res);
      }
    });
  } catch (_e) {
    syncInFlight = false;
  }
}

function handleWatchingSync(res) {
  momentQueue.length = 0;
  ingestPenaltyKicks(res && res.penaltyKicks ? res.penaltyKicks : []);
  ingestViewerPolls(res && res.activePolls ? res.activePolls : []);
  tryStartPenalty();
  tryStartPenaltyKick();
  tryStartVote();
  tryStartBreakdown(true);
  scheduleBreakdownWake();
}

function handleAwaySync(res) {
  voteQueue.length = 0;
  if (!(res && res.penaltyShootout)) {
    ingestGoalMoments(res && res.goalMoments ? res.goalMoments : []);
  }
  ingestPenaltyKicks(res && res.penaltyKicks ? res.penaltyKicks : []);
  ingestAwayBreakdownPolls(res && res.activePolls ? res.activePolls : []);
  tryStartPenalty();
  tryStartPenaltyKick();
  tryStartGoalMoment();
  tryStartBreakdown(false);
  scheduleBreakdownWake();
}

function queuePenalty(shootout) {
  if (!shootout || shootout.fixtureId == null) return;
  const key = `penalty:${shootout.fixtureId}`;
  if (penaltyHandledKey === key) return;
  if (pendingPenalty && pendingPenalty.fixtureId === shootout.fixtureId) return;
  pendingPenalty = shootout;
}

function tryStartPenalty() {
  if (busy || overlayEl || gamePickerOpen || !pendingPenalty) return;
  const shootout = pendingPenalty;
  pendingPenalty = null;
  const key = `penalty:${shootout.fixtureId}`;
  if (penaltyHandledKey === key) return;
  busy = true;
  showPenaltyPredict(shootout, () => {
    penaltyHandledKey = key;
    busy = false;
    tryStartPenalty();
    tryStartPenaltyKick();
    resumeAfterOverlay();
  });
}

function ingestPenaltyKicks(polls) {
  const now = Date.now();
  for (const poll of polls) {
    if (!poll || !poll.question || handled.has(poll.question)) continue;
    const opened = Date.parse(poll.openedAt);
    if (Number.isNaN(opened)) continue;
    const decisionMs = (POLL.penaltyDecisionSeconds || 45) * 1000;
    const voteEnd = opened + decisionMs;
    const resultsMs = POLL.countShowSeconds * 1000 + RESULTS_SHOW_MS;
    if (now > voteEnd + resultsMs) {
      handled.add(poll.question);
      continue;
    }
    handled.add(poll.question);
    kickQueue.push({ question: poll.question, opened });
  }
}

function tryStartPenaltyKick() {
  while (!busy && !overlayEl && !gamePickerOpen && !pendingPenalty && kickQueue.length) {
    const kick = kickQueue.shift();
    const decisionMs = (POLL.penaltyDecisionSeconds || 45) * 1000;
    const voteEnd = kick.opened + decisionMs;
    if (Date.now() >= voteEnd) continue;
    busy = true;
    showPenaltyDirection(kick, voteEnd, () => {
      busy = false;
      tryStartPenalty();
      tryStartPenaltyKick();
      resumeAfterOverlay();
    });
    return;
  }
}

function ingestViewerPolls(polls) {
  const now = Date.now();
  for (const poll of polls) {
    if (handled.has(poll.question)) continue;
    const opened = Date.parse(poll.openedAt);
    if (Number.isNaN(opened)) continue;
    const voteEnd = opened + POLL.decisionSeconds * 1000;
    if (now >= voteEnd && !voted.has(poll.question)) {
      scheduleViewerBreakdown(poll.question, opened);
      continue;
    }
    if (now >= voteEnd) continue;
    if (voteQueue.some((p) => p.question === poll.question)) continue;
    if (voted.has(poll.question)) {
      scheduleViewerBreakdown(poll.question, opened);
      continue;
    }
    voteQueue.push({ question: poll.question, openedAt: poll.openedAt, opened });
  }
}

function ingestAwayBreakdownPolls(polls) {
  const now = Date.now();
  const displayMs = POLL.countShowSeconds * 1000 + RESULTS_SHOW_MS;
  for (const poll of polls) {
    if (handled.has(poll.question)) continue;
    const opened = Date.parse(poll.openedAt);
    if (Number.isNaN(opened)) continue;
    const showAt = opened + POLL.resultsDelaySeconds * 1000;
    if (now >= showAt + displayMs) {
      handled.add(poll.question);
      continue;
    }
    scheduleAwayBreakdown(poll.question, opened);
  }
}

function ingestGoalMoments(moments) {
  for (const moment of moments) {
    if (!moment || !moment.key || shownMoments.has(moment.key)) continue;
    if (momentQueue.some((m) => m.key === moment.key)) continue;
    momentQueue.push(moment);
  }
}

function scheduleViewerBreakdown(question, opened) {
  scheduleBreakdown(question, opened, true);
}

function scheduleAwayBreakdown(question, opened) {
  scheduleBreakdown(question, opened, false);
}

function scheduleBreakdown(question, opened, requireVote) {
  if (handled.has(question)) return;
  const showAt = opened + POLL.resultsDelaySeconds * 1000;
  if (pendingBreakdowns.some((b) => b.question === question)) return;
  if (requireVote && !voted.has(question)) {
    if (Date.now() >= showAt) handled.add(question);
    return;
  }
  pendingBreakdowns.push({ question, showAt });
  pendingBreakdowns.sort((a, b) => a.showAt - b.showAt);
  scheduleBreakdownWake();
}

function scheduleBreakdownWake() {
  if (breakdownWakeTimer) {
    clearTimeout(breakdownWakeTimer);
    breakdownWakeTimer = null;
  }
  if (!pendingBreakdowns.length || busy || overlayEl || gamePickerOpen) {
    return;
  }
  const delay = Math.max(0, pendingBreakdowns[0].showAt - Date.now());
  breakdownWakeTimer = setTimeout(() => {
    breakdownWakeTimer = null;
    tryStartPenalty();
    tryStartPenaltyKick();
    resumeAfterOverlay();
  }, delay);
}

function resumeAfterOverlay() {
  if (presence === "away") {
    voteQueue.length = 0;
    tryStartBreakdown(false);
    tryStartGoalMoment();
    return;
  }
  momentQueue.length = 0;
  tryStartBreakdown(true);
  tryStartVote();
}

function tryStartVote() {
  if (presence === "away") {
    voteQueue.length = 0;
    return;
  }
  while (!busy && !overlayEl && !gamePickerOpen && !pendingPenalty && !kickQueue.length && voteQueue.length) {
    const poll = voteQueue.shift();
    const voteEnd = poll.opened + POLL.decisionSeconds * 1000;
    if (Date.now() >= voteEnd) {
      handled.add(poll.question);
      continue;
    }
    busy = true;
    showPoll(poll, voteEnd);
    return;
  }
}

function tryStartGoalMoment() {
  if (presence !== "away") {
    momentQueue.length = 0;
    return;
  }
  if (busy || overlayEl || gamePickerOpen || pendingPenalty || kickQueue.length || !momentQueue.length) {
    return;
  }
  const moment = momentQueue.shift();
  busy = true;
  showGoalMoment(moment, () => {
    shownMoments.add(moment.key);
    busy = false;
    tryStartPenaltyKick();
    resumeAfterOverlay();
  });
}

function tryStartBreakdown(requireVote) {
  if (busy || overlayEl || gamePickerOpen || pendingPenalty || kickQueue.length || !pendingBreakdowns.length) {
    return;
  }
  const next = pendingBreakdowns[0];
  if (Date.now() < next.showAt) return;
  pendingBreakdowns.shift();
  busy = true;
  showBreakdown(next.question, () => {
    handled.add(next.question);
    busy = false;
    scheduleBreakdownWake();
    tryStartPenaltyKick();
    resumeAfterOverlay();
  });
}

function showGamePicker(games, options) {
  const preview = Boolean(options && options.preview);
  if (overlayEl || gamePickerOpen) return;
  gamePickerOpen = true;
  busy = true;

  const { el, content } = makeCard({ draggable: false });
  overlayEl = el;

  div(content, "Pick a live match.", {
    className: "vardict-heading"
  });

  const buttons = [];
  games.forEach((game) => {
    const btn = makeButton("vardict-btn--block");
    btn.textContent = game.label;
    btn.addEventListener("click", () => {
      if (preview) {
        gamePickerOpen = false;
        busy = false;
        clearOverlay();
        return;
      }
      btn.disabled = true;
      chrome.runtime.sendMessage(
        { type: "selectGame", gameId: game.id, label: game.label },
        () => {
          if (chrome.runtime.lastError) {
            btn.disabled = false;
            return;
          }
          gamePickerOpen = false;
          busy = false;
          clearOverlay();
          syncTick();
        }
      );
    });
    content.appendChild(btn);
    buttons.push(btn);
  });

  const unbindKeys = bindOverlayKeyboard(buttons);

  if (!mountOverlay(el)) {
    unbindKeys();
    gamePickerOpen = false;
    busy = false;
    overlayEl = null;
    return;
  }

  overlayCleanup = () => {
    unbindKeys();
  };
}

function makePenDots(parent, shots, interactive) {
  const row = document.createElement("div");
  row.className = "vardict-pen-row";
  const dots = [];
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "vardict-pen-dot";
    if (shots[i]) dot.classList.add("is-goal");
    if (!interactive) {
      dot.disabled = true;
    } else {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        shots[i] = !shots[i];
        dot.classList.toggle("is-goal", shots[i]);
      });
    }
    row.appendChild(dot);
    dots.push(dot);
  }
  parent.appendChild(row);
  return dots;
}

function penaltyKickLabel(question) {
  const parts = String(question || "").split(" · ");
  if (parts.length >= 4) {
    const stamp = parts[2];
    const who = parts.slice(3).join(" · ");
    return `Penalty · ${who}${stamp ? ` · ${stamp}` : ""}`;
  }
  return "Penalty kick";
}

const PENALTY_DIR_LAYOUT = [
  "Top Left",
  null,
  "Top Right",
  null,
  "Middle",
  null,
  "Bottom Left",
  null,
  "Bottom Right"
];

function showPenaltyDirection(kick, voteEnd, done, options) {
  const preview = Boolean(options && options.preview);
  let selected = null;
  let finalized = false;
  const { el, content } = makeCard();
  overlayEl = el;
  const msLeft = Math.max(1000, voteEnd - Date.now());
  const resultsMs = (POLL.penaltyResultsSeconds || 8) * 1000;

  div(content, penaltyKickLabel(kick.question), {
    fontSize: "16px",
    fontWeight: "700",
    lineHeight: "1.25",
    marginBottom: "8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  });
  div(content, "Where will they put it?", {
    className: "vardict-muted",
    marginBottom: "14px"
  });

  const grid = document.createElement("div");
  grid.className = "vardict-dir-grid";
  const buttons = [];
  PENALTY_DIR_LAYOUT.forEach((label) => {
    const cell = document.createElement("div");
    cell.className = label
      ? "vardict-dir-cell"
      : "vardict-dir-cell vardict-dir-cell--empty";
    if (label) {
      const btn = makeButton("vardict-btn--dir");
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (finalized) return;
        selected = label;
        buttons.forEach((b) => b.classList.toggle("vardict-btn--selected", b === btn));
        note.textContent = preview ? "Preview results…" : "Sending…";
        finalize(true);
      });
      cell.appendChild(btn);
      buttons.push(btn);
    }
    grid.appendChild(cell);
  });
  content.appendChild(grid);

  const note = div(content, `${Math.ceil(msLeft / 1000)}s`, {
    className: "vardict-muted",
    marginTop: "14px"
  });

  const unbindKeys = bindOverlayKeyboard(buttons, {
    isActive: () => !finalized
  });

  const countdown = trackInterval(() => {
    if (finalized) return;
    const secs = Math.ceil((voteEnd - Date.now()) / 1000);
    if (secs > 0 && !selected) note.textContent = `${secs}s`;
  }, 1000);

  function showDirectionResults(choices) {
    content.textContent = "";
    div(content, "Community picks", { className: "vardict-heading" });
    const byChoice = new Map();
    (choices || []).forEach((row) => {
      if (row && row.choice != null) byChoice.set(row.choice, row);
    });
    const list = document.createElement("div");
    list.className = "vardict-dir-results";
    PENALTY_DIR_LAYOUT.forEach((label) => {
      const cell = document.createElement("div");
      if (!label) {
        cell.className = "vardict-dir-result-cell vardict-dir-result-cell--empty";
        list.appendChild(cell);
        return;
      }
      cell.className = "vardict-dir-result-cell";
      const row = byChoice.get(label) || { choice: label, percent: 0 };
      const name = document.createElement("span");
      name.className = "vardict-dir-result-name";
      name.textContent = row.choice;
      const pct = document.createElement("span");
      pct.className = "vardict-dir-result-pct";
      pct.textContent = `${row.percent}%`;
      cell.appendChild(name);
      cell.appendChild(pct);
      list.appendChild(cell);
    });
    content.appendChild(list);
    trackTimeout(() => {
      clearOverlay();
      done();
    }, resultsMs);
  }

  function previewDirectionChoices() {
    const counts = [28, 14, 22, 18, 18];
    const total = counts.reduce((a, b) => a + b, 0);
    const raw = counts.map((c) => (c * 100) / total);
    const floors = raw.map((r) => Math.floor(r));
    let rem = 100 - floors.reduce((a, b) => a + b, 0);
    const order = raw
      .map((r, i) => ({ i, frac: r - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem; k++) floors[order[k % order.length].i] += 1;
    return PENALTY_DIRECTIONS.map((choice, i) => ({
      choice,
      count: counts[i],
      percent: floors[i]
    }));
  }

  function fetchResults() {
    if (preview) {
      showDirectionResults(previewDirectionChoices());
      return;
    }
    chrome.runtime.sendMessage({ type: "penaltyDirectionBreakdown", question: kick.question }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok || !Array.isArray(res.choices)) {
        clearOverlay();
        done();
        return;
      }
      showDirectionResults(res.choices);
    });
  }

  function finalize(save) {
    if (finalized) return;
    if (save && !selected) return;
    finalized = true;
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
    buttons.forEach((b) => {
      b.disabled = true;
    });

    if (!save) {
      clearOverlay();
      done();
      return;
    }

    if (preview) {
      fetchResults();
      return;
    }

    voted.add(kick.question);
    let settled = false;
    const failSafe = trackTimeout(() => {
      if (settled) return;
      settled = true;
      fetchResults();
    }, VOTE_SAVE_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      { type: "penaltyDirectionVote", question: kick.question, choice: selected },
      () => {
        if (settled) return;
        settled = true;
        clearTracked(failSafe);
        fetchResults();
      }
    );
  }

  const maxTimer = trackTimeout(() => finalize(false), msLeft);

  if (!mountOverlay(el)) {
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
    overlayEl = null;
    done();
    return;
  }

  overlayCleanup = () => {
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
  };
}

function showPenaltyPredict(shootout, done, options) {
  const preview = Boolean(options && options.preview);
  const decisionMs = (POLL.penaltyDecisionSeconds || 45) * 1000;
  const resultsMs = (POLL.penaltyResultsSeconds || 8) * 1000;
  const opened = Date.parse(shootout.openedAt);
  const voteEnd = Number.isNaN(opened) ? Date.now() + decisionMs : opened + decisionMs;
  const homeShots = [false, false, false, false, false];
  const awayShots = [false, false, false, false, false];
  let finalized = false;

  const { el, content } = makeCard();
  overlayEl = el;

  div(content, "Penalty shootout", { className: "vardict-heading" });
  div(content, "Tap the shots you think will score.", {
    className: "vardict-muted"
  });

  div(content, shootout.home, { className: "vardict-pen-team" });
  const homeDots = makePenDots(content, homeShots, true);

  div(content, shootout.away, { className: "vardict-pen-team" });
  const awayDots = makePenDots(content, awayShots, true);

  const note = div(content, "", { className: "vardict-muted", marginBottom: "10px" });
  const submit = makeButton("vardict-btn--block");
  submit.textContent = "Submit";
  submit.style.textAlign = "center";
  content.appendChild(submit);

  const focusItems = homeDots.concat(awayDots, submit);
  const unbindKeys = bindOverlayKeyboard(focusItems, {
    isActive: () => !finalized
  });

  function updateNote() {
    const secs = Math.max(0, Math.ceil((voteEnd - Date.now()) / 1000));
    note.textContent = secs > 0 ? `${secs}s` : "";
  }
  updateNote();
  const countdown = trackInterval(updateNote, 1000);

  function showCommunity(home, away) {
    content.textContent = "";
    div(content, "Community picks", { className: "vardict-heading" });
    div(content, shootout.home, { className: "vardict-pen-team" });
    makePenDots(content, home, false);
    div(content, shootout.away, { className: "vardict-pen-team" });
    makePenDots(content, away, false);
    trackTimeout(() => {
      clearOverlay();
      done();
    }, resultsMs);
  }

  function fetchAndShowCommunity() {
    if (preview) {
      showCommunity([true, true, false, true, false], [true, false, true, true, false]);
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "penaltyBreakdown",
        fixtureId: shootout.fixtureId,
        home: shootout.home,
        away: shootout.away
      },
      (res) => {
        if (chrome.runtime.lastError) {
          showCommunity(
            [false, false, false, false, false],
            [false, false, false, false, false]
          );
          return;
        }
        const home =
          res && res.ok && Array.isArray(res.home) ? res.home : [false, false, false, false, false];
        const away =
          res && res.ok && Array.isArray(res.away) ? res.away : [false, false, false, false, false];
        showCommunity(home, away);
      }
    );
  }

  function finalize(save) {
    if (finalized) return;
    finalized = true;
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
    submit.disabled = true;
    content.querySelectorAll(".vardict-pen-dot").forEach((d) => {
      d.disabled = true;
    });

    if (preview) {
      fetchAndShowCommunity();
      return;
    }

    if (!save) {
      chrome.storage.local.set({ penaltyDoneFixtureId: shootout.fixtureId }, fetchAndShowCommunity);
      return;
    }

    note.textContent = "Saving…";
    let settled = false;
    const failSafe = trackTimeout(() => {
      if (settled) return;
      settled = true;
      fetchAndShowCommunity();
    }, VOTE_SAVE_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      {
        type: "penaltyVote",
        fixtureId: shootout.fixtureId,
        home: shootout.home,
        away: shootout.away,
        homeShots,
        awayShots
      },
      () => {
        if (settled) return;
        settled = true;
        clearTracked(failSafe);
        fetchAndShowCommunity();
      }
    );
  }

  submit.addEventListener("click", () => finalize(true));
  const maxTimer = trackTimeout(
    () => finalize(false),
    Math.max(1000, voteEnd - Date.now())
  );

  if (!mountOverlay(el)) {
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
    overlayEl = null;
    done();
    return;
  }

  overlayCleanup = () => {
    unbindKeys();
    clearTracked(countdown);
    clearTracked(maxTimer);
  };
}

function showGoalMoment(moment, done) {
  const { el, content } = makeCard({ compact: true });
  overlayEl = el;

  div(content, moment.text, {
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.35"
  });

  if (!mountOverlay(el)) {
    overlayEl = null;
    busy = false;
    done();
    return;
  }
  trackTimeout(() => {
    clearOverlay();
    done();
  }, POLL.momentShowSeconds * 1000);
}

function showPoll(poll, voteEnd, options) {
  const preview = Boolean(options && options.preview);
  let selected = null;
  let finalized = false;
  let confirmTimer = null;
  let countdownTimer = null;

  const { el, content } = makeCard();
  overlayEl = el;
  const voteEndMs = voteEnd;
  const msLeft = Math.max(1000, voteEndMs - Date.now());

  div(content, poll.question, {
    fontSize: "16px",
    fontWeight: "700",
    lineHeight: "1.25",
    marginBottom: "16px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  });

  const row = div(content, "", { display: "flex", gap: "10px" });
  const buttons = POLL.options.map((label) => {
    const btn = makeButton("vardict-btn--vote");
    btn.textContent = label;
    btn.addEventListener("click", () => pick(label, btn));
    row.appendChild(btn);
    return btn;
  });

  function pick(label, btn) {
    if (finalized) return;
    selected = label;
    buttons.forEach((b) => {
      b.classList.toggle("vardict-btn--selected", b === btn);
    });
    note.textContent = `Sending in ${POLL.confirmSeconds}s…`;
    clearTracked(confirmTimer);
    confirmTimer = trackTimeout(finalize, POLL.confirmSeconds * 1000);
  }

  const note = div(content, `${Math.ceil(msLeft / 1000)}s`, {
    className: "vardict-muted",
    marginTop: "16px",
    marginBottom: "0"
  });
  const status = div(content, "", {
    marginTop: "8px",
    fontSize: "13px",
    fontWeight: "600",
    minHeight: "16px"
  });

  const validLabel = POLL.options[0] || "Valid";
  const invalidLabel = POLL.options[1] || "Invalid";
  const unbindKeys = bindOverlayKeyboard(buttons, {
    isActive: () => !finalized,
    onValidInvalid: (side) => {
      if (side === "valid") pick(validLabel, buttons[0]);
      else pick(invalidLabel, buttons[1]);
    }
  });

  if (!mountOverlay(el)) {
    unbindKeys();
    overlayEl = null;
    busy = false;
    tryStartVote();
    return;
  }
  const maxTimer = trackTimeout(finalize, msLeft);

  countdownTimer = trackInterval(() => {
    if (finalized) return;
    const secs = Math.ceil((voteEndMs - Date.now()) / 1000);
    if (secs <= 0) return;
    if (!confirmTimer) {
      note.textContent = `${secs}s`;
    }
  }, 1000);

  overlayCleanup = () => {
    unbindKeys();
    clearTracked(confirmTimer);
    clearTracked(maxTimer);
    clearTracked(countdownTimer);
  };

  function finishVoteUi(next) {
    clearOverlay();
    busy = false;
    if (next) next();
  }

  function finalize() {
    if (finalized) return;
    finalized = true;
    if (overlayCleanup) {
      overlayCleanup();
      overlayCleanup = null;
    }
    buttons.forEach((b) => (b.disabled = true));

    if (selected === null) {
      if (!preview) handled.add(poll.question);
      finishVoteUi(() => {
        if (!preview) tryStartVote();
      });
      return;
    }

    if (preview) {
      status.textContent = `Preview: ${selected} (not saved)`;
      trackTimeout(() => finishVoteUi(null), 800);
      return;
    }

    status.textContent = "Saving…";
    let settled = false;
    const failSafe = trackTimeout(() => {
      if (settled) return;
      settled = true;
      status.textContent = "Could not save your vote.";
      voted.add(poll.question);
      scheduleViewerBreakdown(poll.question, poll.opened);
      trackTimeout(() => {
        finishVoteUi(() => {
          tryStartBreakdown(true);
          tryStartVote();
        });
      }, 800);
    }, VOTE_SAVE_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      { type: "vote", choice: selected, question: poll.question },
      (res) => {
        if (settled) return;
        settled = true;
        clearTracked(failSafe);
        voted.add(poll.question);
        status.textContent =
          !chrome.runtime.lastError && res && res.ok
            ? `Recorded: ${selected}`
            : "Could not save your vote.";
        scheduleViewerBreakdown(poll.question, poll.opened);
        trackTimeout(() => {
          finishVoteUi(() => {
            tryStartBreakdown(true);
            tryStartVote();
          });
        }, 800);
      }
    );
  }
}

function showBreakdown(question, done) {
  const { el, content } = makeCard();
  overlayEl = el;
  let cancelled = false;
  let countTimer = null;
  let barTimer = null;

  div(content, question, {
    fontSize: "14px",
    fontWeight: "700",
    lineHeight: "1.25",
    marginBottom: "14px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  });
  const body = div(content, "Loading results…", { className: "vardict-muted", marginBottom: "0" });
  if (!mountOverlay(el)) {
    overlayEl = null;
    busy = false;
    done();
    return;
  }

  function finish() {
    if (cancelled) return;
    cancelled = true;
    clearTracked(countTimer);
    clearTracked(barTimer);
    clearOverlay();
    done();
  }

  chrome.runtime.sendMessage({ type: "breakdown", question }, (res) => {
    if (cancelled) return;
    if (chrome.runtime.lastError || !res || !res.ok || res.total <= POLL.resultsThreshold) {
      finish();
      return;
    }
    showVoteCounts(body, res.yes, res.no, res.total);
    countTimer = trackTimeout(() => {
      if (cancelled) return;
      renderBar(body, res.yes, res.no, res.total);
      barTimer = trackTimeout(finish, RESULTS_SHOW_MS);
    }, POLL.countShowSeconds * 1000);
  });
}

function applyOverlayPosition(el) {
  if (overlayOffset) {
    const maxLeft = Math.max(0, window.innerWidth - 380);
    const maxTop = Math.max(0, window.innerHeight - 80);
    const left = Math.min(maxLeft, Math.max(0, overlayOffset.left));
    const top = Math.min(maxTop, Math.max(0, overlayOffset.top));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    el.style.transform = "none";
    return;
  }
  el.style.left = "50%";
  el.style.top = "18px";
  el.style.transform = "translateX(-50%)";
}

function enableDrag(el) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let raf = 0;
  let pendingLeft = 0;
  let pendingTop = 0;

  function flushMove() {
    raf = 0;
    el.style.left = `${pendingLeft}px`;
    el.style.top = `${pendingTop}px`;
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest("button, input, a")) return;
    const rect = el.getBoundingClientRect();
    dragging = true;
    el.classList.add("vardict-dragging");
    startX = e.clientX;
    startY = e.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    el.style.left = `${originLeft}px`;
    el.style.top = `${originTop}px`;
    el.style.transform = "none";
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - el.offsetHeight);
    pendingLeft = Math.min(maxLeft, Math.max(0, originLeft + (e.clientX - startX)));
    pendingTop = Math.min(maxTop, Math.max(0, originTop + (e.clientY - startY)));
    if (!raf) raf = requestAnimationFrame(flushMove);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("vardict-dragging");
    if (raf) {
      cancelAnimationFrame(raf);
      flushMove();
    }
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (_err) {
      /* ignore */
    }
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    overlayOffset = { left, top };
    chrome.storage.local.set({ overlayOffset });
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
}

function makeCard(options) {
  const compact = options && options.compact;
  const draggable = !(options && options.draggable === false);
  const el = document.createElement("div");
  el.className = compact ? "vardict-glass vardict-glass--compact" : "vardict-glass";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: "380px",
    borderRadius: "12px",
    overflow: "hidden",
    fontFamily: "-apple-system, system-ui, sans-serif",
    color: "#ffffff"
  });
  applyOverlayPosition(el);
  const content = document.createElement("div");
  content.className = "vardict-glass-inner";
  Object.assign(content.style, {
    padding: compact ? "14px 18px" : "18px 20px",
    boxSizing: "border-box"
  });
  el.appendChild(content);
  if (draggable) enableDrag(el);
  else el.style.cursor = "default";
  return { el, content };
}

function div(parent, text, styles) {
  const d = document.createElement("div");
  if (text) d.textContent = text;
  if (styles && styles.className) {
    d.className = styles.className;
    delete styles.className;
  }
  Object.assign(d.style, styles || {});
  parent.appendChild(d);
  return d;
}

function clearOverlay() {
  if (typeof overlayCleanup === "function") {
    try {
      overlayCleanup();
    } catch (_err) {
      /* ignore */
    }
    overlayCleanup = null;
  }
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
}

function showVoteCounts(body, yes, no, total) {
  body.textContent = "";
  body.style.color = "#ffffff";

  div(body, `${total} vote${total === 1 ? "" : "s"}`, {
    fontSize: "14px",
    fontWeight: "700",
    marginBottom: "12px",
    textAlign: "center"
  });

  const row = div(body, "", {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    fontWeight: "600"
  });
  const y = document.createElement("span");
  y.textContent = `Valid ${yes}`;
  y.style.color = VALID_COLOR;
  const n = document.createElement("span");
  n.textContent = `Invalid ${no}`;
  n.style.color = INVALID_COLOR;
  row.appendChild(y);
  row.appendChild(n);
}

function renderBar(body, yes, no, total) {
  if (!total) {
    body.textContent = "";
    return;
  }
  const yesPct = Math.round((yes / total) * 100);
  const noPct = 100 - yesPct;

  body.textContent = "";
  body.style.color = "#ffffff";

  const labels = div(body, "", {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    fontWeight: "700",
    marginBottom: "8px"
  });
  const y = document.createElement("span");
  y.textContent = `Valid ${yesPct}%`;
  y.style.color = VALID_COLOR;
  const n = document.createElement("span");
  n.textContent = `Invalid ${noPct}%`;
  n.style.color = INVALID_COLOR;
  labels.appendChild(y);
  labels.appendChild(n);

  const bar = div(body, "", {
    display: "flex",
    height: "14px",
    borderRadius: "7px",
    overflow: "hidden",
    background: "#222222"
  });
  div(bar, "", { width: `${yesPct}%`, background: VALID_COLOR });
  div(bar, "", { width: `${noPct}%`, background: INVALID_COLOR });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "preview") return;
  if (!isOverlayHost()) return;
  sendResponse({ ok: runPreview(msg.kind) });
  return true;
});

function runPreview(kind) {
  if (typeof DEV_MODE === "undefined" || !DEV_MODE) return false;
  if (!isOverlayHost()) return false;

  if (overlayEl) clearOverlay();
  busy = false;
  gamePickerOpen = false;

  if (kind === "vote" || kind === "var") {
    busy = true;
    const question = kind === "var" ? PREVIEW.varQuestion : PREVIEW.question;
    showPoll(
      { question, opened: Date.now() },
      Date.now() + POLL.decisionSeconds * 1000,
      { preview: true }
    );
    return true;
  }

  if (kind === "goal") {
    busy = true;
    showGoalMoment({ key: "preview:goal", text: PREVIEW.goal }, () => {
      busy = false;
    });
    return true;
  }

  if (kind === "results") {
    busy = true;
    showPreviewBreakdown(PREVIEW.varQuestion, () => {
      busy = false;
    });
    return true;
  }

  if (kind === "kick") {
    busy = true;
    showPenaltyDirection(
      { question: PREVIEW.penaltyKick, opened: Date.now() },
      Date.now() + (POLL.penaltyDecisionSeconds || 45) * 1000,
      () => {
        busy = false;
      },
      { preview: true }
    );
    return true;
  }

  if (kind === "pens") {
    busy = true;
    showPenaltyPredict(
      {
        fixtureId: 0,
        home: "Home FC",
        away: "Away United",
        openedAt: new Date().toISOString()
      },
      () => {
        busy = false;
      },
      { preview: true }
    );
    return true;
  }

  if (kind === "picker") {
    showGamePicker(
      [
        { id: 1, label: "Premier League · Home FC vs Away United (1-0)" },
        { id: 2, label: "La Liga · Rojo vs Azul (0-0)" },
        { id: 3, label: "Champions League · Night vs Day (2-2)" }
      ],
      { preview: true }
    );
    return true;
  }

  return false;
}

function showPreviewBreakdown(question, done) {
  const { el, content } = makeCard();
  overlayEl = el;

  div(content, question, {
    fontSize: "15px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "14px"
  });
  const body = div(content, "", {});
  if (!mountOverlay(el)) {
    overlayEl = null;
    done();
    return;
  }
  showVoteCounts(body, 62, 38, 100);
  trackTimeout(() => {
    renderBar(body, 62, 38, 100);
    trackTimeout(() => {
      clearOverlay();
      done();
    }, RESULTS_SHOW_MS);
  }, POLL.countShowSeconds * 1000);
}
