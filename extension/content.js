(function () {
  "use strict";

  const CORAL_CONTAINER_ID = "coral-shadow-container";
  const CHECK_INTERVAL_MS = 2000;
  const MAX_WAIT_MS = 30000;

  // State flags
  let autoExpandEnabled = false; // Controlled by "Always Expand" setting
  let manualCollapseActive = false; // Set true when user clicks "Collapse All"

  /**
   * Get the indent level of a comment by checking for coral-indent-N class.
   * Returns the indent level (0 = top-level, 1+ = replies), or -1 if not found.
   */
  function getIndentLevel(element) {
    let el = element;
    while (el) {
      const cls = el.className?.toString() || "";
      const match = cls.match(/coral-indent-(\d+)/);
      if (match) return parseInt(match[1]);
      el = el.parentElement;
    }
    return -1;
  }

  /**
   * Expand all collapsed comments (all indent levels).
   */
  function expandAllComments(shadowRoot) {
    const buttons = Array.from(shadowRoot.querySelectorAll("button"));
    let count = 0;
    buttons.forEach((btn) => {
      const label = btn.getAttribute("aria-label") || "";
      if (label.startsWith("Show comment by")) {
        btn.click();
        count++;
      }
    });
    return count;
  }

  /**
   * Collapse only reply comments (indent level >= 1).
   * Top-level comments (indent level 0) stay visible.
   */
  function collapseReplies(shadowRoot) {
    const buttons = Array.from(shadowRoot.querySelectorAll("button"));
    let count = 0;
    buttons.forEach((btn) => {
      const label = btn.getAttribute("aria-label") || "";
      if (label.startsWith("Hide comment by")) {
        const indentLevel = getIndentLevel(btn);
        if (indentLevel >= 1) {
          btn.click();
          count++;
        }
      }
    });
    return count;
  }

  /**
   * Wait for Coral to load, then set up monitoring.
   */
  function waitForCoral() {
    const startTime = Date.now();

    const interval = setInterval(() => {
      const container = document.getElementById(CORAL_CONTAINER_ID);
      if (container && container.shadowRoot) {
        clearInterval(interval);
        console.log("[FT Expand] Coral comment widget found.");
        initializeCommentHandling(container.shadowRoot);
      } else if (Date.now() - startTime > MAX_WAIT_MS) {
        clearInterval(interval);
        console.log("[FT Expand] Coral not found within timeout.");
      }
    }, 500);
  }

  /**
   * Initialize comment handling with MutationObserver and periodic check.
   */
  function initializeCommentHandling(shadowRoot) {
    // Check storage for "Always Expand" setting
    chrome.storage.sync.get(["alwaysExpand"], (result) => {
      autoExpandEnabled = result.alwaysExpand === true;
      console.log("[FT Expand] Always Expand setting:", autoExpandEnabled);

      // If always expand is enabled, do initial expansion
      if (autoExpandEnabled && !manualCollapseActive) {
        const count = expandAllComments(shadowRoot);
        if (count > 0) {
          console.log(`[FT Expand] Auto-expanded ${count} comments.`);
        }
      }
    });

    // MutationObserver to catch dynamically added comments
    const observer = new MutationObserver(() => {
      // Only auto-expand if enabled AND user hasn't manually collapsed
      if (autoExpandEnabled && !manualCollapseActive) {
        const count = expandAllComments(shadowRoot);
        if (count > 0) {
          console.log(`[FT Expand] Auto-expanded ${count} newly loaded comments.`);
        }
      }
    });

    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });

    // Periodic check as fallback
    const periodicCheck = setInterval(() => {
      if (autoExpandEnabled && !manualCollapseActive) {
        const count = expandAllComments(shadowRoot);
        if (count > 0) {
          console.log(`[FT Expand] Periodic check: expanded ${count} comments.`);
        }
      }
    }, CHECK_INTERVAL_MS);

    // Store references for cleanup
    window.__ftExpandObserver = observer;
    window.__ftExpandInterval = periodicCheck;
    window.__ftExpandShadowRoot = shadowRoot;
  }

  /**
   * Handle messages from the popup.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const shadowRoot = window.__ftExpandShadowRoot;

    if (!shadowRoot) {
      // Try to find it if not initialized yet
      const container = document.getElementById(CORAL_CONTAINER_ID);
      if (container && container.shadowRoot) {
        window.__ftExpandShadowRoot = container.shadowRoot;
      } else {
        sendResponse({ success: false, error: "Comments not loaded yet" });
        return true;
      }
    }

    const sr = window.__ftExpandShadowRoot;

    switch (message.action) {
      case "expand":
        // User clicked "Expand All" - expand everything and allow auto-expand
        manualCollapseActive = false;
        const expandCount = expandAllComments(sr);
        console.log(`[FT Expand] Manual expand: ${expandCount} comments.`);
        sendResponse({ success: true, count: expandCount });
        break;

      case "collapse":
        // User clicked "Collapse All" - collapse replies and pause auto-expand
        manualCollapseActive = true;
        const collapseCount = collapseReplies(sr);
        console.log(`[FT Expand] Manual collapse: ${collapseCount} replies.`);
        sendResponse({ success: true, count: collapseCount });
        break;

      case "setAutoExpand":
        // User toggled "Always Expand" setting
        autoExpandEnabled = message.enabled;
        manualCollapseActive = false; // Reset manual collapse state
        console.log(`[FT Expand] Auto-expand set to: ${autoExpandEnabled}`);

        // If enabled, immediately expand all
        if (autoExpandEnabled) {
          const count = expandAllComments(sr);
          sendResponse({ success: true, count: count });
        } else {
          sendResponse({ success: true, count: 0 });
        }
        break;

      case "getState":
        // Popup requesting current state
        sendResponse({
          success: true,
          autoExpandEnabled: autoExpandEnabled,
          manualCollapseActive: manualCollapseActive
        });
        break;

      default:
        sendResponse({ success: false, error: "Unknown action" });
    }

    return true; // Keep message channel open for async response
  });

  // Listen for storage changes (e.g., if user changes setting in another tab)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.alwaysExpand) {
      autoExpandEnabled = changes.alwaysExpand.newValue === true;
      manualCollapseActive = false;
      console.log(`[FT Expand] Always Expand changed to: ${autoExpandEnabled}`);

      const shadowRoot = window.__ftExpandShadowRoot;
      if (shadowRoot && autoExpandEnabled) {
        expandAllComments(shadowRoot);
      }
    }
  });

  // Start waiting for Coral
  waitForCoral();
})();
