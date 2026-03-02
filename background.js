// Keep-alive: re-authenticate with the portal every 5 minutes so the session never expires.
importScripts("auth.js");

const ALARM_NAME = "wifiKeepAlive";
const KEEP_ALIVE_MINUTES = 4;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    chrome.storage.local.get("savedUID", async (data) => {
      if (!data.savedUID) {
        sendResponse({ started: false, error: "No UID saved" });
        return;
      }

      chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: KEEP_ALIVE_MINUTES,
        delayInMinutes: KEEP_ALIVE_MINUTES
      });

      chrome.storage.local.set({ keepAliveActive: true });

      // Run one refresh immediately so user doesn't wait for the first alarm.
      try {
        const result = await self.doLogin(data.savedUID);
        sendResponse({ started: true, refreshed: result.ok, message: result.message });
      } catch (e) {
        sendResponse({ started: true, refreshed: false, message: e.message });
      }
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
  try {
    const result = await self.doLogin(savedUID);
    if (result.ok) {
      console.log("[SkipHostelWifi] Keep-alive OK");
    } else {
      console.warn("[SkipHostelWifi] Keep-alive:", result.message);
    }
  } catch (e) {
    console.warn("[SkipHostelWifi] Keep-alive error:", e.message);
  }
});
