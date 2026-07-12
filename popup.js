const checkbox = document.getElementById("enabled");
const devRoot = document.getElementById("dev-root");
const devMode = typeof DEV_MODE !== "undefined" && DEV_MODE;

function setViewerTabAndEnable() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const url = (tab && tab.url) || "";
    const usable =
      tab &&
      typeof tab.id === "number" &&
      !url.startsWith("chrome://") &&
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("edge://") &&
      !url.startsWith("about:");
    chrome.storage.local.set({
      enabled: true,
      viewerTabId: usable ? tab.id : null,
      vardictMode: null
    });
  });
}

function turnOff() {
  chrome.storage.local.set({
    enabled: false,
    selectedGameId: null,
    selectedGameLabel: null,
    afEventsLen: null,
    viewerTabId: null,
    pendingGoalMoments: [],
    vardictMode: null
  });
}

function sendPreview(kind) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    const url = tab.url || "";
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://")) {
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "preview", kind }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      window.close();
    });
  });
}

chrome.storage.local.get("enabled").then(({ enabled }) => {
  checkbox.checked = Boolean(enabled);
});

checkbox.addEventListener("change", () => {
  if (checkbox.checked) {
    setViewerTabAndEnable();
  } else {
    turnOff();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    checkbox.checked = Boolean(changes.enabled.newValue);
  }
});

if (devMode && devRoot) {
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
  devRoot.appendChild(row);
}
