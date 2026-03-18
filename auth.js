// Shared login logic for popup and background (Cyberoam/Sophos portal).
// Directly POSTs credentials — no need to fetch & parse the portal page.
// Attaches to self (worker) or window (popup) so both can use doLogin(uid).
(function (global) {
  var POST_URL = "http://192.168.0.66:8090/login.xml";
  var TIMEOUT_MS = 30000; // 30 seconds

  async function doLogin(userId) {
    if (!userId || !userId.trim()) {
      return { ok: false, message: "No UID" };
    }
    var uid = userId.trim();

    // Cyberoam/Sophos uses these known fields — no need to fetch the page first.
    var formData = new URLSearchParams();
    formData.append("mode", "191");
    formData.append("username", uid);
    formData.append("password", uid);

    // Fetch with timeout so it never hangs forever.
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    try {
      var response = await fetch(POST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        return { ok: false, message: "Server: " + response.status };
      }

      var resultText = await response.text();
      console.log("[SkipHostelWifi] Response:", resultText);

      if (resultText.includes("successfully") || resultText.includes("LIVE")) {
        return { ok: true, message: "Connected" };
      }
      if (resultText.toLowerCase().includes("limit reached")) {
        return { ok: false, message: "Data limit reached" };
      }
      if (resultText.toLowerCase().includes("failed") || resultText.includes("Invalid")) {
        return { ok: false, message: "Check ID/Password" };
      }
      return { ok: true, message: "Command sent" };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        return { ok: false, message: "Timed out. Check your connection." };
      }
      return { ok: false, message: "Network error. Make sure WiFi is on." };
    }
  }

  (global.self || global.window || global).doLogin = doLogin;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
