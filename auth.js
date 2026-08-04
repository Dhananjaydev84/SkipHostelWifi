// ============================================================
// auth.js — WiFi login logic (loaded by background.js via importScripts)
//
// Directly POSTs credentials to the Cyberoam/Sophos captive portal.
// No need to fetch & parse the portal page first — the endpoint and
// form fields are fixed for this network (192.168.0.66:8090).
// ============================================================

// Portal endpoints (Cyberoam/Sophos standard paths)
const LOGIN_URL  = "http://192.168.0.66:8090/login.xml";
const LOGOUT_URL = "http://192.168.0.66:8090/logout.xml";

// Abort the request if it hangs longer than this (milliseconds)
const LOGIN_TIMEOUT_MS = 30000; // 30 seconds

// ----------------------------------------------------------
// extractTag(xml, tagName)
//
// Extracts the text content of a given XML tag from a raw XML
// string. Handles CDATA wrappers and decodes basic HTML
// entities that the Cyberoam portal uses (&#39; &amp; &quot;).
// Returns null if the tag is not found.
// ----------------------------------------------------------
function extractTag(xml, tagName) {
  const re = new RegExp(
    `<${tagName}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tagName}>`,
    "i"
  );
  const match = xml.match(re);
  if (!match) return null;
  return match[1]
    .trim()
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

// ----------------------------------------------------------
// doLogin(userId)
//
// Attempts to authenticate the user against the captive portal.
// Returns a plain object: { ok: boolean, message: string }
//   ok: true  -> connected (portal returned status LIVE)
//   ok: false -> authentication failed or network error
// ----------------------------------------------------------
async function doLogin(userId) {

  // Guard: reject empty or whitespace-only UIDs immediately
  if (!userId || !userId.trim()) {
    return { ok: false, message: "No UID" };
  }
  const uid = userId.trim();

  // Build the POST body — Cyberoam uses mode=191, and for
  // RSET/hostel accounts the password mirrors the username.
  const formData = new URLSearchParams();
  formData.append("mode",     "191"); // Fixed mode for Cyberoam live login
  formData.append("username", uid);
  formData.append("password", uid);   // password == username on this network

  // Set up an AbortController so the fetch can be cancelled on timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  try {
    // POST credentials to the captive portal
    const response = await fetch(LOGIN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    formData,
      signal:  controller.signal
    });
    clearTimeout(timer); // cancel timeout since we got a response

    // Non-2xx HTTP status -> something went wrong on the server side
    if (!response.ok) {
      return { ok: false, message: "Server: " + response.status };
    }

    // Parse the portal's XML response
    const resultText = await response.text();
    console.log("[SkipHostelWifi] Response:", resultText);

    // Extract the <status> and <message> tags from the portal XML
    const status    = extractTag(resultText, "status");
    const portalMsg = extractTag(resultText, "message")
      ?.replace(/{username}/g, uid);  // portal returns literal {username} — sub in real UID

    // Branch on the portal's status tag value
    if (status === "LIVE") {
      return { ok: true, message: portalMsg || "Connected" };
    }
    if (status === "LOGIN") {
      return { ok: false, message: portalMsg || "Login failed" };
    }
    if (status === "CHALLENGE") {
      return { ok: false, message: portalMsg || "Unexpected challenge state — check portal manually" };
    }

    // Unrecognised or missing status tag
    return { ok: false, message: portalMsg || "Unrecognized response from portal" };

  } catch (err) {
    clearTimeout(timer); // ensure timer is always cleared

    // AbortError means the request hit the LOGIN_TIMEOUT_MS limit
    if (err.name === "AbortError") {
      return { ok: false, message: "Timed out. Check your connection." };
    }

    // All other fetch errors (e.g., offline, DNS failure, CORS)
    return { ok: false, message: "Network error. Make sure WiFi is on." };
  }
}

// ----------------------------------------------------------
// doLogout(username)
//
// Signs the user out of the captive portal.
// Portal expects a POST to logout.xml with mode=193.
// Returns a plain object: { ok: boolean, message: string }
// ----------------------------------------------------------
async function doLogout(username) {
  if (!username || !username.trim()) {
    return { ok: false, message: "No username to sign out" };
  }

  const body = new URLSearchParams({
    mode:        "193",
    username:    username.trim(),
    a:           Date.now().toString(),
    producttype: "0"
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  try {
    const res = await fetch(LOGOUT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body,
      signal:  controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, message: "Server: " + res.status };
    }

    const resultText = await res.text();
    console.log("[SkipHostelWifi] Logout response:", resultText);

    const status    = extractTag(resultText, "status");
    const portalMsg = extractTag(resultText, "message");

    // Portal returns status=LOGIN when sign-out succeeds
    return {
      ok:      status === "LOGIN",
      message: portalMsg || (status === "LOGIN" ? "Signed out" : "Sign-out failed")
    };

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { ok: false, message: "Timed out. Check your connection." };
    }
    return { ok: false, message: "Network error. Make sure WiFi is on." };
  }
}
