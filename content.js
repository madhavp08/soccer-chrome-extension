let overlayEl = null;
let selected = null;
let currentQuestion = "";

const CARD_BG = "#121212";

setInterval(tick, APIFOOTBALL_CONFIG.pollSeconds * 1000);

function tick() {
  if (document.hidden || overlayEl) return;
  if (!chrome.runtime || !chrome.runtime.id) return;
  try {
    chrome.runtime.sendMessage({ type: "checkEvents" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.show && res.poll) showOverlay(res.poll);
    });
  } catch (e) {}
}

function showOverlay(poll) {
  if (overlayEl) return;
  selected = null;
  currentQuestion = poll.question;
  let finalized = false;
  let confirmTimer = null;

  overlayEl = document.createElement("div");
  Object.assign(overlayEl.style, {
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
    minHeight: "180px",
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
      color: "#888888",
      marginBottom: "16px"
    });
    content.appendChild(context);
  }

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "10px" });
  content.appendChild(row);

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
    btn.addEventListener("click", () => {
      selected = label;
      buttons.forEach((b) => {
        const on = b === btn;
        b.style.background = on ? "#ffffff" : "transparent";
        b.style.color = on ? "#111111" : "#ffffff";
      });
      note.textContent = `Submitting in ${POLL.confirmSeconds}s unless you change it.`;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(finalize, POLL.confirmSeconds * 1000);
    });
    row.appendChild(btn);
    return btn;
  });

  const note = document.createElement("div");
  note.textContent = `You have ${POLL.decisionSeconds} seconds to decide.`;
  Object.assign(note.style, {
    marginTop: "16px",
    fontSize: "12px",
    color: "#888888"
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

  const maxTimer = setTimeout(finalize, POLL.decisionSeconds * 1000);

  function finalize() {
    if (finalized) return;
    finalized = true;
    clearTimeout(confirmTimer);
    clearTimeout(maxTimer);
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
}

function removeSoon() {
  setTimeout(() => {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }, 2500);
}
