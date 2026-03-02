// ================================
// Load saved UID, IP, and theme when popup opens
// ================================
document.addEventListener("DOMContentLoaded", () => {
  const setTheme = (theme) => {
    const isLight = theme === "light";
    document.documentElement.classList.toggle("light-theme", isLight);
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.checked = isLight;
    try {
      localStorage.setItem("theme", theme);
    } catch (_e) {
      // Ignore localStorage sync issues in restricted contexts.
    }
  };

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

    const cachedTheme = (() => {
      try {
        return localStorage.getItem("theme");
      } catch (_e) {
        return null;
      }
    })();
    const theme = data.theme || cachedTheme || "dark";
    setTheme(theme);
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
      const nextTheme = isLight ? "light" : "dark";
      setTheme(nextTheme);
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
  const keepActiveNote = document.getElementById("keep-active-status");
  const showKeepActiveStatus = (message) => {
    if (!keepActiveNote) return;
    keepActiveNote.textContent = message;
    keepActiveNote.classList.add("visible");
  };
  const clearKeepActiveStatus = () => {
    if (!keepActiveNote) return;
    keepActiveNote.textContent = "";
    keepActiveNote.classList.remove("visible");
  };

  // Validation
  if (userId === "") {
    output.innerText = "Error: Please enter your UID";
    return;
  }

  // Save UID permanently
  chrome.storage.local.set({ savedUID: userId });

  output.innerText = "Connecting...";
  clearKeepActiveStatus();

  try {
    const result = await doLogin(userId);
    const message = result && result.message ? String(result.message) : "";
    const isFetchError = message.toLowerCase().includes("fetch");

    if (result && result.ok) {
      output.innerText = "Connected";
      // Start background keep-alive so the session never expires (re-auth every 5 min).
      chrome.runtime.sendMessage({ action: "startKeepAlive" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Failed to start keep-alive:", chrome.runtime.lastError.message);
          return;
        }
        if (response && response.started) {
          showKeepActiveStatus("Keep active initialised");
        }
      });
    } else {
      if (isFetchError) {
        output.innerText = "Error";
        showKeepActiveStatus("Failed to fetch. Please check connection status and try again");
      } else {
        output.innerText = "Error: " + message;
      }
    }
  } catch (err) {
    console.error(err);
    output.innerText = "Error";
    showKeepActiveStatus("Failed to fetch. Please check connection status and try again");
  }
};
//  github version
