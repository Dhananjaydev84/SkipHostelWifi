// ================================
// Load saved UID, IP, and theme when popup opens
// ================================
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["savedUID", "targetIP", "theme"], (data) => {
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
      if (themeToggle) themeToggle.textContent = "☀";
    } else {
      document.documentElement.classList.remove("light-theme");
      if (themeToggle) themeToggle.textContent = "🌙";
    }
  });

  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const saveIpBtn = document.getElementById("save-ip");
  const ipInput = document.getElementById("target-ip");
  const themeToggle = document.getElementById("theme-toggle");

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener("click", () => {
      settingsPanel.classList.toggle("hidden");
      if (!settingsPanel.classList.contains("hidden") && ipInput) {
        chrome.storage.local.get("targetIP", (data) => {
          ipInput.value = data.targetIP || "192.168.0.66";
        });
      }
    });
  }

  if (saveIpBtn && ipInput) {
    saveIpBtn.addEventListener("click", () => {
      const newIp = ipInput.value.trim();
      if (!newIp) return;
      chrome.storage.local.set({ targetIP: newIp });
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const isLight = document.documentElement.classList.toggle("light-theme");
      const nextTheme = isLight ? "light" : "dark";
      themeToggle.textContent = isLight ? "☀" : "🌙";
      chrome.storage.local.set({ theme: nextTheme });
    });
  }
});

// ================================
// Submit button logic
// ================================
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
      output.innerText = result.message === "Connected" ? "Connected successfully!" : "Command sent (check access).";
      // Start background keep-alive so the session never expires (re-auth every 5 min).
      chrome.runtime.sendMessage({ action: "startKeepAlive" }, () => {});
    } else {
      if (result.message === "Data limit reached") {
        output.innerText = "Login Failed: Data limit reached.";
      } else if (result.message === "Check ID/Password") {
        output.innerText = "Login Failed: Check ID/Password.";
      } else {
        output.innerText = "Error: " + result.message;
      }
    }
  } catch (err) {
    console.error(err);
    output.innerText = "Error: " + err.message;
  }
};
//  github version 