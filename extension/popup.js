document.addEventListener("DOMContentLoaded", () => {
  const expandBtn = document.getElementById("expandBtn");
  const collapseBtn = document.getElementById("collapseBtn");
  const alwaysExpandToggle = document.getElementById("alwaysExpandToggle");
  const statusDiv = document.getElementById("status");

  // Load saved "Always Expand" setting
  chrome.storage.sync.get(["alwaysExpand"], (result) => {
    alwaysExpandToggle.checked = result.alwaysExpand === true;
  });

  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = "status " + (isError ? "error" : "success");
    setTimeout(() => {
      statusDiv.className = "status";
    }, 3000);
  }

  function sendMessageToContentScript(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];

        if (!tab || !tab.url || !tab.url.includes("ft.com")) {
          reject(new Error("Not on an FT page"));
          return;
        }

        chrome.tabs.sendMessage(tab.id, { action, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || "Unknown error"));
          }
        });
      });
    });
  }

  // Expand All button
  expandBtn.addEventListener("click", async () => {
    try {
      const response = await sendMessageToContentScript("expand");
      if (response.count > 0) {
        showStatus(`Expanded ${response.count} comments`);
      } else {
        showStatus("No comments to expand");
      }
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  // Collapse All button
  collapseBtn.addEventListener("click", async () => {
    try {
      const response = await sendMessageToContentScript("collapse");
      if (response.count > 0) {
        showStatus(`Collapsed ${response.count} replies`);
      } else {
        showStatus("No replies to collapse");
      }
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  // Always Expand toggle
  alwaysExpandToggle.addEventListener("change", async () => {
    const enabled = alwaysExpandToggle.checked;

    // Save to storage (persists across sessions)
    chrome.storage.sync.set({ alwaysExpand: enabled });

    // Notify content script of the change
    try {
      const response = await sendMessageToContentScript("setAutoExpand", { enabled });
      if (enabled) {
        showStatus("Always Expand enabled");
      } else {
        showStatus("Always Expand disabled");
      }
    } catch (err) {
      // If content script isn't ready, that's okay - storage is saved
      if (enabled) {
        showStatus("Enabled (reload page to apply)");
      } else {
        showStatus("Disabled");
      }
    }
  });
});
