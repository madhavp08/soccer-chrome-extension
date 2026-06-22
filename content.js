let overlayEl = null;
let selected = null;
let currentQuestion = "";

const OPTION_COLORS = ["#00b86b", "#e5342b"];
const CARD_BG = "#0b1020";
const PANEL_BG = "#131a30";

setInterval(tick, APIFOOTBALL_CONFIG.pollSeconds * 1000);

function tick() {
  if (document.hidden || overlayEl) return;
  chrome.storage.local.get("enabled").then(({ enabled }) => {
    if (!enabled) return;
    chrome.runtime.sendMessage({ type: "checkEvents" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.show && res.poll) showOverlay(res.poll);
    });
  });
}

function showOverlay(poll) {
  if (overlayEl) return;
  selected = null;
  currentQuestion = poll.question;

  overlayEl = document.createElement("div");
  Object.assign(overlayEl.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    width: "340px",
    background: CARD_BG,
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
    fontFamily: "-apple-system, system-ui, sans-serif",
    color: "#ffffff"
  });

  const content = document.createElement("div");
  Object.assign(content.style, {
    padding: "20px",
    minHeight: "190px",
    boxSizing: "border-box"
  });
  overlayEl.appendChild(content);

  const question = document.createElement("div");
  question.textContent = currentQuestion;
  Object.assign(question.style, {
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "1.3",
    marginBottom: poll.context ? "8px" : "16px"
  });
  content.appendChild(question);

  if (poll.context) {
    const context = document.createElement("div");
    context.textContent = poll.context;
    Object.assign(context.style, {
      fontSize: "12px",
      color: "#9aa3c0",
      marginBottom: "16px"
    });
    content.appendChild(context);
  }

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "10px" });
  content.appendChild(row);

  const buttons = POLL.options.map((label, index) => {
    const color = OPTION_COLORS[index] || "#0098da";
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: "1",
      padding: "12px 0",
      fontSize: "16px",
      fontWeight: "700",
      background: PANEL_BG,
      color: "#ffffff",
      border: `2px solid ${color}`,
      borderRadius: "10px",
      cursor: "pointer"
    });
    btn.addEventListener("click", () => {
      selected = label;
      buttons.forEach((b, i) => {
        const on = b === btn;
        b.style.background = on ? OPTION_COLORS[i] || "#0098da" : PANEL_BG;
        b.style.boxShadow = on ? "0 0 0 3px rgba(255,255,255,0.18)" : "none";
      });
    });
    row.appendChild(btn);
    return btn;
  });

  const note = document.createElement("div");
  note.textContent = `You have ${POLL.decisionSeconds} seconds to decide.`;
  Object.assign(note.style, {
    marginTop: "16px",
    fontSize: "12px",
    color: "#9aa3c0"
  });
  content.appendChild(note);

  const status = document.createElement("div");
  Object.assign(status.style, {
    marginTop: "8px",
    fontSize: "13px",
    fontWeight: "600",
    minHeight: "16px"
  });
  content.appendChild(status);

  document.body.appendChild(overlayEl);

  setTimeout(() => finalize(buttons, note, status), POLL.decisionSeconds * 1000);
}

function finalize(buttons, note, status) {
  buttons.forEach((b) => (b.disabled = true));

  if (selected === null) {
    note.textContent = "Time's up. No option selected.";
    removeSoon();
    return;
  }

  status.textContent = "Saving...";
  chrome.runtime.sendMessage(
    { type: "vote", choice: selected, question: currentQuestion },
    (res) => {
      if (chrome.runtime.lastError) {
        status.textContent = "Could not save your vote.";
      } else if (res && res.ok) {
        status.textContent = `Recorded: ${selected}`;
      } else {
        status.textContent = (res && res.error) || "Could not save your vote.";
      }
      removeSoon();
    }
  );
}

function removeSoon() {
  setTimeout(() => {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }, 2500);
}
