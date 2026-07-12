let overlayEl = null;
let busy = false;
let gamePickerOpen = false;
let presence = null;
let syncInFlight = false;
let breakdownWakeTimer = null;
let overlayOffset = null;

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
  if (area !== "local") return;
  if (changes.overlayOffset) {
    const saved = changes.overlayOffset.newValue;
    overlayOffset =
      saved && typeof saved.left === "number" && typeof saved.top === "number" ? saved : null;
  }
  if (!changes.enabled) return;
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
  presence = null;
  syncInFlight = false;
  if (breakdownWakeTimer) {
    clearTimeout(breakdownWakeTimer);
    breakdownWakeTimer = null;
  }
  if (overlayEl) clearOverlay();
  busy = false;
}

function syncTick() {
  if (!isOverlayHost() || document.hidden || overlayEl || busy || gamePickerOpen || syncInFlight) {
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
        if (res && res.matchOver) {
          resetSessionState();
          return;
        }
        if (res && res.needGamePick && res.games && res.games.length) {
          showGamePicker(res.games);
          return;
        }
        presence = res && res.presence === "watching" ? "watching" : "away";
        if (presence === "away") {
          handleAwaySync(res);
        } else {
          handleWatchingSync(res);
        }
      });
    });
  } catch (e) {
    syncInFlight = false;
  }
}

function handleWatchingSync(res) {
  ingestViewerPolls(res && res.activePolls ? res.activePolls : []);
  tryStartVote();
  tryStartBreakdown(true);
  scheduleBreakdownWake();
}

function handleAwaySync(res) {
  ingestGoalMoments(res && res.goalMoments ? res.goalMoments : []);
  ingestAwayBreakdownPolls(res && res.activePolls ? res.activePolls : []);
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
    if (presence === "away") {
      tryStartBreakdown(false);
      tryStartGoalMoment();
    } else {
      tryStartBreakdown(true);
      tryStartVote();
    }
  }, delay);
}

function tryStartVote() {
  if (busy || overlayEl || gamePickerOpen || !voteQueue.length) return;
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
  if (busy || overlayEl || gamePickerOpen || !momentQueue.length) return;
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
  if (busy || overlayEl || gamePickerOpen || !pendingBreakdowns.length) {
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

function showGamePicker(games) {
  if (overlayEl || gamePickerOpen) return;
  gamePickerOpen = true;
  busy = true;

  const { el, content } = makeCard({ draggable: false });
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

  if (!mountOverlay(el)) {
    gamePickerOpen = false;
    busy = false;
    overlayEl = null;
  }
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

  if (!mountOverlay(el)) {
    document.removeEventListener("keydown", onKey, true);
    overlayEl = null;
    busy = false;
    return;
  }
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
  if (!mountOverlay(el)) {
    overlayEl = null;
    busy = false;
    done();
    return;
  }

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

function applyOverlayPosition(el) {
  if (overlayOffset) {
    el.style.left = `${overlayOffset.left}px`;
    el.style.top = `${overlayOffset.top}px`;
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
    const left = Math.min(maxLeft, Math.max(0, originLeft + (e.clientX - startX)));
    const top = Math.min(maxTop, Math.max(0, originTop + (e.clientY - startY)));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("vardict-dragging");
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
    width: "340px",
    borderRadius: "12px",
    overflow: "hidden",
    fontFamily: "-apple-system, system-ui, sans-serif",
    color: "#ffffff"
  });
  applyOverlayPosition(el);
  const content = document.createElement("div");
  content.className = "vardict-glass-inner";
  Object.assign(content.style, {
    padding: compact ? "14px 18px" : "20px",
    minHeight: compact ? "0" : "150px",
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
  if (!isOverlayHost() || overlayEl || busy || gamePickerOpen) return false;

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
  if (!mountOverlay(el)) {
    overlayEl = null;
    done();
    return;
  }
  showVoteCounts(body, 62, 38, 100);
  setTimeout(() => {
    renderBar(body, 62, 38, 100);
    setTimeout(() => {
      clearOverlay();
      done();
    }, RESULTS_SHOW_MS);
  }, POLL.countShowSeconds * 1000);
}
