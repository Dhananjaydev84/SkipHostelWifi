// Background service worker — owns login execution and keep-alive alarms.
// Imports auth.js for the shared doLogin() function.
importScripts("auth.js");

const log = (msg, ...args) => {
  const time = new Date().toLocaleTimeString();
  console.log(`[SkipHostelWifi ${time}] ${msg}`, ...args);
};

// ── Alarm name ──────────────────────────────────────────────
const PORTAL_ALARM = "keepPortalAlive";

// ── Alarm creation helper ────────────────────────────────────────
async function createKeepAliveAlarm() {
  // Clear existing portal alarm — prevents duplicates if the
  // user clicks Connect more than once.
  await chrome.alarms.clear(PORTAL_ALARM);

  // Re-authenticate every 4 minutes to keep the portal session alive.
  chrome.alarms.create(PORTAL_ALARM, { periodInMinutes: 4 });

  log("Portal keep-alive alarm created.");
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
          await createKeepAliveAlarm();
          sendResponse({ ok: true, message: result.message, keepAlive: true });
        } else {
          // Failed login — actively kill the portal session so the
          // user loses internet (matches portal webpage behavior).
          await doLogout(userId);
          await chrome.alarms.clear(PORTAL_ALARM);
          await chrome.storage.local.remove("savedUID");
          log("Login failed — session killed, keep-alive stopped.");
          sendResponse(result || { ok: false, message: "Login failed." });
        }
      } catch (err) {
        log("ERROR: login failed:", err);
        sendResponse({ ok: false, message: err.message || String(err) });
      }
    })();
    return true; // keep message channel open for async response
  }

  // --- Logout: signs out from the portal, clears saved UID,
  //     and stops the keep-alive alarm.
  if (msg.action === "logout") {
    const userId = msg.userId && msg.userId.trim();
    if (!userId) {
      sendResponse({ ok: false, message: "No UID to sign out" });
      return true;
    }

    (async () => {
      try {
        const result = await doLogout(userId);
        if (result && result.ok) {
          await chrome.storage.local.remove("savedUID");
          await chrome.alarms.clear(PORTAL_ALARM);
          log("Signed out and cleared keep-alive alarm.");
        }
        sendResponse(result || { ok: false, message: "Sign-out failed." });
      } catch (err) {
        log("ERROR: logout failed:", err);
        sendResponse({ ok: false, message: err.message || String(err) });
      }
    })();
    return true;
  }

  if (msg.action === "startKeepAlive") {
    createKeepAliveAlarm()
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
    chrome.alarms.clear(PORTAL_ALARM)
      .then(() => {
        log("Portal keep-alive alarm cleared.");
        sendResponse({ stopped: true });
      })
      .catch((err) => {
        log("ERROR: Failed to clear alarms:", err);
        sendResponse({ stopped: false, error: err.message });
      });
    return true;
  }
});
