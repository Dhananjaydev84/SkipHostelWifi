// Shared login logic for popup and background (Cyberoam/Sophos portal).
  const DEFAULT_IP = "192.168.0.66";
  const PORT = "8090";

  function getAttr(tag, attrName) {
    const re = new RegExp(`${attrName}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
    const m = tag.match(re);
    return (m && (m[2] || m[3] || m[4])) ? (m[2] || m[3] || m[4]) : "";
  }

  function parseInputsFromHtml(html) {
    const tags = html.match(/<input\b[^>]*>/gi) || [];
    return tags.map((tag) => ({
      name: getAttr(tag, "name"),
      id: getAttr(tag, "id"),
      type: (getAttr(tag, "type") || "text").toLowerCase(),
      value: getAttr(tag, "value")
    }));
  }

  function getConfiguredIp() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get("targetIP", (data) => {
            const ip = data && data.targetIP ? data.targetIP : DEFAULT_IP;
            resolve(ip);
          });
        } else {
          resolve(DEFAULT_IP);
        }
      } catch (_e) {
        resolve(DEFAULT_IP);
      }
    });
  }

  async function getLoginUrls() {
    const ip = await getConfiguredIp();
    const base = `http://${ip}:${PORT}/`;
    return {
      loginBase: base,
      postUrl: `${base}login.xml`
    };
  }

  async function doLogin(userId) {
    try {
      if (!userId || !userId.trim()) {
        return { ok: false, message: "No UID" };
      }
      const uid = userId.trim();
      const { loginBase, postUrl } = await getLoginUrls();

      const response = await fetch(loginBase, { credentials: "include" });
      if (!response.ok) {
        return { ok: false, message: "Fetch failed: " + response.status };
      }

      const text = await response.text();

      let inputs = [];
      try {
        if (typeof DOMParser !== "undefined") {
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, "text/html");
          inputs = Array.from(doc.querySelectorAll("input")).map((i) => ({
            name: i.name || "",
            id: i.id || "",
            type: (i.type || "text").toLowerCase(),
            value: i.value || ""
          }));
        } else {
          // Service worker-safe HTML parsing fallback
          inputs = parseInputsFromHtml(text);
        }
      } catch (_e) {
        inputs = parseInputsFromHtml(text);
      }

      const formData = new URLSearchParams();
      let foundUser = false;
      let foundPass = false;

      inputs.forEach(function (input) {
        const name = input.name;
        if (!name) return;
        const lowerName = name.toLowerCase();
        const lowerId = (input.id || "").toLowerCase();
        if (lowerId === "username" || lowerName.includes("user")) {
          formData.append(name, uid);
          foundUser = true;
        } else if (lowerId === "password" || input.type === "password" || lowerName.includes("pass")) {
          formData.append(name, uid);
          foundPass = true;
        } else {
          formData.append(name, input.value);
        }
      });

      // Cyberoam/Sophos commonly uses mode=191. Even if portal branding isn't present,
      // it's safe to add when missing.
      if (!formData.has("mode")) formData.append("mode", "191");
      if (!foundUser) formData.append("username", uid);
      if (!foundPass) formData.append("password", uid);

      const loginResponse = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "include",
        body: formData
      });

      if (!loginResponse.ok) {
        return { ok: false, message: "Server: " + loginResponse.status };
      }

      const resultText = await loginResponse.text();
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
    } catch (error) {
      console.error("doLogin failed:", error);
      return { ok: false, message: "Fetch failed" };
    }
  }

