const checkbox = document.getElementById("enabled");
const stateEl = document.getElementById("state");

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
