importScripts("auth.js");

const SESSION_ALARM = "sessionCheck";
const RETRY_ALARM = "sessionRetry";
const PERIOD_MINUTES = 4;
const NETWORK_RETRY_FALLBACK_MINUTES = 0.5;
const STARTUP_STALE_MS = 2 * PERIOD_MINUTES * 60 * 1000;
const WAKE_STALE_MS = 90 * 1000;
const RUN_LOCK_MAX_AGE_MS = 60 * 1000;
const NETWORK_ERROR_PATTERN = /(fetch|network|abort|timeout|timed out|failed to fetch|heartbeat failed)/i;

chrome.idle.setDetectionInterval(120);

function log(level, message, details) {
  const prefix = "[SkipHostelWifi]";
  const logger = typeof console[level] === "function" ? console[level].bind(console) : console.log.bind(console);
  if (details === undefined) {
    logger(`${prefix} ${message}`);
    return;
  }
  logger(`${prefix} ${message}`, details);
}

function getErrorMessage(error) {
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function isTransientFailureMessage(message) {
  return NETWORK_ERROR_PATTERN.test(String(message || ""));
}

function getActiveUid(state) {
  return String(state.savedUID || state.savedUIDBackup || "").trim();
}

function fireAndForget(label, taskFactory) {
  Promise.resolve()
    .then(taskFactory)
    .catch((error) => {
      log("error", `${label} failed`, { message: getErrorMessage(error) });
    });
}

async function getState() {
  return chrome.storage.local.get([
    "savedUID",
    "savedUIDBackup",
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
  await chrome.alarms.clear(RETRY_ALARM);
}

async function acquireRunLock(now) {
  const { lockAcquiredAt } = await chrome.storage.local.get("lockAcquiredAt");
  const lastLockAt = Number(lockAcquiredAt || 0);

  if (lastLockAt && now - lastLockAt < RUN_LOCK_MAX_AGE_MS) {
    return false;
  }

  await chrome.storage.local.set({ lockAcquiredAt: now });
  return true;
}

async function releaseRunLock() {
  await chrome.storage.local.remove("lockAcquiredAt");
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
  if (reason === "manual-start" || reason === "alarm" || reason === "retry") {
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
    fallbackDelayInMinutes: NETWORK_RETRY_FALLBACK_MINUTES
  });
  chrome.alarms.create(RETRY_ALARM, {
    delayInMinutes: NETWORK_RETRY_FALLBACK_MINUTES
  });
}

async function recordResult(result) {
  await setState(result);
}

async function runSessionCheck(reason) {
  const now = Date.now();
  const lockAcquired = await acquireRunLock(now);

  if (!lockAcquired) {
    log("log", "Skipping session check because another run is still active", { reason });
    return { skipped: true, reason, lockActive: true };
  }

  try {
    let state = await getState();
    const activeUid = getActiveUid(state);

    if (!state.savedUID && activeUid) {
      await setState({ savedUID: activeUid });
      state = {
        ...state,
        savedUID: activeUid
      };
    }

    log("log", "Session check triggered", {
      reason,
      keepAliveActive: !!state.keepAliveActive,
      hasSavedUID: !!activeUid,
      lastCheckAt: state.lastCheckAt || null
    });

    if (!shouldCheck(reason, state, now)) {
      if (state.keepAliveActive && !activeUid) {
        log("warn", "Skipping session check because no UID is available yet");
        await recordResult({
          lastOutcome: "missing-uid",
          lastFailureAt: now,
          lastReason: reason
        });
      }
      log("log", "Skipping session check", { reason });
      await syncAlarms();
      return { skipped: true, reason };
    }

    await recordResult({
      lastCheckAt: now,
      lastReason: reason
    });

    try {
      log("log", "Sending heartbeat before deciding whether re-login is needed", { reason });
      const heartbeatResult = await sendHeartbeat();

      if (heartbeatResult.ok) {
        log("log", "Heartbeat confirmed the session is still active", heartbeatResult);
        await clearRetryAlarm();
        await recordResult({
          consecutiveFailures: 0,
          lastOutcome: "session-active",
          lastSuccessAt: now
        });
        return { ok: true, action: "heartbeat" };
      }

      if (heartbeatResult.kind === "network") {
        log("warn", "Heartbeat failed because of a transient network issue", heartbeatResult);
        const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
        await recordResult({
          consecutiveFailures,
          lastOutcome: "network-error",
          lastFailureAt: now
        });
        await scheduleRetry();
        return { ok: false, action: "heartbeat-network-failed", message: heartbeatResult.message };
      }

      log("log", "Heartbeat reported an expired session; attempting scheduled re-login", {
        reason,
        message: heartbeatResult.message
      });
      const loginResult = await doLogin(activeUid);
      if (loginResult.ok) {
        log("log", "Scheduled re-login succeeded", loginResult);
        await clearRetryAlarm();
        await recordResult({
          consecutiveFailures: 0,
          lastOutcome: "re-authenticated",
          lastAuthAt: now,
          lastSuccessAt: now
        });
        return { ok: true, action: "login" };
      }

      log("warn", "Scheduled re-login failed", loginResult);
      const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
      await recordResult({
        consecutiveFailures,
        lastOutcome: isTransientFailureMessage(loginResult.message) ? "network-error" : "login-failed",
        lastFailureAt: now
      });
      await scheduleRetry();
      return { ok: false, action: "login-failed", message: loginResult.message };
    } catch (error) {
      const message = getErrorMessage(error);
      const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
      log("error", "Session check crashed unexpectedly", { reason, message });
      await recordResult({
        consecutiveFailures,
        lastOutcome: "internal-error",
        lastFailureAt: now
      });
      await scheduleRetry();
      return { ok: false, action: "internal-error", message };
    }
  } finally {
    await releaseRunLock();
  }
}

async function activateAutomation(savedUID) {
  const now = Date.now();
  log("log", "Activating automation", { hasSavedUID: !!savedUID });
  await setState({
    savedUID,
    savedUIDBackup: savedUID
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

  const activeUid = getActiveUid(state);
  if (!activeUid) {
    log("warn", "Active automation state found without any recoverable UID", { reason });
    await syncAlarms();
    return;
  }

  if (!state.savedUID && activeUid) {
    log("warn", "Restoring missing saved UID from backup", { reason });
    await setState({ savedUID: activeUid });
  }

  log("log", "Worker resume detected active automation; restoring alarms", { reason });
  await syncAlarms();
  await runSessionCheck(reason);
}

chrome.runtime.onInstalled.addListener(() => {
  log("log", "Extension installed/updated");
  fireAndForget("install resume", () => resumeAutomationIfNeeded("worker-start"));
});

chrome.runtime.onStartup.addListener(() => {
  log("log", "Browser startup detected");
  fireAndForget("startup resume", () => resumeAutomationIfNeeded("startup"));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startKeepAlive") {
    chrome.storage.local.get("savedUID", async (data) => {
      try {
        const savedUID = (msg.savedUID || data.savedUID || "").trim();
        if (!savedUID) {
          log("warn", "startKeepAlive requested without a saved UID");
          sendResponse({ started: false, error: "No UID saved" });
          return;
        }

        await activateAutomation(savedUID);
        log("log", "Automation started");
        sendResponse({ started: true });
      } catch (error) {
        const message = getErrorMessage(error);
        log("error", "Failed to start automation", { message });
        sendResponse({ started: false, error: message });
      }
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
    fireAndForget("session alarm", () => runSessionCheck("alarm"));
    return;
  }

  if (alarm.name === RETRY_ALARM) {
    fireAndForget("retry alarm", () => runSessionCheck("retry"));
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  log("log", "Idle state changed", { state });
  if (state === "active") {
    fireAndForget("wake check", () => runSessionCheck("wake"));
  }
});

fireAndForget("initial resume", () => resumeAutomationIfNeeded("worker-start"));
