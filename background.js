// Keep-alive: re-authenticate with the portal every 5 minutes so the session never expires.
importScripts("auth.js");

const ALARM_NAME = "wifiKeepAlive";
const KEEP_ALIVE_MINUTES = 5;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    chrome.storage.local.get("savedUID", (data) => {
      if (data.savedUID) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: KEEP_ALIVE_MINUTES });
        sendResponse({ started: true });
      } else {
        sendResponse({ started: false, error: "No UID saved" });
      }
    });
    return true;
  }
  if (msg.action === "stopKeepAlive") {
    chrome.alarms.clear(ALARM_NAME);
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
