let overlayEl = null;
let busy = false;
let gamePickerOpen = false;
let modePickerOpen = false;
let currentMode = null;
let syncInFlight = false;
let breakdownWakeTimer = null;

const voteQueue = [];
const momentQueue = [];
const pendingBreakdowns = [];
const handled = new Set();
const voted = new Set();
const shownMoments = new Set();

const YES_COLOR = "#00b86b";
const NO_COLOR = "#e5342b";
const YES_KEYS = new Set(["a", "j"]);
const NO_KEYS = new Set(["d", "l"]);
const RESULTS_SHOW_MS = 6000;

const PREVIEW = {
  question: "Yellow card for Example Player (Team), 67' — right call?",
  goal: "Goal · 67' — Example Player (Team)"
};

ensureOverlayStyles();
document.addEventListener("fullscreenchange", reparentOverlayIfNeeded);
document.addEventListener("webkitfullscreenchange", reparentOverlayIfNeeded);

function getOverlayRoot() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.body;
}

function mountOverlay(el) {
  const root = getOverlayRoot();
  if (root !== document.body && getComputedStyle(root).position === "static") {
    root.style.position = "relative";
  }
  root.appendChild(el);
}

function reparentOverlayIfNeeded() {
  if (!overlayEl || !overlayEl.parentNode) return;
  const root = getOverlayRoot();
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
    }
    .vardict-glass--compact .vardict-glass-inner {
      padding: 14px 18px;
      min-height: 0;
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
      margin-bottom: 8px;
      padding: 12px;
      font-size: 14px;
      text-align: left;
    }
    .vardict-btn--vote {
      flex: 1;
      padding: 12px 0;
      font-size: 16px;
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
  `;
  document.documentElement.appendChild(style);
}

function makeButton(className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `vardict-btn ${className}`;
  return btn;
}

setInterval(syncTick, POLL.syncSeconds * 1000);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;
  if (changes.enabled.newValue) {
    syncTick();
    return;
  }
  resetSessionState();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncTick();
});

chrome.storage.local.get("enabled", ({ enabled }) => {
  if (enabled) syncTick();
});

function resetSessionState() {
  voteQueue.length = 0;
  momentQueue.length = 0;
  pendingBreakdowns.length = 0;
  handled.clear();
  voted.clear();
  shownMoments.clear();
  gamePickerOpen = false;
  modePickerOpen = false;
  currentMode = null;
  syncInFlight = false;
  if (breakdownWakeTimer) {
    clearTimeout(breakdownWakeTimer);
    breakdownWakeTimer = null;
  }
  if (overlayEl) clearOverlay();
  busy = false;
}

function syncTick() {
  if (document.hidden || overlayEl || busy || gamePickerOpen || modePickerOpen || syncInFlight) {
    return;
  }
  if (!chrome.runtime || !chrome.runtime.id) return;
  syncInFlight = true;
  try {
    chrome.storage.local.get("enabled", ({ enabled }) => {
      if (!enabled) {
        resetSessionState();
        syncInFlight = false;
        return;
      }
      chrome.runtime.sendMessage({ type: "sync" }, (res) => {
        syncInFlight = false;
        if (chrome.runtime.lastError) return;
        if (res && res.needModePick) {
          showModePicker();
          return;
        }
        if (res && res.needGamePick && res.games && res.games.length) {
          showGamePicker(res.games);
          return;
        }
        currentMode = res && res.mode ? res.mode : null;
        if (currentMode === "moments") {
          handleMomentsSync(res);
        } else if (currentMode === "viewer") {
          handleViewerSync(res);
        }
      });
    });
  } catch (e) {
    syncInFlight = false;
  }
}

function handleViewerSync(res) {
  ingestViewerPolls(res && res.activePolls ? res.activePolls : []);
  tryStartVote();
  tryStartBreakdown(true);
  scheduleBreakdownWake();
}

function handleMomentsSync(res) {
  ingestGoalMoments(res && res.goalMoments ? res.goalMoments : []);
  ingestMomentsBreakdownPolls(res && res.activePolls ? res.activePolls : []);
  tryStartGoalMoment();
  tryStartBreakdown(false);
  scheduleBreakdownWake();
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

function ingestMomentsBreakdownPolls(polls) {
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
    scheduleMomentsBreakdown(poll.question, opened);
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

function scheduleMomentsBreakdown(question, opened) {
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
  if (!pendingBreakdowns.length || busy || overlayEl || gamePickerOpen || modePickerOpen) {
    return;
  }
  const delay = Math.max(0, pendingBreakdowns[0].showAt - Date.now());
  breakdownWakeTimer = setTimeout(() => {
    breakdownWakeTimer = null;
    if (currentMode === "moments") {
      tryStartBreakdown(false);
      tryStartGoalMoment();
    } else if (currentMode === "viewer") {
      tryStartBreakdown(true);
      tryStartVote();
    }
  }, delay);
}

function tryStartVote() {
  if (busy || overlayEl || gamePickerOpen || modePickerOpen || !voteQueue.length) return;
  const poll = voteQueue.shift();
  const voteEnd = poll.opened + POLL.decisionSeconds * 1000;
  if (Date.now() >= voteEnd) {
    handled.add(poll.question);
    return;
  }
  busy = true;
  showPoll(poll, voteEnd);
}

function tryStartGoalMoment() {
  if (busy || overlayEl || gamePickerOpen || modePickerOpen || !momentQueue.length) return;
  const moment = momentQueue.shift();
  busy = true;
  showGoalMoment(moment, () => {
    shownMoments.add(moment.key);
    busy = false;
    tryStartGoalMoment();
    tryStartBreakdown(false);
    tryStartVote();
  });
}

function tryStartBreakdown(requireVote) {
  if (busy || overlayEl || gamePickerOpen || modePickerOpen || !pendingBreakdowns.length) {
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
    tryStartBreakdown(requireVote);
    tryStartGoalMoment();
    tryStartVote();
  });
}

function showModePicker() {
  if (overlayEl || modePickerOpen) return;
  modePickerOpen = true;
  busy = true;

  const { el, content } = makeCard();
  overlayEl = el;

  div(content, "How are you following the match?", {
    className: "vardict-heading"
  });
  div(content, "You can change this only by turning VARdict off.", {
    className: "vardict-muted"
  });

  const modes = [
    {
      id: "viewer",
      title: "Viewer",
      hint: "Watching live — vote on cards and VAR."
    },
    {
      id: "moments",
      title: "Moments",
      hint: "Not watching — goal alerts and community results on cards & VAR."
    }
  ];

  modes.forEach((mode) => {
    const btn = makeButton("vardict-btn--block");
    const title = document.createElement("div");
    title.className = "vardict-btn-title";
    title.textContent = mode.title;
    const hint = document.createElement("div");
    hint.className = "vardict-btn-hint";
    hint.textContent = mode.hint;
    btn.appendChild(title);
    btn.appendChild(hint);
    btn.addEventListener("click", () => {
      btn.disabled = true;
      chrome.runtime.sendMessage({ type: "selectMode", mode: mode.id }, () => {
        if (chrome.runtime.lastError) {
          btn.disabled = false;
          return;
        }
        modePickerOpen = false;
        busy = false;
        clearOverlay();
        syncTick();
      });
    });
    content.appendChild(btn);
  });

  mountOverlay(el);
}

function showGamePicker(games) {
  if (overlayEl || gamePickerOpen) return;
  gamePickerOpen = true;
  busy = true;

  const { el, content } = makeCard();
  overlayEl = el;

  div(content, "Which match should VARdict follow?", {
    className: "vardict-heading"
  });
  div(content, "You can change this only by turning VARdict off.", {
    className: "vardict-muted"
  });

  games.forEach((game) => {
    const btn = makeButton("vardict-btn--block");
    btn.textContent = game.label;
    btn.addEventListener("click", () => {
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
  });

  mountOverlay(el);
}

function showGoalMoment(moment, done) {
  const { el, content } = makeCard({ compact: true });
  overlayEl = el;

  div(content, moment.text, {
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.35"
  });

  mountOverlay(el);
  setTimeout(() => {
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
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "16px"
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
    selected = label;
    buttons.forEach((b) => {
      b.classList.toggle("vardict-btn--selected", b === btn);
    });
    note.textContent = `Submitting in ${POLL.confirmSeconds}s unless you change it.`;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(finalize, POLL.confirmSeconds * 1000);
  }

  function onKey(e) {
    if (finalized) return;
    const k = e.key.toLowerCase();
    if (YES_KEYS.has(k)) {
      e.preventDefault();
      e.stopPropagation();
      pick("Yes", buttons[0]);
    } else if (NO_KEYS.has(k)) {
      e.preventDefault();
      e.stopPropagation();
      pick("No", buttons[1]);
    }
  }

  document.addEventListener("keydown", onKey, true);

  const note = div(content, `You have ${Math.ceil(msLeft / 1000)} seconds to decide.`, {
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

  mountOverlay(el);
  const maxTimer = setTimeout(finalize, msLeft);

  countdownTimer = setInterval(() => {
    if (finalized) return;
    const secs = Math.ceil((voteEndMs - Date.now()) / 1000);
    if (secs <= 0) return;
    if (!confirmTimer) {
      note.textContent = `You have ${secs} second${secs === 1 ? "" : "s"} to decide.`;
    }
  }, 1000);

  function finalize() {
    if (finalized) return;
    finalized = true;
    document.removeEventListener("keydown", onKey, true);
    clearTimeout(confirmTimer);
    clearTimeout(maxTimer);
    clearInterval(countdownTimer);
    buttons.forEach((b) => (b.disabled = true));

    if (selected === null) {
      clearOverlay();
      if (!preview) handled.add(poll.question);
      busy = false;
      if (!preview) tryStartVote();
      return;
    }

    if (preview) {
      status.textContent = `Preview: ${selected} (not saved)`;
      setTimeout(() => {
        clearOverlay();
        busy = false;
      }, 800);
      return;
    }

    status.textContent = "Saving…";
    chrome.runtime.sendMessage(
      { type: "vote", choice: selected, question: poll.question },
      (res) => {
        voted.add(poll.question);
        status.textContent =
          !chrome.runtime.lastError && res && res.ok
            ? `Recorded: ${selected}`
            : "Could not save your vote.";
        scheduleViewerBreakdown(poll.question, poll.opened);
        setTimeout(() => {
          clearOverlay();
          busy = false;
          tryStartBreakdown(true);
          tryStartVote();
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
    fontSize: "15px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "14px"
  });
  const body = div(content, "Loading results…", { className: "vardict-muted", marginBottom: "0" });
  mountOverlay(el);

  function finish() {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(countTimer);
    clearTimeout(barTimer);
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
    countTimer = setTimeout(() => {
      if (cancelled) return;
      renderBar(body, res.yes, res.no, res.total);
      barTimer = setTimeout(finish, RESULTS_SHOW_MS);
    }, POLL.countShowSeconds * 1000);
  });
}

function makeCard(options) {
  const compact = options && options.compact;
  const el = document.createElement("div");
  el.className = compact ? "vardict-glass vardict-glass--compact" : "vardict-glass";
  Object.assign(el.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    width: "340px",
    borderRadius: "12px",
    overflow: "hidden",
    fontFamily: "-apple-system, system-ui, sans-serif",
    color: "#ffffff"
  });
  const content = document.createElement("div");
  content.className = "vardict-glass-inner";
  Object.assign(content.style, {
    padding: compact ? "14px 18px" : "20px",
    minHeight: compact ? "0" : "150px",
    boxSizing: "border-box"
  });
  el.appendChild(content);
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
  y.textContent = `Yes ${yes}`;
  y.style.color = YES_COLOR;
  const n = document.createElement("span");
  n.textContent = `No ${no}`;
  n.style.color = NO_COLOR;
  row.appendChild(y);
  row.appendChild(n);
}

function renderBar(body, yes, no, total) {
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
  y.textContent = `Yes ${yesPct}%`;
  y.style.color = YES_COLOR;
  const n = document.createElement("span");
  n.textContent = `No ${noPct}%`;
  n.style.color = NO_COLOR;
  labels.appendChild(y);
  labels.appendChild(n);

  const bar = div(body, "", {
    display: "flex",
    height: "14px",
    borderRadius: "7px",
    overflow: "hidden",
    background: "#222222"
  });
  div(bar, "", { width: `${yesPct}%`, background: YES_COLOR });
  div(bar, "", { width: `${noPct}%`, background: NO_COLOR });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "preview") return;
  sendResponse({ ok: runPreview(msg.kind) });
  return true;
});

function runPreview(kind) {
  if (typeof DEV_MODE === "undefined" || !DEV_MODE) return false;
  if (overlayEl || busy || gamePickerOpen || modePickerOpen) return false;

  if (kind === "vote") {
    busy = true;
    showPoll(
      { question: PREVIEW.question, opened: Date.now() },
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
    showPreviewBreakdown(PREVIEW.question, () => {
      busy = false;
    });
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
  mountOverlay(el);
  showVoteCounts(body, 62, 38, 100);
  setTimeout(() => {
    renderBar(body, 62, 38, 100);
    setTimeout(() => {
      clearOverlay();
      done();
    }, RESULTS_SHOW_MS);
  }, POLL.countShowSeconds * 1000);
}
