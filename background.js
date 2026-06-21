const ALARM_NAME = "ref-watch-poll";
let pollWindowId = null;

chrome.runtime.onInstalled.addListener(syncAlarm);
chrome.runtime.onStartup.addListener(syncAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    syncAlarm();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    openPollWindow();
  }
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === pollWindowId) {
    pollWindowId = null;
  }
});

async function syncAlarm() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  } else {
    chrome.alarms.clear(ALARM_NAME);
  }
}

async function openPollWindow() {
  if (pollWindowId !== null) {
    try {
      await chrome.windows.remove(pollWindowId);
    } catch (e) {}
    pollWindowId = null;
  }

  const win = await chrome.windows.create({
    url: "poll.html",
    type: "popup",
    width: 320,
    height: 220,
    focused: true
  });
  pollWindowId = win.id;
}
