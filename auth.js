// ============================================================
// auth.js — WiFi login logic (loaded by background.js via importScripts)
//
// Directly POSTs credentials to the Cyberoam/Sophos captive portal.
// No need to fetch & parse the portal page first — the endpoint and
// form fields are fixed for this network (192.168.0.66:8090).
// ============================================================

// Portal login endpoint (Cyberoam/Sophos standard path)
const LOGIN_URL = "http://192.168.0.66:8090/login.xml";

// Abort the request if it hangs longer than this (milliseconds)
const LOGIN_TIMEOUT_MS = 30000; // 30 seconds

// ----------------------------------------------------------
// doLogin(userId)
//
// Attempts to authenticate the user against the captive portal.
// Returns a plain object: { ok: boolean, message: string }
//   ok: true  -> connected (or portal accepted the request)
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

    // Parse the portal's plain-text XML response for known status keywords
    const resultText = await response.text();
    console.log("[SkipHostelWifi] Response:", resultText);

    // Success indicators returned by Cyberoam/Sophos
    if (resultText.includes("successfully") || resultText.includes("LIVE")) {
      return { ok: true, message: "Connected" };
    }

    // Data cap exceeded — user needs to buy more quota
    if (resultText.toLowerCase().includes("limit reached")) {
      return { ok: false, message: "Data limit reached" };
    }

    // Invalid credentials or explicit failure message
    if (resultText.toLowerCase().includes("failed") || resultText.includes("Invalid")) {
      return { ok: false, message: "Check ID/Password" };
    }

    // Fallback: command was sent but no recognisable keyword in response.
    // Treat as failure since we can't confirm success.
    return { ok: false, message: "Unexpected response. Try again." };

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
