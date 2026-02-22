// ================================
// Load saved UID when popup opens
// ================================
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("savedUID", (data) => {
    if (data.savedUID) {
      document.getElementById("uid").value = data.savedUID;
    }
  });
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
      chrome.runtime.sendMessage({ action: "startKeepAlive" }, (r) => {
        if (r && r.started) {
          output.innerText += " Keep-alive on.";
        }
      });
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