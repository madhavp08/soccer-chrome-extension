const checkbox = document.getElementById("enabled");
const devRoot = document.getElementById("dev-root");
const devStatus = document.getElementById("dev-status");
const tabsEl = document.getElementById("tabs");
const panelMain = document.getElementById("panel-main");
const panelGames = document.getElementById("panel-games");
const gamesList = document.getElementById("games-list");
const devMode = typeof DEV_MODE !== "undefined" && DEV_MODE;

let currentGameId = null;
let liveGames = [];

function setDevStatus(text) {
  if (!devStatus) return;
  if (!text) {
    devStatus.hidden = true;
    devStatus.textContent = "";
    return;
  }
  devStatus.hidden = false;
  devStatus.textContent = text;
}

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
    penaltyDoneFixtureId: null,
    vardictMode: null
  });
}

function showTab(name) {
  const isGames = name === "games";
  panelMain.hidden = isGames;
  panelGames.hidden = !isGames;
  tabsEl.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === name);
  });
}

function renderGamesList() {
  gamesList.textContent = "";
  if (!liveGames.length) {
    const empty = document.createElement("div");
    empty.className = "games-empty";
    empty.textContent = "No live games.";
    gamesList.appendChild(empty);
    return;
  }

  liveGames.forEach((game) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "game-btn";
    if (currentGameId != null && Number(currentGameId) === Number(game.id)) {
      btn.classList.add("is-current");
    }
    btn.textContent = game.label;
    btn.addEventListener("click", () => {
      if (currentGameId != null && Number(currentGameId) === Number(game.id)) return;
      btn.disabled = true;
      chrome.runtime.sendMessage(
        { type: "selectGame", gameId: game.id, label: game.label },
        () => {
          if (chrome.runtime.lastError) {
            btn.disabled = false;
            return;
          }
          currentGameId = game.id;
          renderGamesList();
          showTab("main");
        }
      );
    });
    gamesList.appendChild(btn);
  });
}

function refreshGamesTab() {
  if (!checkbox || !checkbox.checked) {
    tabsEl.hidden = true;
    showTab("main");
    liveGames = [];
    return;
  }

  chrome.runtime.sendMessage({ type: "listLiveGames" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      tabsEl.hidden = true;
      showTab("main");
      return;
    }
    liveGames = Array.isArray(res.games) ? res.games : [];
    const showGames = liveGames.length > 1;
    tabsEl.hidden = !showGames;
    if (!showGames) {
      showTab("main");
      return;
    }
    renderGamesList();
  });
}

function sendPreview(kind) {
  setDevStatus("");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      setDevStatus("No active tab.");
      return;
    }
    const url = tab.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    ) {
      setDevStatus("Open a normal webpage first.");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "preview", kind }, { frameId: 0 }, (res) => {
      if (chrome.runtime.lastError) {
        setDevStatus("Refresh the page, then try again.");
        return;
      }
      if (!res || !res.ok) {
        setDevStatus("Preview failed. Refresh the page and retry.");
        return;
      }
      window.close();
    });
  });
}

tabsEl.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

chrome.storage.local.get(["enabled", "selectedGameId"]).then(({ enabled, selectedGameId }) => {
  checkbox.checked = Boolean(enabled);
  currentGameId = selectedGameId != null ? selectedGameId : null;
  refreshGamesTab();
});

checkbox.addEventListener("change", () => {
  if (checkbox.checked) {
    setViewerTabAndEnable();
  } else {
    turnOff();
  }
  refreshGamesTab();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled) {
    checkbox.checked = Boolean(changes.enabled.newValue);
    refreshGamesTab();
  }
  if (changes.selectedGameId) {
    currentGameId = changes.selectedGameId.newValue != null ? changes.selectedGameId.newValue : null;
    if (!tabsEl.hidden) renderGamesList();
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
