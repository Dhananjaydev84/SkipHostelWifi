// ================================
// Load saved UID, IP, and theme when popup opens
// ================================
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(
    ["savedUID", "targetIP", "theme", "keepAliveActive"],
    (data) => {
    if (data.savedUID) {
      document.getElementById("uid").value = data.savedUID;
    }
    const ipInput = document.getElementById("target-ip");
    if (ipInput) {
      ipInput.value = data.targetIP || "192.168.0.66";
    }

    const theme = data.theme || "dark";
    const themeToggle = document.getElementById("theme-toggle");
    if (theme === "light") {
      document.documentElement.classList.add("light-theme");
      if (themeToggle) themeToggle.checked = true;
    } else {
      document.documentElement.classList.remove("light-theme");
      if (themeToggle) themeToggle.checked = false;
    }
    const keepActiveNote = document.getElementById("keep-active-status");
    if (keepActiveNote) {
      keepActiveNote.textContent = "";
      keepActiveNote.classList.remove("visible");
    }
  }
  );

  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const saveIpBtn = document.getElementById("save-ip");
  const resetIpBtn = document.getElementById("reset-ip");
  const ipInput = document.getElementById("target-ip");
  const themeToggle = document.getElementById("theme-toggle");

  const closeSettingsPanel = () => {
    if (!settingsPanel) return;
    settingsPanel.classList.add("hidden");
    settingsPanel.setAttribute("aria-hidden", "true");
  };

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      settingsPanel.classList.toggle("hidden");
      settingsPanel.setAttribute(
        "aria-hidden",
        settingsPanel.classList.contains("hidden") ? "true" : "false"
      );
      if (!settingsPanel.classList.contains("hidden") && ipInput) {
        chrome.storage.local.get("targetIP", (data) => {
          ipInput.value = data.targetIP || "192.168.0.66";
        });
      }
    });
  }

  if (settingsPanel) {
    settingsPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  document.addEventListener("click", (event) => {
    if (!settingsPanel || !settingsBtn) return;
    if (settingsPanel.classList.contains("hidden")) return;
    const target = event.target;
    if (target instanceof Node && !settingsPanel.contains(target) && !settingsBtn.contains(target)) {
      closeSettingsPanel();
    }
  });

  if (saveIpBtn && ipInput) {
    saveIpBtn.addEventListener("click", () => {
      const newIp = ipInput.value.trim();
      if (!newIp) return;
      chrome.storage.local.set({ targetIP: newIp });
      closeSettingsPanel();
    });
  }

  if (resetIpBtn && ipInput) {
    resetIpBtn.addEventListener("click", () => {
      const defaultIp = "192.168.0.66";
      ipInput.value = defaultIp;
      chrome.storage.local.set({ targetIP: defaultIp });
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const isLight = themeToggle.checked;
      document.documentElement.classList.toggle("light-theme", isLight);
      const nextTheme = isLight ? "light" : "dark";
      chrome.storage.local.set({ theme: nextTheme });
    });
  }
});

// ================================
// Submit button logic
// ================================
document.getElementById("submit").onclick = async () => {
  const userId = document.getElementById("uid").value.trim();
  const output = document.getElementById("output");

  // Validation
  if (userId === "") {
    output.innerText = "Error: Please enter your UID";
    return;
  }

  // Save UID permanently
  chrome.storage.local.set({ savedUID: userId });

  output.innerText = "Connecting...";

  try {
    const result = await doLogin(userId);

    if (result.ok) {
      output.innerText = "Connected";
      // Start background keep-alive so the session never expires (re-auth every 5 min).
      chrome.runtime.sendMessage({ action: "startKeepAlive" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Failed to start keep-alive:", chrome.runtime.lastError.message);
          return;
        }
        if (response && response.started) {
          const keepActiveNote = document.getElementById("keep-active-status");
          if (keepActiveNote) {
            keepActiveNote.textContent = "Keep active initialised";
            keepActiveNote.classList.add("visible");
          }
        }
      });
    } else {
      if (result.message && result.message.toLowerCase().includes("fetch")) {
        output.innerText = "Error: failed to fetch";
      } else {
        output.innerText = "Error: " + result.message;
      }
    }
  } catch (err) {
    console.error(err);
    output.innerText = "Error: failed to fetch";
  }
};
//  github version
