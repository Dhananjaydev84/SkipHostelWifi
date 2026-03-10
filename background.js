importScripts("auth.js");

const SESSION_ALARM = "sessionCheck";
const RETRY_ALARM = "sessionRetry";
const PERIOD_MINUTES = 2;
const NETWORK_RETRY_DELAY_MS = 15 * 1000;
const NETWORK_RETRY_FALLBACK_MINUTES = 0.5;
const FORCE_REFRESH_MS = 15 * 60 * 1000;
const STARTUP_STALE_MS = 2 * PERIOD_MINUTES * 60 * 1000;
const WAKE_STALE_MS = 90 * 1000;

let runLock = Promise.resolve();
let retryTimeoutId = null;

function log(level, message, details) {
  const prefix = "[SkipHostelWifi]";
  if (details === undefined) {
    console[level](`${prefix} ${message}`);
    return;
  }
  console[level](`${prefix} ${message}`, details);
}

function withRunLock(task) {
  const nextRun = runLock.then(task, task);
  runLock = nextRun.catch(() => {});
  return nextRun;
}

async function getState() {
  return chrome.storage.local.get([
    "savedUID",
    "keepAliveActive",
    "lastCheckAt",
    "lastAuthAt",
    "lastSuccessAt",
    "lastFailureAt",
    "consecutiveFailures",
    "lastOutcome",
    "lastReason"
  ]);
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function clearRetryAlarm() {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  await chrome.alarms.clear(RETRY_ALARM);
}

async function syncAlarms() {
  const { keepAliveActive } = await chrome.storage.local.get("keepAliveActive");
  const periodicAlarm = await chrome.alarms.get(SESSION_ALARM);

  if (keepAliveActive) {
    if (!periodicAlarm) {
      log("log", "Creating periodic session alarm", { periodInMinutes: PERIOD_MINUTES });
      chrome.alarms.create(SESSION_ALARM, {
        periodInMinutes: PERIOD_MINUTES
      });
    } else {
      log("log", "Periodic session alarm already present");
    }
    return;
  }

  if (periodicAlarm) {
    log("log", "Clearing periodic session alarm");
    await chrome.alarms.clear(SESSION_ALARM);
  }
  log("log", "Clearing retry alarm");
  await clearRetryAlarm();
}

function shouldCheck(reason, state, now) {
  if (!state.keepAliveActive || !state.savedUID) return false;
  if (
    reason === "manual-start" ||
    reason === "alarm" ||
    reason === "retry" ||
    reason === "retry-timer"
  ) {
    return true;
  }

  const lastCheckAt = Number(state.lastCheckAt || 0);
  if (!lastCheckAt) return true;

  const staleMs = reason === "wake" ? WAKE_STALE_MS : STARTUP_STALE_MS;
  return now - lastCheckAt >= staleMs;
}

async function scheduleRetry() {
  await clearRetryAlarm();
  log("warn", "Scheduling retry after network failure", {
    delayMs: NETWORK_RETRY_DELAY_MS,
    fallbackDelayInMinutes: NETWORK_RETRY_FALLBACK_MINUTES
  });
  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    runSessionCheck("retry-timer");
  }, NETWORK_RETRY_DELAY_MS);
  chrome.alarms.create(RETRY_ALARM, {
    delayInMinutes: NETWORK_RETRY_FALLBACK_MINUTES
  });
}

async function recordResult(result) {
  await setState(result);
}

