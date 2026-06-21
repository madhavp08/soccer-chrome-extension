const checkbox = document.getElementById("enabled");
const stateEl = document.getElementById("state");

chrome.storage.local.get("enabled").then(({ enabled }) => {
  checkbox.checked = Boolean(enabled);
  render();
});

checkbox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
  render();
});

function render() {
  stateEl.textContent = checkbox.checked
    ? "On. A poll pops up every minute."
    : "Off.";
}
