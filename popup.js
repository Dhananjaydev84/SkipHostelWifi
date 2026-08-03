// ============================================================
// popup.js — UI logic for the SkipHostelWifi extension popup
// Responsibilities:
//   • Handle the Connect button click → delegates to background.js via message
//   • Display login status and keep-alive feedback
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

  // ---------------------------------------------------------------------------
  // On popup open: restore saved UID.
  // ---------------------------------------------------------------------------
  chrome.storage.local.get(["savedUID"], (data) => {
    // Pre-fill the UID field if previously saved
    if (data.savedUID) {
      document.getElementById("uid").value = data.savedUID;
    }
  });


  // ============================================================
  // Connect button — sends login request to background.js,
  // which owns the network call so it survives popup closure.
  // ============================================================
  document.getElementById("submit").onclick = () => {
    document.getElementById("keepAliveStatus").textContent = "";
    document.getElementById("keepAliveStatus").classList.remove("visible");

    const userId = document.getElementById("uid").value.trim();
    const output = document.getElementById("output");

    // Guard: require a non-empty UID before sending to background
    if (userId === "") {
      output.innerText = "Error: Enter your UID";
      return;
    }

    output.innerText = "Connecting...";

    chrome.runtime.sendMessage({ action: "login", userId }, (result) => {
      // Handle the case where the service worker is unreachable
      if (chrome.runtime.lastError) {
        output.innerText = "Extension error. Try reloading.";
        return;
      }

      if (result && result.ok) {
        output.innerText = "Connected successfully!";
        const el = document.getElementById("keepAliveStatus");
        if (result.keepAlive) {
          el.textContent = "Keep alive initialised";
        }
        el.classList.add("visible");
      } else {
        output.innerText = (result && result.message) || "Login failed.";
      }
    });
  };
});
