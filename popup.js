// ============================================================
// popup.js — UI logic for the SkipHostelWifi extension popup
// Responsibilities:
//   • Restore saved UID on popup open
//   • Handle Connect / Sign Out button (single button, transforms)
//   • Display login status and keep-alive feedback
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

  // ---------------------------------------------------------------------------
  // Display the extension version from manifest.json in the footer badge.
  // ---------------------------------------------------------------------------
  const manifest = chrome.runtime.getManifest();
  document.getElementById("versionBadge").textContent = `v${manifest.version}`;

  // ---------------------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------------------
  const uidInput    = document.getElementById("uid");
  const actionBtn   = document.getElementById("submit");
  const actionLabel = actionBtn.querySelector("span");
  const output      = document.getElementById("output");
  const keepAliveEl = document.getElementById("keepAliveStatus");

  // ---------------------------------------------------------------------------
  // State: tracks whether we're currently signed in
  // ---------------------------------------------------------------------------
  let isConnected = false;

  function setConnectedUI(connected) {
    isConnected = connected;
    if (connected) {
      actionLabel.textContent = "Sign Out";
      actionBtn.classList.remove("primary");
      actionBtn.classList.add("signout-mode");
      uidInput.disabled = true;
    } else {
      actionLabel.textContent = "Connect";
      actionBtn.classList.remove("signout-mode");
      actionBtn.classList.add("primary");
      uidInput.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // On popup open: restore saved UID and connection state.
  // If the keep-alive alarm is still running, the user is still connected —
  // restore the "Sign Out" UI so it doesn't look like the extension crashed.
  // ---------------------------------------------------------------------------
  chrome.storage.local.get(["savedUID"], (data) => {
    if (data.savedUID) {
      uidInput.value = data.savedUID;

      // Check if the keep-alive alarm is active → user is still connected
      chrome.alarms.get("keepPortalAlive", (alarm) => {
        if (alarm) {
          setConnectedUI(true);
          output.innerText = "Connected";
          output.classList.remove("error");
          keepAliveEl.textContent = "Keep alive active";
          keepAliveEl.classList.add("visible");
        }
      });
    }
  });


  // ============================================================
  // Single button click — Connect or Sign Out based on state
  // ============================================================
  actionBtn.onclick = () => {
    if (isConnected) {
      handleSignOut();
    } else {
      handleConnect();
    }
  };

  // ---------------------------------------------------------------------------
  // Connect flow
  // ---------------------------------------------------------------------------
  function handleConnect() {
    keepAliveEl.textContent = "";
    keepAliveEl.classList.remove("visible");

    const userId = uidInput.value.trim();

    if (userId === "") {
      output.innerText = "Error: Enter your UID";
      output.classList.add("error");
      return;
    }

    output.innerText = "Connecting...";
    output.classList.remove("error");

    chrome.runtime.sendMessage({ action: "login", userId }, (result) => {
      if (chrome.runtime.lastError) {
        output.innerText = "Extension error. Try reloading.";
        return;
      }

      if (result && result.ok) {
        output.innerText = result.message || "Connected successfully!";
        output.classList.remove("error");
        setConnectedUI(true);
        if (result.keepAlive) {
          keepAliveEl.textContent = "Keep alive initialised";
        }
        keepAliveEl.classList.add("visible");
      } else {
        output.innerText = (result && result.message) || "Login failed.";
        output.classList.add("error");
        setConnectedUI(false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Sign Out flow
  // ---------------------------------------------------------------------------
  function handleSignOut() {
    const userId = uidInput.value.trim();

    if (userId === "") {
      output.innerText = "Error: No UID to sign out";
      return;
    }

    output.innerText = "Signing out...";
    keepAliveEl.textContent = "";
    keepAliveEl.classList.remove("visible");

    chrome.runtime.sendMessage({ action: "logout", userId }, (result) => {
      if (chrome.runtime.lastError) {
        output.innerText = "Extension error. Try reloading.";
        return;
      }

      if (result && result.ok) {
        output.innerText = result.message || "Signed out";
        setConnectedUI(false);
      } else {
        output.innerText = (result && result.message) || "Sign-out failed.";
      }
    });
  }
});
