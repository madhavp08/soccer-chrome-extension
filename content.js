let overlayEl = null;
let busy = false;
let gamePickerOpen = false;
let modePickerOpen = false;
let currentMode = null;

const voteQueue = [];
const momentQueue = [];
const pendingBreakdowns = [];
const handled = new Set();
const voted = new Set();
const shownMoments = new Set();

const CARD_BG = "#121212";
const YES_COLOR = "#00b86b";
const NO_COLOR = "#e5342b";
const YES_KEYS = new Set(["a", "j"]);
const NO_KEYS = new Set(["d", "l"]);
const RESULTS_SHOW_MS = 6000;

setInterval(syncTick, POLL.syncSeconds * 1000);

function syncTick() {
  if (document.hidden || overlayEl || busy || gamePickerOpen || modePickerOpen) return;
  if (!chrome.runtime || !chrome.runtime.id) return;
  try {
    chrome.storage.local.get("enabled", ({ enabled }) => {
      if (!enabled) {
        gamePickerOpen = false;
        modePickerOpen = false;
        currentMode = null;
        return;
      }
      chrome.runtime.sendMessage({ type: "sync" }, (res) => {
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
  } catch (e) {}
}

function handleViewerSync(res) {
  ingestViewerPolls(res && res.activePolls ? res.activePolls : []);
  tryStartVote();
  tryStartBreakdown(true);
}

function handleMomentsSync(res) {
  ingestGoalMoments(res && res.goalMoments ? res.goalMoments : []);
  ingestMomentsBreakdownPolls(res && res.activePolls ? res.activePolls : []);
  tryStartGoalMoment();
  tryStartBreakdown(false);
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
  for (const poll of polls) {
    if (handled.has(poll.question)) continue;
    const opened = Date.parse(poll.openedAt);
    if (Number.isNaN(opened)) continue;
    const showAt = opened + POLL.resultsDelaySeconds * 1000;
    if (now >= showAt + RESULTS_SHOW_MS) {
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
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "8px"
  });
  div(content, "You can change this only by turning VARdict off.", {
    fontSize: "12px",
    color: "#888888",
    marginBottom: "16px"
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
    const btn = document.createElement("button");
    btn.type = "button";
    Object.assign(btn.style, {
      display: "block",
      width: "100%",
      marginBottom: "8px",
      padding: "12px",
      fontSize: "14px",
      fontWeight: "600",
      background: "transparent",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "8px",
      cursor: "pointer",
      textAlign: "left"
    });
    const title = document.createElement("div");
    title.textContent = mode.title;
    title.style.fontWeight = "700";
    title.style.marginBottom = "4px";
    const hint = document.createElement("div");
    hint.textContent = mode.hint;
    hint.style.fontSize = "12px";
    hint.style.color = "#888888";
    hint.style.fontWeight = "400";
    btn.appendChild(title);
    btn.appendChild(hint);
    btn.addEventListener("click", () => {
      btn.disabled = true;
      chrome.runtime.sendMessage({ type: "selectMode", mode: mode.id }, () => {
        modePickerOpen = false;
        busy = false;
        clearOverlay();
      });
    });
    content.appendChild(btn);
  });

  document.body.appendChild(el);
}

function showGamePicker(games) {
  if (overlayEl || gamePickerOpen) return;
  gamePickerOpen = true;
  busy = true;

  const { el, content } = makeCard();
  overlayEl = el;

  div(content, "Which match should VARdict follow?", {
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "8px"
  });
  div(content, "You can change this only by turning VARdict off.", {
    fontSize: "12px",
    color: "#888888",
    marginBottom: "16px"
  });

  games.forEach((game) => {
    const btn = document.createElement("button");
    btn.textContent = game.label;
    Object.assign(btn.style, {
      display: "block",
      width: "100%",
      marginBottom: "8px",
      padding: "12px",
      fontSize: "14px",
      fontWeight: "600",
      background: "transparent",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "8px",
      cursor: "pointer",
      textAlign: "left"
    });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      chrome.runtime.sendMessage(
        { type: "selectGame", gameId: game.id, label: game.label },
        () => {
          gamePickerOpen = false;
          busy = false;
          clearOverlay();
        }
      );
    });
    content.appendChild(btn);
  });

  document.body.appendChild(el);
}

function showGoalMoment(moment, done) {
  const { el, content } = makeCard();
  overlayEl = el;

  div(content, moment.text, {
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.35"
  });

  document.body.appendChild(el);
  setTimeout(() => {
    clearOverlay();
    done();
  }, POLL.momentShowSeconds * 1000);
}

function showPoll(poll, voteEnd) {
  let selected = null;
  let finalized = false;
  let confirmTimer = null;

  const { el, content } = makeCard();
  overlayEl = el;
  const msLeft = Math.max(1000, voteEnd - Date.now());

  div(content, poll.question, {
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "16px"
  });

  const row = div(content, "", { display: "flex", gap: "10px" });
  const buttons = POLL.options.map((label) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: "1",
      padding: "12px 0",
      fontSize: "16px",
      fontWeight: "600",
      background: "transparent",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "8px",
      cursor: "pointer"
    });
    btn.addEventListener("click", () => pick(label, btn));
    row.appendChild(btn);
    return btn;
  });

  function pick(label, btn) {
    selected = label;
    buttons.forEach((b) => {
      const on = b === btn;
      b.style.background = on ? "#ffffff" : "transparent";
      b.style.color = on ? "#111111" : "#ffffff";
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
    marginTop: "16px",
    fontSize: "12px",
    color: "#888888"
  });
  const status = div(content, "", {
    marginTop: "8px",
    fontSize: "13px",
    fontWeight: "600",
    minHeight: "16px"
  });

  document.body.appendChild(el);
  const maxTimer = setTimeout(finalize, msLeft);

  function finalize() {
    if (finalized) return;
    finalized = true;
    document.removeEventListener("keydown", onKey, true);
    clearTimeout(confirmTimer);
    clearTimeout(maxTimer);
    buttons.forEach((b) => (b.disabled = true));

    if (selected === null) {
      clearOverlay();
      handled.add(poll.question);
      busy = false;
      tryStartVote();
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

  div(content, question, {
    fontSize: "15px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: "14px"
  });
  const body = div(content, "Loading results…", { fontSize: "12px", color: "#888888" });
  document.body.appendChild(el);

  chrome.runtime.sendMessage({ type: "breakdown", question }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok || res.total <= POLL.resultsThreshold) {
      clearOverlay();
      done();
      return;
    }
    renderBar(body, res.yes, res.no, res.total);
    setTimeout(() => {
      clearOverlay();
      done();
    }, RESULTS_SHOW_MS);
  });
}

function makeCard() {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    width: "340px",
    background: CARD_BG,
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    fontFamily: "-apple-system, system-ui, sans-serif",
    color: "#ffffff"
  });
  const content = document.createElement("div");
  Object.assign(content.style, {
    padding: "20px",
    minHeight: "150px",
    boxSizing: "border-box"
  });
  el.appendChild(content);
  return { el, content };
}

function div(parent, text, styles) {
  const d = document.createElement("div");
  if (text) d.textContent = text;
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
