// Background service worker — imports auth.js for shared doLogin().
importScripts("auth.js");

// ── Alarm names ──────────────────────────────────────────────
const PORTAL_ALARM = "keepPortalAlive";
const SW_ALARM     = "keepSWAlive";

// ── Alarm creation helper ────────────────────────────────────
async function createKeepAliveAlarms() {
  // Wipe any existing alarms first — prevents duplicates if the
  // user clicks Connect more than once.
  await chrome.alarms.clearAll();

  chrome.alarms.create(PORTAL_ALARM, { periodInMinutes: 4 });
  chrome.alarms.create(SW_ALARM,     { periodInMinutes: 0.33 });

  console.log("[SkipHostelWifi] Keep-alive alarms created.");
}

// ── Alarm listener ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PORTAL_ALARM) {
    const { savedUID } = await chrome.storage.local.get("savedUID");
    if (savedUID) {
      console.log("[SkipHostelWifi] Portal ping — re-authenticating…");
      const result = await doLogin(savedUID);
      console.log("[SkipHostelWifi] Portal ping result:", result);
    } else {
      console.warn("[SkipHostelWifi] Portal ping skipped — no savedUID.");
    }
    return;
  }

  if (alarm.name === SW_ALARM) {
    // Heartbeat — just keeps the service worker awake.
    console.log("[SkipHostelWifi] SW heartbeat.");
  }
});

// ── Message handlers ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    createKeepAliveAlarms()
      .then(() => {
        chrome.runtime.sendMessage({ action: "keepAliveStatus", status: "ok" })
          .catch(() => { /* popup may be closed — that's fine */ });
        sendResponse({ started: true });
      })
      .catch((err) => {
        console.error("[SkipHostelWifi] Failed to create alarms:", err);
        chrome.runtime.sendMessage({ action: "keepAliveStatus", status: "error" })
          .catch(() => {});
        sendResponse({ started: false, error: err.message });
      });
    return true; // keep message channel open for async response
  }

  if (msg.action === "stopKeepAlive") {
    chrome.alarms.clearAll()
      .then(() => {
        console.log("[SkipHostelWifi] All alarms cleared.");
        sendResponse({ stopped: true });
      })
      .catch((err) => {
        console.error("[SkipHostelWifi] Failed to clear alarms:", err);
        sendResponse({ stopped: false, error: err.message });
      });
    return true;
  }
});
