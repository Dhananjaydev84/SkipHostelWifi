// ================================
// Frontend: UI, theme, and submit handler
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

  chrome.storage.local.get(["savedUID", "theme"], (data) => {
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
  });

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const nextTheme = themeToggle.checked ? "light" : "dark";
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
// Submit button → calls doLogin() from auth.js
// ================================
document.getElementById("submit").onclick = async () => {
  const userId = document.getElementById("uid").value.trim();
  const output = document.getElementById("output");

  if (userId === "") {
    output.innerText = "Error: Please enter your UID";
    return;
  }

  chrome.storage.local.set({ savedUID: userId });
  output.innerText = "Connecting...";

  try {
    const result = await doLogin(userId);
    if (result && result.ok) {
      output.innerText = "Connected successfully!";
      chrome.runtime.sendMessage({ action: "startKeepAlive" });
    } else {
      output.innerText = (result && result.message) || "Login failed.";
    }
  } catch (err) {
    if (err.name === "AbortError") {
      output.innerText = "Timed out. Check your connection.";
    } else if (err.message && err.message.includes("Failed to fetch")) {
      output.innerText = "Already connected or portal unreachable.";
    } else {
      output.innerText = "Error: " + (err.message || err.name || String(err));
    }
  }
};

// ================================
// Keep-alive status feedback from background.js
// ================================
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "keepAliveStatus") {
    const el = document.getElementById("keepAliveStatus");
    if (message.status === "ok") {
      el.textContent = "Keep alive initialised";
    } else {
      el.textContent = "Error in Keep alive";
    }
    el.classList.add("visible"); // triggers fade-in
  }
});

