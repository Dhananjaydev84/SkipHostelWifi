// ================================
// Load saved UID, IP, and theme when popup opens
// ================================
document.addEventListener("DOMContentLoaded", () => {
  const LOGO_SOURCES = {
    light: "images/Main logo2 dark.png",
    dark: "images/Main logo2.png"
  };

  const applyThemeLogo = (theme) => {
    const logo = document.querySelector(".title-logo");
    if (!logo) return;

    const nextSrc = theme === "light" ? LOGO_SOURCES.light : LOGO_SOURCES.dark;
    if (nextSrc && logo.getAttribute("src") !== nextSrc) {
      logo.setAttribute("src", nextSrc);
    }
  };

  const syncLogoWidthToSubtitle = () => {
    const subtitle = document.querySelector(".brand .subtitle");
    const logo = document.querySelector(".title-logo");
    const brand = document.querySelector(".brand");
    if (!subtitle || !logo || !brand) return;

    const targetWidth = Math.ceil(subtitle.getBoundingClientRect().width + 8);
    const maxSafeWidth = Math.floor(brand.getBoundingClientRect().width);
    logo.style.width = `${Math.min(targetWidth, maxSafeWidth)}px`;
  };

  const setTheme = (theme) => {
    const isLight = theme === "light";
    document.documentElement.classList.toggle("light-theme", isLight);
    applyThemeLogo(theme);
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.checked = isLight;
    try {
      localStorage.setItem("theme", theme);
    } catch (_e) {
      // Ignore localStorage sync issues in restricted contexts.
    }
  };

  chrome.storage.local.get(
    ["savedUID", "theme", "keepAliveActive"],
    (data) => {
      if (data.savedUID) {
        document.getElementById("uid").value = data.savedUID;
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
      syncLogoWidthToSubtitle();

      // UI state based on keepAliveActive
      const submitBtn = document.getElementById("submit");
      const disconnectBtn = document.getElementById("disconnect");
      if (data.keepAliveActive) {
        submitBtn.classList.add("hidden");
        disconnectBtn.classList.remove("hidden");
      } else {
        submitBtn.classList.remove("hidden");
        disconnectBtn.classList.add("hidden");
      }

      const keepActiveNote = document.getElementById("keep-active-status");
      if (keepActiveNote) {
        keepActiveNote.textContent = data.keepAliveActive ? "Keep active initialised" : "";
        keepActiveNote.classList.toggle("visible", !!data.keepAliveActive);
      }
    }
  );

  const themeToggle = document.getElementById("theme-toggle");

  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const isLight = themeToggle.checked;
      const nextTheme = isLight ? "light" : "dark";
      setTheme(nextTheme);
      chrome.storage.local.set({ theme: nextTheme });
      syncLogoWidthToSubtitle();
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncLogoWidthToSubtitle);
  } else {
    setTimeout(syncLogoWidthToSubtitle, 0);
  }
  window.addEventListener("resize", syncLogoWidthToSubtitle);
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
      chrome.runtime.sendMessage({ action: "startKeepAlive", savedUID: userId }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Failed to start keep-alive:", chrome.runtime.lastError.message);
          return;
        }
        if (response && response.started) {
          showKeepActiveStatus("Keep active initialised");
          document.getElementById("submit").classList.add("hidden");
          document.getElementById("disconnect").classList.remove("hidden");
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

document.getElementById("disconnect").onclick = () => {
  const output = document.getElementById("output");
  const keepActiveNote = document.getElementById("keep-active-status");

  chrome.runtime.sendMessage({ action: "stopKeepAlive" }, (response) => {
    if (response && response.stopped) {
      output.innerText = "Disconnected";
      if (keepActiveNote) {
        keepActiveNote.textContent = "";
        keepActiveNote.classList.remove("visible");
      }
      document.getElementById("submit").classList.remove("hidden");
      document.getElementById("disconnect").classList.add("hidden");
    }
  });
};
