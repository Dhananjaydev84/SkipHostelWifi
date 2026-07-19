// ============================================================
// popup.js — UI logic for the SkipHostelWifi extension popup
// Responsibilities:
//   • Apply and persist the dark/light theme
//   • Handle the Connect button click → delegates to background.js via message
//   • Display login status and keep-alive feedback
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

  // ---------------------------------------------------------------------------
  // Logo sources for dark and light themes
  // ---------------------------------------------------------------------------
  const LOGO_SOURCES = {
    light: "images/Main logo2 dark.png",  // darker logo on light backgrounds
    dark:  "images/Main logo2.png"        // lighter logo on dark backgrounds
  };

  // ---------------------------------------------------------------------------
  // Swap the logo image to match the current theme
  // Avoids unnecessary DOM writes if the src is already correct.
  // ---------------------------------------------------------------------------
  const applyThemeLogo = (theme) => {
    const logo = document.querySelector(".title-logo");
    if (!logo) return;
    const nextSrc = theme === "light" ? LOGO_SOURCES.light : LOGO_SOURCES.dark;
    if (nextSrc && logo.getAttribute("src") !== nextSrc) {
      logo.setAttribute("src", nextSrc);
    }
  };

  // ---------------------------------------------------------------------------
  // Apply a theme ("dark" | "light"):
  //   1. Toggle the CSS class on <html>
  //   2. Swap the logo image
  //   3. Sync the checkbox state
  //   4. Persist to localStorage (best-effort; may fail in service-worker context)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // On popup open: restore saved UID and the last-used theme.
  // Priority: chrome.storage.local → localStorage fallback → default "dark"
  // ---------------------------------------------------------------------------
  chrome.storage.local.get(["savedUID", "theme"], (data) => {
    // Pre-fill the UID field if previously saved
    if (data.savedUID) {
      document.getElementById("uid").value = data.savedUID;
    }

    // Read theme from localStorage as a fallback in case storage API lags
    const cachedTheme = (() => {
      try {
        return localStorage.getItem("theme");
      } catch (_e) {
        return null;
      }
    })();

    const theme = data.theme || cachedTheme || "dark";
    setTheme(theme);
  });

  // ---------------------------------------------------------------------------
  // Theme toggle switch — persists to chrome.storage so all contexts stay in sync
  // ---------------------------------------------------------------------------
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const nextTheme = themeToggle.checked ? "light" : "dark";
      setTheme(nextTheme);
      chrome.storage.local.set({ theme: nextTheme }); // sync to background/other pages
    });
  }

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
