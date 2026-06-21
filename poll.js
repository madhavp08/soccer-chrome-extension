let selected = null;

const questionEl = document.getElementById("question");
const optionsEl = document.getElementById("options");
const noteEl = document.getElementById("note");
const statusEl = document.getElementById("status");

questionEl.textContent = POLL.question;
noteEl.textContent = `You have ${POLL.decisionSeconds} seconds to decide.`;

const buttons = POLL.options.map((label) => {
  const btn = document.createElement("button");
  btn.className = "option";
  btn.textContent = label;
  btn.addEventListener("click", () => select(label, btn));
  optionsEl.appendChild(btn);
  return btn;
});

function select(label, btn) {
  selected = label;
  buttons.forEach((b) => b.classList.toggle("selected", b === btn));
}

setTimeout(finalize, POLL.decisionSeconds * 1000);

async function finalize() {
  buttons.forEach((b) => (b.disabled = true));

  if (selected === null) {
    statusEl.textContent = "Time's up. No option selected.";
    closeSoon();
    return;
  }

  statusEl.textContent = "Saving...";
  try {
    await submitVote(selected);
    statusEl.textContent = `Recorded: ${selected}`;
  } catch (err) {
    statusEl.textContent = err.message;
  }
  closeSoon();
}

function closeSoon() {
  setTimeout(() => window.close(), 2500);
}

async function submitVote(choice) {
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
    body: JSON.stringify({ question: POLL.question, choice })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Save failed (${res.status}): ${detail}`);
  }
}
