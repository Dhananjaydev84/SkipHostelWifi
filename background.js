// Keep-alive: re-authenticate with the portal every 5 minutes so the session never expires.
importScripts("auth.js");

const ALARM_NAME = "reauthWifi";
const KEEP_ALIVE_MINUTES = 4;

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: KEEP_ALIVE_MINUTES
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    chrome.storage.local.get("savedUID", async (data) => {
      if (!data.savedUID) {
        sendResponse({ started: false, error: "No UID saved" });
        return;
      }

      await ensureAlarm();

      chrome.storage.local.set({ keepAliveActive: true });

      // Run one refresh immediately so user doesn't wait for the first alarm.
      const result = await doLogin(data.savedUID);
      sendResponse({ started: true, refreshed: result.ok, message: result.message });
    });
    return true;
  }
  if (msg.action === "stopKeepAlive") {
    chrome.alarms.clear(ALARM_NAME);
    chrome.storage.local.set({ keepAliveActive: false });
    sendResponse({ stopped: true });
    return false;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const { savedUID } = await chrome.storage.local.get("savedUID");
  if (!savedUID) return;

  console.log("[SkipHostelWifi] Running keep-alive heartbeat...");
  const status = await sendHeartbeat();

  if (status.ok) {
    console.log("[SkipHostelWifi] Heartbeat OK: Session still live");
  } else {
    console.warn("[SkipHostelWifi] Heartbeat failed:", status.message, ". Attempting full re-login...");
    const result = await doLogin(savedUID);
    if (result.ok) {
      console.log("[SkipHostelWifi] Re-login successful");
    } else {
      console.error("[SkipHostelWifi] Re-login failed:", result.message);
    }
  }
});