async function runSessionCheck(reason) {
  return withRunLock(async () => {
    const now = Date.now();
    const state = await getState();
    log("log", "Session check triggered", {
      reason,
      keepAliveActive: !!state.keepAliveActive,
      hasSavedUID: !!state.savedUID,
      lastCheckAt: state.lastCheckAt || null
    });

    if (!shouldCheck(reason, state, now)) {
      log("log", "Skipping session check", { reason });
      await syncAlarms();
      return { skipped: true, reason };
    }

    await recordResult({
      lastCheckAt: now,
      lastReason: reason
    });

    const heartbeat = await sendHeartbeat();
    if (heartbeat.ok) {
      const lastAuthAt = Number(state.lastAuthAt || 0);
      const forceRefreshDue = !lastAuthAt || now - lastAuthAt >= FORCE_REFRESH_MS;

      if (forceRefreshDue) {
        log("log", "Heartbeat is live but forced refresh is due; attempting re-login", {
          lastAuthAt: lastAuthAt || null
        });
        const refreshResult = await doLogin(state.savedUID);
        if (refreshResult.ok) {
          await clearRetryAlarm();
          await recordResult({
            consecutiveFailures: 0,
            lastOutcome: "forced-refresh",
            lastAuthAt: now,
            lastSuccessAt: now
          });
          return { ok: true, action: "forced-refresh" };
        }

        log("error", "Forced refresh re-login failed", refreshResult);
        const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
        await recordResult({
          consecutiveFailures,
          lastOutcome: "forced-refresh-failed",
          lastFailureAt: now
        });
        await scheduleRetry();
        return { ok: false, action: "forced-refresh-failed", message: refreshResult.message };
      }

      log("log", "Heartbeat says session is alive", heartbeat);
      await clearRetryAlarm();
      await recordResult({
        consecutiveFailures: 0,
        lastOutcome: "live",
        lastSuccessAt: now
      });
      return { ok: true, action: "heartbeat" };
    }

    if (heartbeat.kind === "network") {
      log("warn", "Heartbeat failed because network looks unavailable", heartbeat);
      const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
      await recordResult({
        consecutiveFailures,
        lastOutcome: "network-error",
        lastFailureAt: now
      });
      await scheduleRetry();
      return { ok: false, action: "retry-scheduled", message: heartbeat.message };
    }

    log("warn", "Heartbeat says session expired, attempting re-login", heartbeat);
    const loginResult = await doLogin(state.savedUID);
    if (loginResult.ok) {
      log("log", "Automatic re-login succeeded", loginResult);
      await clearRetryAlarm();
      await recordResult({
        consecutiveFailures: 0,
        lastOutcome: "re-authenticated",
        lastAuthAt: now,
        lastSuccessAt: now
      });
      return { ok: true, action: "login" };
    }

    log("error", "Automatic re-login failed", loginResult);
    const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    await recordResult({
      consecutiveFailures,
      lastOutcome: "login-failed",
      lastFailureAt: now
    });
    await scheduleRetry();
    return { ok: false, action: "login-failed", message: loginResult.message };
  });
}

async function activateAutomation(savedUID) {
  const now = Date.now();
  log("log", "Activating automation", { hasSavedUID: !!savedUID });
  await setState({
    savedUID
  });
  await setState({
    keepAliveActive: true,
    consecutiveFailures: 0,
    lastAuthAt: now,
    lastSuccessAt: now,
    lastOutcome: "manual-login"
  });
  await syncAlarms();
}

async function deactivateAutomation() {
  log("log", "Deactivating automation");
  await clearRetryAlarm();
  await setState({
    keepAliveActive: false
  });
  await syncAlarms();
}

async function resumeAutomationIfNeeded(reason) {
  const state = await getState();
  if (!state.keepAliveActive) {
    log("log", "Worker resume skipped because automation is inactive", { reason });
    await syncAlarms();
    return;
  }

  if (!state.savedUID) {
    log("warn", "Active automation state found without a session UID; deactivating", { reason });
    await deactivateAutomation();
    return;
  }

  log("log", "Worker resume detected active automation; restoring alarms", { reason });
  await syncAlarms();
  await runSessionCheck(reason);
}

chrome.runtime.onInstalled.addListener(() => {
  log("log", "Extension installed/updated");
  resumeAutomationIfNeeded("worker-start");
});

chrome.runtime.onStartup.addListener(() => {
  log("log", "Browser startup detected");
  resumeAutomationIfNeeded("startup");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    chrome.storage.local.get("savedUID", async (data) => {
      const savedUID = (msg.savedUID || data.savedUID || "").trim();
      if (!savedUID) {
        log("warn", "startKeepAlive requested without a saved UID");
        sendResponse({ started: false, error: "No UID saved" });
        return;
      }

      await activateAutomation(savedUID);
      log("log", "Automation started");
      sendResponse({ started: true });
    });
    return true;
  }

  if (msg.action === "stopKeepAlive") {
    deactivateAutomation().then(() => {
      log("log", "Automation stopped");
      sendResponse({ stopped: true });
    });
    return true;
  }

  if (msg.action === "runSessionCheck") {
    log("log", "Manual session check requested", { reason: msg.reason || "manual-start" });
    runSessionCheck(msg.reason || "manual-start")
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  log("log", "Alarm fired", { name: alarm.name });
  if (alarm.name === SESSION_ALARM) {
    runSessionCheck("alarm");
    return;
  }

  if (alarm.name === RETRY_ALARM) {
    runSessionCheck("retry");
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  log("log", "Idle state changed", { state });
  if (state === "active") {
    runSessionCheck("wake");
  }
});

resumeAutomationIfNeeded("worker-start");
