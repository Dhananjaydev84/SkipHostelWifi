// Shared login logic for popup and background (Cyberoam/Sophos portal).
const DEFAULT_IP = "192.168.0.66";
const PORT = "8090";
const FETCH_TIMEOUT_MS = 8000;

function authLog(level, message, details) {
  const prefix = "[SkipHostelWifi][auth]";
  if (details === undefined) {
    console[level](`${prefix} ${message}`);
    return;
  }
  console[level](`${prefix} ${message}`, details);
}

function getAttr(tag, attrName) {
  const re = new RegExp(`${attrName}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  return (m && (m[2] || m[3] || m[4])) ? (m[2] || m[3] || m[4]) : "";
}

function parseInputsFromHtml(html) {
  const tags = html.match(/<input\b[^>]*>/gi) || [];
  return tags.map((tag) => ({
    name: getAttr(tag, "name"),
    id: getAttr(tag, "id"),
    type: (getAttr(tag, "type") || "text").toLowerCase(),
    value: getAttr(tag, "value")
  }));
}

function getConfiguredIp() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get("targetIP", (data) => {
          const ip = data && data.targetIP ? data.targetIP : DEFAULT_IP;
          resolve(ip);
        });
      } else {
        resolve(DEFAULT_IP);
      }
    } catch (_e) {
      resolve(DEFAULT_IP);
    }
  });
}

async function getLoginUrls() {
  const ip = await getConfiguredIp();
  const base = `http://${ip}:${PORT}/`;
  return {
    loginBase: base,
    postUrl: `${base}login.xml`
  };
}

function isLoginPageHtml(html) {
  const normalized = String(html || "").toLowerCase();
  return (
    normalized.includes("<form") &&
    (normalized.includes("password") ||
      normalized.includes("username") ||
      normalized.includes("login"))
  );
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function doLogin(userId) {
  try {
    if (!userId || !userId.trim()) {
      authLog("warn", "Login skipped because UID is empty");
      return { ok: false, message: "No UID" };
    }
    const uid = userId.trim();
    const { loginBase, postUrl } = await getLoginUrls();
    authLog("log", "Starting login flow", { loginBase, postUrl });

    const response = await fetchWithTimeout(loginBase, { credentials: "include" });
    if (!response.ok) {
      authLog("warn", "Portal pre-login fetch failed", { status: response.status });
      return { ok: false, message: "Fetch failed: " + response.status };
    }

    const text = await response.text();

    let inputs = [];
    try {
      if (typeof DOMParser !== "undefined") {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        inputs = Array.from(doc.querySelectorAll("input")).map((i) => ({
          name: i.name || "",
          id: i.id || "",
          type: (i.type || "text").toLowerCase(),
          value: i.value || ""
        }));
      } else {
        // Service worker-safe HTML parsing fallback
        inputs = parseInputsFromHtml(text);
      }
    } catch (_e) {
      inputs = parseInputsFromHtml(text);
    }

    const formData = new URLSearchParams();
    let foundUser = false;
    let foundPass = false;

    inputs.forEach(function (input) {
      const name = input.name;
      if (!name) return;
      const lowerName = name.toLowerCase();
      const lowerId = (input.id || "").toLowerCase();
      if (lowerId === "username" || lowerName.includes("user")) {
        formData.append(name, uid);
        foundUser = true;
      } else if (lowerId === "password" || input.type === "password" || lowerName.includes("pass")) {
        formData.append(name, uid);
        foundPass = true;
      } else {
        formData.append(name, input.value);
      }
    });

    // Cyberoam/Sophos commonly uses mode=191. Even if portal branding isn't present,
    // it's safe to add when missing.
    if (!formData.has("mode")) formData.append("mode", "191");
    if (!foundUser) formData.append("username", uid);
    if (!foundPass) formData.append("password", uid);

    const loginResponse = await fetchWithTimeout(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "include",
      redirect: "follow",
      body: formData
    });

    if (!loginResponse.ok) {
      authLog("warn", "Portal login POST failed", { status: loginResponse.status });
      return { ok: false, message: "Server: " + loginResponse.status };
    }

    const resultText = await loginResponse.text();
    const redirectedBackToLogin =
      loginResponse.redirected &&
      (loginResponse.url.toLowerCase().includes("login") || isLoginPageHtml(resultText));

    if (redirectedBackToLogin || isLoginPageHtml(resultText)) {
      authLog("warn", "Portal login POST returned the captive portal login page", {
        url: loginResponse.url
      });
      return { ok: false, message: "Login page returned" };
    }

    if (resultText.includes("successfully") || resultText.includes("LIVE") || resultText.includes("already logged in")) {
      authLog("log", "Portal login succeeded");
      return { ok: true, message: "Connected" };
    }
    if (resultText.toLowerCase().includes("limit reached")) {
      authLog("warn", "Portal rejected login because limit was reached");
      return { ok: false, message: "Data limit reached" };
    }
    if (resultText.toLowerCase().includes("failed") || resultText.includes("Invalid")) {
      authLog("warn", "Portal rejected login because credentials looked invalid");
      return { ok: false, message: "Check ID/Password" };
    }
    authLog("log", "Portal login returned an unrecognized success-like response");
    return { ok: true, message: "Command sent" };
  } catch (error) {
    authLog("error", "Login request crashed", { message: error && error.message ? error.message : String(error) });
    return { ok: false, message: "Fetch failed" };
  }
}

async function sendHeartbeat() {
  try {
    const { loginBase } = await getLoginUrls();
    authLog("log", "Sending heartbeat", { heartbeatUrl: loginBase });
    const response = await fetchWithTimeout(loginBase, {
      method: "GET",
      credentials: "include",
      redirect: "follow"
    });

    if (!response.ok) {
      authLog("warn", "Heartbeat HTTP request failed", { status: response.status });
      return { ok: false, kind: "network", message: "Heartbeat failed" };
    }

    const text = await response.text();
    const redirectedToLogin =
      response.redirected &&
      (response.url.toLowerCase().includes("login") || isLoginPageHtml(text));

    if (redirectedToLogin) {
      authLog("warn", "Heartbeat was redirected to the captive portal login page", {
        url: response.url
      });
      return { ok: false, kind: "expired", message: "Redirected to login page" };
    }

    if (isLoginPageHtml(text)) {
      authLog("warn", "Heartbeat returned captive portal login HTML");
      return { ok: false, kind: "expired", message: "Login page returned" };
    }

    authLog("log", "Heartbeat succeeded without redirect; treating session as alive", {
      url: response.url
    });
    return { ok: true, kind: "live", message: "Session active" };
  } catch (error) {
    authLog("error", "Heartbeat request crashed", {
      message: error && error.message ? error.message : String(error)
    });
    return { ok: false, kind: "network", message: "Network error" };
  }
}

