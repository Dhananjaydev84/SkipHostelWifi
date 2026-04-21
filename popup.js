// ============================================================
// popup.js — UI logic for the SkipHostelWifi extension popup
// Responsibilities:
//   • Apply and persist the dark/light theme
//   • Sync the logo width to match the subtitle text width
//   • Handle the Connect button click → delegates to doLogin() in auth.js
//   • Listen for keep-alive status messages from background.js
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
  // Set the logo width equal to the subtitle width (+8px breathing room)
  // so both line up visually under the brand area.
  // Caps at the brand container width to avoid overflow.
  // ---------------------------------------------------------------------------
  const syncLogoWidthToSubtitle = () => {
    const subtitle = document.querySelector(".brand .subtitle");
    const logo     = document.querySelector(".title-logo");
    const brand    = document.querySelector(".brand");
    if (!subtitle || !logo || !brand) return;

    const targetWidth  = Math.ceil(subtitle.getBoundingClientRect().width + 8);
    const maxSafeWidth = Math.floor(brand.getBoundingClientRect().width);
    logo.style.width   = `${Math.min(targetWidth, maxSafeWidth)}px`;
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
    syncLogoWidthToSubtitle();
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
      syncLogoWidthToSubtitle();
    });
  }

  // ---------------------------------------------------------------------------
  // Sync logo width after fonts have fully loaded (avoids wrong measure on boot)
  // Falls back to a zero-delay setTimeout if the Fonts API isn't available.
  // Also re-syncs on window resize.
  // ---------------------------------------------------------------------------
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncLogoWidthToSubtitle);
  } else {
    setTimeout(syncLogoWidthToSubtitle, 0);
  }
  window.addEventListener("resize", syncLogoWidthToSubtitle);

  // ============================================================
  // Connect button — validates UID, calls doLogin() (auth.js),
  // saves the UID, displays feedback, and kicks off keep-alive
  // ============================================================
  document.getElementById("submit").onclick = async () => {
    document.getElementById("keepAliveStatus").textContent = "";
    document.getElementById("keepAliveStatus").classList.remove("visible");

    const userId = document.getElementById("uid").value.trim();
    const output = document.getElementById("output");

    // Guard: require a non-empty UID before attempting login
    if (userId === "") {
      output.innerText = "Error: Please enter your UID";
      return;
    }

    // Persist the UID so it's pre-filled next time the popup opens
    chrome.storage.local.set({ savedUID: userId });
    output.innerText = "Connecting...";

    try {
      // doLogin() is defined in auth.js and handles the Cyberoam/Sophos POST
      const result = await doLogin(userId);

      if (result && result.ok) {
        output.innerText = "Connected successfully!";
        // Tell background.js to start the keep-alive alarm
        chrome.runtime.sendMessage({ action: "startKeepAlive" }, (response) => {
          const el = document.getElementById("keepAliveStatus");
          if (response && response.started) {
            el.textContent = "Keep alive initialised";
          } else {
            el.textContent = "Error in Keep alive";
          }
          // Add "visible" class to trigger the CSS opacity fade-in transition
          el.classList.add("visible");
        });
      } else {
        output.innerText = (result && result.message) || "Login failed.";
      }
    } catch (err) {
      // Distinguish timeout vs network unavailable vs unexpected errors
      if (err.name === "AbortError") {
        output.innerText = "Timed out. Check your connection.";
      } else if (err.message && err.message.includes("Failed to fetch")) {
        output.innerText = "Already connected or portal unreachable.";
      } else {
        output.innerText = "Error: " + (err.message || err.name || String(err));
      }
    }
  };
});
