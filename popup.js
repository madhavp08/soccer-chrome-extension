const checkbox = document.getElementById("enabled");
const stateEl = document.getElementById("state");
const devMode = typeof DEV_MODE !== "undefined" && DEV_MODE;

function render() {
  if (!checkbox.checked) {
    stateEl.textContent = "Off.";
    return;
  }
  chrome.storage.local.get(["selectedGameLabel", "vardictMode"]).then(({ selectedGameLabel, vardictMode }) => {
    const modeLabel =
      vardictMode && typeof MODES !== "undefined" && MODES[vardictMode]
        ? MODES[vardictMode].label
        : null;
    if (!modeLabel) {
      stateEl.textContent = "On. Choose Viewer or Moments on your page.";
      return;
    }
    if (selectedGameLabel) {
      stateEl.textContent = `On. ${modeLabel} — ${selectedGameLabel}.`;
      return;
    }
    stateEl.textContent = `On. ${modeLabel}. Pick a live match on your page.`;
  });
}

function sendPreview(kind) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      stateEl.textContent = "No active tab.";
      return;
    }
    const url = tab.url || "";
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://")) {
      stateEl.textContent = "Open a normal webpage first.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "preview", kind }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        stateEl.textContent = "Refresh the page, then try preview again.";
        return;
      }
      window.close();
    });
  });
}

chrome.storage.local.get("enabled").then(({ enabled }) => {
  checkbox.checked = Boolean(enabled);
  render();
});

checkbox.addEventListener("change", () => {
  if (checkbox.checked) {
    chrome.storage.local.set({ enabled: true });
  } else {
    chrome.storage.local.set({
      enabled: false,
      vardictMode: null,
      selectedGameId: null,
      selectedGameLabel: null,
      afEventsLen: null
    });
  }
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.selectedGameLabel || changes.enabled || changes.vardictMode)) {
    render();
  }
});

if (devMode) {
  const row = document.createElement("div");
  row.className = "preview-row";
  [["vote", "Vote"], ["goal", "Goal"], ["results", "Results"]].forEach(([kind, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => sendPreview(kind));
    row.appendChild(btn);
  });
  stateEl.insertAdjacentElement("afterend", row);
}
