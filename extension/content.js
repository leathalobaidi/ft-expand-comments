/**
 * FT Expand All Comments — content script
 *
 * Interacts with FT's Coral Talk comment widget (rendered inside a Shadow DOM
 * under #coral-shadow-container). Provides exhaustive expand-all, collapse-replies,
 * and an optional "Always Expand" auto mode.
 *
 * Structure: pure DOM helpers are defined at the top and exported for Node-based
 * unit tests. The browser runtime (Coral detection, observers, message handlers)
 * only runs when the chrome.* APIs are present, so requiring this file in jsdom
 * does not start any timers or listeners.
 */
(function (global) {
  "use strict";

  const CORAL_CONTAINER_ID = "coral-shadow-container";
  const CHECK_INTERVAL_MS = 2000;
  const MAX_WAIT_MS = 30000;
  // Bounds for the async "expand until stable" loop so a never-resolving
  // "Load More" can never hang the page.
  const EXPAND_MAX_ITERATIONS = 30;
  const EXPAND_SETTLE_MS = 350;
  const OBSERVER_DEBOUNCE_MS = 250;

  // ---------------------------------------------------------------------------
  // Pure DOM helpers (no chrome.* / no timers) — unit tested in /tests
  // ---------------------------------------------------------------------------

  /**
   * Get the indent level of a comment by walking up for a coral-indent-N class.
   * Returns the indent level (0 = top-level, 1+ = reply), or -1 if not found.
   * Defensive against non-element nodes and detached fragments.
   */
  function getIndentLevel(element) {
    let el = element;
    while (el && typeof el === "object") {
      const cls =
        typeof el.className === "string"
          ? el.className
          : el.className && typeof el.className.toString === "function"
          ? el.className.toString()
          : "";
      const match = cls.match(/coral-indent-(\d+)/);
      if (match) return parseInt(match[1], 10);
      el = el.parentElement;
    }
    return -1;
  }

  /**
   * Does this button expand an individually-collapsed comment?
   * Coral labels these "Show comment by <name>".
   */
  function isShowCommentButton(btn) {
    const label = (btn && btn.getAttribute && btn.getAttribute("aria-label")) || "";
    return label.indexOf("Show comment by") === 0;
  }

  /**
   * Does this button hide / collapse an individual comment?
   */
  function isHideCommentButton(btn) {
    const label = (btn && btn.getAttribute && btn.getAttribute("aria-label")) || "";
    return label.indexOf("Hide comment by") === 0;
  }

  /**
   * Is this a pagination affordance — "Load More", "Show N more replies",
   * "Read 3 more replies", "View more comments"? These reveal further comments
   * that must also be expanded for the expand to be exhaustive.
   *
   * Deliberately conservative: must look like a load/show-more control AND must
   * NOT be an action button (reply, report, share, like, submit, sign in) or an
   * individual comment toggle.
   */
  function isLoadMoreTrigger(btn) {
    if (!btn || btn.disabled) return false;
    const label = ((btn.getAttribute && btn.getAttribute("aria-label")) || "").toLowerCase();
    const text = ((btn.textContent || "") + "").trim().toLowerCase();
    const hay = (label + " " + text).trim();
    if (!hay) return false;

    // Never treat the per-comment caret toggles as pagination.
    if (label.indexOf("show comment by") === 0 || label.indexOf("hide comment by") === 0) {
      return false;
    }
    // Exclude interactive action controls.
    if (/\b(reply|respond|report|share|like|cancel|submit|sign in|sign up|post|edit|delete|flag|mute|follow)\b/.test(hay)) {
      return false;
    }
    // Positive signals for "reveal more".
    const looksLikeMore =
      /\b(load|show|view|read|see)\b[\s\S]{0,12}\b(more|all|\d+)\b/.test(hay) ||
      /\bmore (replies|comments)\b/.test(hay) ||
      /\b\d+\s+(more\s+)?(replies|comments)\b/.test(hay);
    return looksLikeMore;
  }

  // Depth counter so we can tell our own programmatic clicks apart from real
  // user clicks: any click dispatched while this is > 0 is one of ours.
  let _programmaticDepth = 0;
  function clickEl(el) {
    _programmaticDepth++;
    try {
      el.click();
    } finally {
      _programmaticDepth--;
    }
  }
  function isProgrammaticClick() {
    return _programmaticDepth > 0;
  }

  /**
   * One synchronous expansion sweep over a root (shadowRoot or element).
   * Clicks every collapsed-comment toggle and every load-more trigger found.
   *
   * When `force` is false (auto-expand), comments the user collapsed themselves
   * (marked with __ftUserCollapsed) are left alone so the auto-expander does not
   * fight a manual collapse. When `force` is true (the popup's "Expand All"),
   * everything is expanded and any user-collapse marks are cleared.
   *
   * Returns { expanded, loadMore } click counts.
   */
  function expandPass(root, force) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return { expanded: 0, loadMore: 0 };
    }
    const buttons = Array.from(root.querySelectorAll("button"));
    let expanded = 0;
    let loadMore = 0;
    for (const btn of buttons) {
      try {
        if (isShowCommentButton(btn)) {
          if (force || !btn.__ftUserCollapsed) {
            if (force) btn.__ftUserCollapsed = false;
            clickEl(btn);
            expanded++;
          }
        } else if (isLoadMoreTrigger(btn)) {
          clickEl(btn);
          loadMore++;
        }
      } catch (_) {
        /* a detached/disabled button — ignore and continue */
      }
    }
    return { expanded, loadMore };
  }

  /**
   * Collapse only reply comments (indent level >= 1). Top-level comments stay.
   * Returns the number of replies collapsed.
   */
  function collapseReplies(root) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    const buttons = Array.from(root.querySelectorAll("button"));
    let count = 0;
    for (const btn of buttons) {
      try {
        if (isHideCommentButton(btn) && getIndentLevel(btn) >= 1) {
          clickEl(btn);
          count++;
        }
      } catch (_) {
        /* ignore */
      }
    }
    return count;
  }

  /**
   * Repeatedly run expandPass until no further buttons are clicked (stable) or
   * a hard iteration cap is reached. `sleep` is injectable so tests run instantly.
   * Returns { expanded, loadMore, iterations, stable }.
   */
  async function expandUntilStable(root, opts) {
    opts = opts || {};
    const maxIterations = opts.maxIterations || EXPAND_MAX_ITERATIONS;
    const delayMs = opts.delayMs != null ? opts.delayMs : EXPAND_SETTLE_MS;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const force = opts.force === true;

    const buttonCount = (r) =>
      r && typeof r.querySelectorAll === "function" ? r.querySelectorAll("button").length : 0;

    let expanded = 0;
    let loadMore = 0;
    let iterations = 0;
    let noProgress = 0;
    let prevSig = -1;
    while (iterations < maxIterations) {
      const pass = expandPass(root, force);
      expanded += pass.expanded;
      loadMore += pass.loadMore;
      iterations++;
      if (pass.expanded === 0 && pass.loadMore === 0) {
        return { expanded, loadMore, iterations, stable: true };
      }
      // Allow async load-more network content to render before the next sweep.
      await sleep(delayMs);

      // Early exit if we only clicked load-more affordances and nothing in the
      // DOM actually changed — e.g. a stuck/inert "Load More". Avoids hammering
      // a non-responsive button up to the iteration cap.
      const sig = buttonCount(root);
      if (pass.expanded === 0 && sig === prevSig) {
        noProgress++;
        if (noProgress >= 2) {
          return { expanded, loadMore, iterations, stable: false };
        }
      } else {
        noProgress = 0;
      }
      prevSig = sig;
    }
    // Hit the iteration cap — bounded, never hangs.
    return { expanded, loadMore, iterations, stable: false };
  }

  const api = {
    getIndentLevel,
    isShowCommentButton,
    isHideCommentButton,
    isLoadMoreTrigger,
    expandPass,
    collapseReplies,
    expandUntilStable,
    CORAL_CONTAINER_ID,
  };

  // Export for Node-based unit tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  // Also expose on the global for in-page / harness debugging.
  if (global) {
    global.__ftExpand = api;
  }

  // ---------------------------------------------------------------------------
  // Browser runtime — only when running as a real content script.
  // ---------------------------------------------------------------------------
  const hasChrome =
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    chrome.storage &&
    typeof document !== "undefined";

  if (!hasChrome) return;

  // Guard against double injection (e.g. manual re-inject or duplicate registration).
  if (global.__ftExpandInit) {
    console.log("[FT Expand] Already initialised; skipping duplicate injection.");
    return;
  }
  global.__ftExpandInit = true;

  let autoExpandEnabled = false; // "Always Expand" setting
  let manualCollapseActive = false; // user clicked "Collapse All"
  let observer = null;
  let periodicCheck = null;
  let debounceTimer = null;
  let waitInterval = null;
  let cachedShadowRoot = null;

  function log() {
    try {
      console.log.apply(console, ["[FT Expand]"].concat([].slice.call(arguments)));
    } catch (_) {}
  }

  // In Node-based tests, timers must not keep the event loop alive. In the
  // browser, timer handles have no .unref(), so this is a harmless no-op.
  function unref(handle) {
    if (handle && typeof handle.unref === "function") handle.unref();
    return handle;
  }

  /**
   * Resolve the live Coral shadowRoot, re-acquiring it if the cached container
   * was detached (FT single-page navigation tears down and rebuilds it).
   */
  function getShadowRoot() {
    if (
      cachedShadowRoot &&
      cachedShadowRoot.host &&
      cachedShadowRoot.host.isConnected
    ) {
      attachUserToggleListener(cachedShadowRoot);
      return cachedShadowRoot;
    }
    const container = document.getElementById(CORAL_CONTAINER_ID);
    if (container && container.shadowRoot) {
      cachedShadowRoot = container.shadowRoot;
      // Ensure the manual-collapse listener is live even if waitForCoral
      // hasn't fired yet (e.g. popup interaction happened first).
      attachUserToggleListener(cachedShadowRoot);
      return cachedShadowRoot;
    }
    return null;
  }

  function autoExpandTick() {
    if (!autoExpandEnabled || manualCollapseActive) return;
    const sr = getShadowRoot();
    if (!sr) return;
    // Non-force: respect comments the user collapsed themselves.
    const { expanded, loadMore } = expandPass(sr, false);
    if (expanded || loadMore) {
      log(`Auto-expanded ${expanded} comments, clicked ${loadMore} load-more.`);
    }
  }

  // Detect a real user click on a comment's collapse/expand caret (inside the
  // Coral shadow root) so auto-expand doesn't undo a manual collapse. Runs in
  // the capture phase so we read the button's label BEFORE Coral flips it.
  let userToggleHandler = null;
  let listenerRoot = null;
  function attachUserToggleListener(shadowRoot) {
    if (!shadowRoot) return;
    // Idempotent: already listening on this exact root → nothing to do.
    if (listenerRoot === shadowRoot && userToggleHandler) return;
    // Switched roots (e.g. SPA re-render) → detach the old listener first.
    if (listenerRoot && userToggleHandler) {
      try {
        listenerRoot.removeEventListener("click", userToggleHandler, true);
      } catch (_) {}
    }
    listenerRoot = shadowRoot;
    userToggleHandler = (e) => {
      if (isProgrammaticClick()) return; // one of our own clicks — ignore
      const target = e.target;
      const btn =
        target && typeof target.closest === "function"
          ? target.closest("button")
          : null;
      if (!btn) return;
      if (isHideCommentButton(btn)) {
        btn.__ftUserCollapsed = true; // user is collapsing this comment
      } else if (isShowCommentButton(btn)) {
        btn.__ftUserCollapsed = false; // user is expanding this comment
      }
    };
    shadowRoot.addEventListener("click", userToggleHandler, true);
  }

  function teardown() {
    try {
      if (observer) observer.disconnect();
    } catch (_) {}
    try {
      if (listenerRoot && userToggleHandler) {
        listenerRoot.removeEventListener("click", userToggleHandler, true);
      }
    } catch (_) {}
    if (periodicCheck) clearInterval(periodicCheck);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (waitInterval) clearInterval(waitInterval);
    observer = null;
    periodicCheck = null;
    debounceTimer = null;
    waitInterval = null;
    userToggleHandler = null;
    listenerRoot = null;
  }
  // Exposed so tests (and any future cleanup needs) can stop all activity.
  global.__ftExpandTeardown = teardown;

  function initializeCommentHandling(shadowRoot) {
    cachedShadowRoot = shadowRoot;
    attachUserToggleListener(shadowRoot);

    chrome.storage.sync.get(["alwaysExpand"], (result) => {
      if (chrome.runtime.lastError) {
        log("storage.get error:", chrome.runtime.lastError.message);
      }
      autoExpandEnabled = !!(result && result.alwaysExpand === true);
      log("Always Expand setting:", autoExpandEnabled);
      autoExpandTick();
    });

    // Debounced MutationObserver to catch dynamically-added comments without
    // thrashing the DOM on every micro-mutation.
    observer = new MutationObserver(() => {
      if (!autoExpandEnabled || manualCollapseActive) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(autoExpandTick, OBSERVER_DEBOUNCE_MS);
    });
    observer.observe(shadowRoot, { childList: true, subtree: true });

    // Low-frequency fallback for content the observer misses.
    periodicCheck = unref(setInterval(autoExpandTick, CHECK_INTERVAL_MS));

    // Clean up on navigation away to avoid leaks.
    window.addEventListener("pagehide", teardown, { once: true });

    // Expose for debugging / legacy references.
    global.__ftExpandObserver = observer;
    global.__ftExpandInterval = periodicCheck;
    global.__ftExpandShadowRoot = shadowRoot;
  }

  function waitForCoral() {
    const startTime = Date.now();
    waitInterval = unref(
      setInterval(() => {
        const container = document.getElementById(CORAL_CONTAINER_ID);
        if (container && container.shadowRoot) {
          clearInterval(waitInterval);
          waitInterval = null;
          log("Coral comment widget found.");
          initializeCommentHandling(container.shadowRoot);
        } else if (Date.now() - startTime > MAX_WAIT_MS) {
          clearInterval(waitInterval);
          waitInterval = null;
          log("Coral not found within timeout (page may have no comments).");
        }
      }, 500)
    );
  }

  // Messages from the popup.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const sr = getShadowRoot();
    if (!sr) {
      sendResponse({ success: false, error: "Comments not loaded yet" });
      return true;
    }

    switch (message && message.action) {
      case "expand": {
        manualCollapseActive = false;
        // Explicit user action: force-expand everything, clearing prior manual
        // collapse marks.
        expandUntilStable(sr, { force: true })
          .then((res) => {
            log(
              `Manual expand: ${res.expanded} comments, ${res.loadMore} load-more, ` +
                `${res.iterations} passes, stable=${res.stable}.`
            );
            sendResponse({
              success: true,
              count: res.expanded,
              loadMore: res.loadMore,
              stable: res.stable,
            });
          })
          .catch((err) => {
            sendResponse({ success: false, error: (err && err.message) || "Expand failed" });
          });
        return true; // async
      }

      case "collapse": {
        manualCollapseActive = true;
        const collapseCount = collapseReplies(sr);
        log(`Manual collapse: ${collapseCount} replies.`);
        sendResponse({ success: true, count: collapseCount });
        return true;
      }

      case "setAutoExpand": {
        autoExpandEnabled = message.enabled === true;
        manualCollapseActive = false;
        log(`Auto-expand set to: ${autoExpandEnabled}`);
        if (autoExpandEnabled) {
          expandUntilStable(sr, { force: true })
            .then((res) => sendResponse({ success: true, count: res.expanded }))
            .catch(() => sendResponse({ success: true, count: 0 }));
          return true;
        }
        sendResponse({ success: true, count: 0 });
        return true;
      }

      case "getState": {
        sendResponse({
          success: true,
          autoExpandEnabled,
          manualCollapseActive,
          commentsLoaded: true,
        });
        return true;
      }

      default:
        sendResponse({ success: false, error: "Unknown action" });
        return true;
    }
  });

  // React to the setting being changed in another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.alwaysExpand) {
      autoExpandEnabled = changes.alwaysExpand.newValue === true;
      manualCollapseActive = false;
      log(`Always Expand changed to: ${autoExpandEnabled}`);
      autoExpandTick();
    }
  });

  waitForCoral();
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
