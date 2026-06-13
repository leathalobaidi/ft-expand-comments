document.addEventListener("DOMContentLoaded", () => {
  const expandBtn = document.getElementById("expandBtn");
  const collapseBtn = document.getElementById("collapseBtn");
  const alwaysExpandToggle = document.getElementById("alwaysExpandToggle");
  const statusDiv = document.getElementById("status");

  // Load saved "Always Expand" setting
  chrome.storage.sync.get(["alwaysExpand"], (result) => {
    alwaysExpandToggle.checked = result.alwaysExpand === true;
  });

  let statusTimer = null;
  function showStatus(message, isError = false, sticky = false) {
    statusDiv.textContent = message;
    statusDiv.className = "status " + (isError ? "error" : "success");
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) {
      statusTimer = setTimeout(() => {
        statusDiv.className = "status";
      }, 3000);
    }
  }

  // Grey the action buttons out immediately when this isn't an FT tab, instead
  // of letting the user click into an error.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] && tabs[0].url;
    // activeTab makes the URL visible here; if it isn't, fail open.
    if (url !== undefined && !String(url).includes("ft.com")) {
      expandBtn.disabled = true;
      collapseBtn.disabled = true;
      showStatus("Open an FT article (www.ft.com) to use this", true, true);
    }
  });

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

  function sendOnce(tabId, payload) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      });
    });
  }

  // The content script is missing on FT tabs that were already open when the
  // extension was installed or updated. activeTab + scripting lets us inject
  // it on demand so the popup "just works" without a page reload.
  function injectContentScript(tabId) {
    return new Promise((resolve, reject) => {
      if (!chrome.scripting || !chrome.scripting.executeScript) {
        reject(new Error("scripting unavailable"));
        return;
      }
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  async function sendMessageToContentScript(action, data = {}) {
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !tab.url.includes("ft.com")) {
      throw new Error("Not on an FT page");
    }
    const payload = { action, ...data };
    try {
      return await sendOnce(tab.id, payload);
    } catch (err) {
      const m = (err.message || "").toLowerCase();
      const noReceiver =
        m.includes("could not establish connection") || m.includes("receiving end does not exist");
      if (!noReceiver) throw err;
      await injectContentScript(tab.id);
      await new Promise((r) => setTimeout(r, 400));
      return await sendOnce(tab.id, payload);
    }
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
      await sendMessageToContentScript("setAutoExpand", { enabled });
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
