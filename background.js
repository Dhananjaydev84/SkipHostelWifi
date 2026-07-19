// Background service worker — owns login execution and keep-alive alarms.
// Imports auth.js for the shared doLogin() function.
importScripts("auth.js");

const log = (msg, ...args) => {
  const time = new Date().toLocaleTimeString();
  console.log(`[SkipHostelWifi ${time}] ${msg}`, ...args);
};

// ── Alarm names ──────────────────────────────────────────────
const PORTAL_ALARM = "keepPortalAlive";
const SW_ALARM     = "keepSWAlive";

// ── Alarm creation helper ────────────────────────────────────
async function createKeepAliveAlarms() {
  // Clear only the keep-alive alarms — prevents duplicates if the
  // user clicks Connect more than once, without affecting other alarms.
  await chrome.alarms.clear(PORTAL_ALARM);
  await chrome.alarms.clear(SW_ALARM);

  chrome.alarms.create(PORTAL_ALARM, { periodInMinutes: 4 });
  chrome.alarms.create(SW_ALARM,     { periodInMinutes: 0.33 });

  log("Keep-alive alarms created.");
}

// ── Alarm listener ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PORTAL_ALARM) {
    const { savedUID } = await chrome.storage.local.get("savedUID");
    if (savedUID) {
      log("Portal ping — re-authenticating…");
      const result = await doLogin(savedUID);
      log("Portal ping result:", result);
    } else {
      log("WARN: Portal ping skipped — no savedUID.");
    }
    return;
  }

  if (alarm.name === SW_ALARM) {
    // Heartbeat — just keeps the service worker awake.
    log("SW heartbeat.");
  }
});

// ── Message handlers ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // --- Login: runs the network request in the service worker so it
  //     survives the popup closing. Saves UID and starts keep-alive
  //     on success, all in a single round-trip message.
  if (msg.action === "login") {
    const userId = msg.userId && msg.userId.trim();
    if (!userId) {
      sendResponse({ ok: false, message: "No UID" });
      return true;
    }

    (async () => {
      try {
        const result = await doLogin(userId);
        if (result && result.ok) {
          // Persist UID only after a successful login
          await chrome.storage.local.set({ savedUID: userId });
          await createKeepAliveAlarms();
          sendResponse({ ok: true, message: result.message, keepAlive: true });
        } else {
          sendResponse(result || { ok: false, message: "Login failed." });
        }
      } catch (err) {
        log("ERROR: login failed:", err);
        sendResponse({ ok: false, message: err.message || String(err) });
      }
    })();
    return true; // keep message channel open for async response
  }

  if (msg.action === "startKeepAlive") {
    createKeepAliveAlarms()
      .then(() => {
        sendResponse({ started: true });
      })
      .catch((err) => {
        log("ERROR: Failed to create alarms:", err);
        sendResponse({ started: false, error: err.message });
      });
    return true; // keep message channel open for async response
  }

  if (msg.action === "stopKeepAlive") {
    Promise.all([
      chrome.alarms.clear(PORTAL_ALARM),
      chrome.alarms.clear(SW_ALARM)
    ])
      .then(() => {
        log("Keep-alive alarms cleared.");
        sendResponse({ stopped: true });
      })
      .catch((err) => {
        log("ERROR: Failed to clear alarms:", err);
        sendResponse({ stopped: false, error: err.message });
      });
    return true;
  }
});
