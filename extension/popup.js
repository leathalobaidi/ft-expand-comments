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

  // Map raw chrome errors to something a human can act on.
  function friendlyError(message) {
    const m = (message || "").toLowerCase();
    if (m.includes("could not establish connection") || m.includes("receiving end does not exist")) {
      return "Open an FT article and scroll to the comments, then try again";
    }
    if (m.includes("not on an ft page")) {
      return "Open an FT article (www.ft.com) to use this";
    }
    if (m.includes("not loaded")) {
      return "Comments not loaded yet — scroll to the comments and retry";
    }
    return message || "Something went wrong";
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
    expandBtn.disabled = true;
    showStatus("Expanding…");
    try {
      const response = await sendMessageToContentScript("expand");
      if (response.count > 0) {
        const more = response.loadMore ? ` (+${response.loadMore} threads loaded)` : "";
        const partial = response.stable === false ? " — large thread, run again for the rest" : "";
        showStatus(`Expanded ${response.count} comments${more}${partial}`);
      } else if (response.loadMore > 0) {
        showStatus(`Loaded ${response.loadMore} more threads`);
      } else {
        showStatus("Nothing left to expand");
      }
    } catch (err) {
      showStatus(friendlyError(err.message), true);
    } finally {
      expandBtn.disabled = false;
    }
  });

  // Collapse All button
  collapseBtn.addEventListener("click", async () => {
    collapseBtn.disabled = true;
    try {
      const response = await sendMessageToContentScript("collapse");
      if (response.count > 0) {
        showStatus(`Collapsed ${response.count} replies`);
      } else {
        showStatus("No replies to collapse");
      }
    } catch (err) {
      showStatus(friendlyError(err.message), true);
    } finally {
      collapseBtn.disabled = false;
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
