"use strict";

/**
 * Deterministic Coral-Talk-like comment fixtures for jsdom.
 *
 * Mirrors the real FT/Coral behaviour the extension depends on:
 *   - Collapsed comments expose a button  aria-label="Show comment by <name>"
 *   - Expanded comments expose a button   aria-label="Hide comment by <name>"
 *   - Clicking "Show comment by" flips it to "Hide comment by" and renders that
 *     comment's (collapsed) replies into the DOM — replies do NOT exist in the
 *     DOM until their parent is expanded.
 *   - Clicking "Hide comment by" flips it back and removes the rendered replies.
 *   - Nesting is encoded with class "coral-indent-N" on the comment wrapper.
 *   - A "Load More" button appends the next batch of top-level comments, exactly
 *     like Coral's pagination. It disables itself while "loading" and removes
 *     itself when the queue is drained.
 *
 * No randomness, no Date.now — fully deterministic for reproducible tests.
 */

let uid = 0;
function nextId() {
  uid += 1;
  return uid;
}

/** Render one comment (and wire its expand/collapse toggle) into `parentEl`. */
function renderComment(doc, parentEl, spec, indent) {
  const wrapper = doc.createElement("div");
  wrapper.className = `coral-comment coral-indent-${indent}`;
  wrapper.setAttribute("data-comment-id", `c${nextId()}`);

  const body = doc.createElement("div");
  body.className = "coral-comment-body";
  body.textContent = spec.text || `Comment by ${spec.name}`;
  wrapper.appendChild(body);

  const toggle = doc.createElement("button");
  const collapsed = spec.collapsed !== false; // default collapsed
  const repliesHost = doc.createElement("div");
  repliesHost.className = "coral-replies";

  function setCollapsed(isCollapsed) {
    if (isCollapsed) {
      toggle.setAttribute("aria-label", `Show comment by ${spec.name}`);
      // remove rendered replies from the DOM
      while (repliesHost.firstChild) repliesHost.removeChild(repliesHost.firstChild);
    } else {
      toggle.setAttribute("aria-label", `Hide comment by ${spec.name}`);
      (spec.replies || []).forEach((r) => renderComment(doc, repliesHost, r, indent + 1));
    }
  }

  toggle.addEventListener("click", () => {
    const isNowCollapsed = (toggle.getAttribute("aria-label") || "").startsWith("Show comment by");
    setCollapsed(!isNowCollapsed);
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(repliesHost);
  parentEl.appendChild(wrapper);

  setCollapsed(collapsed);
  return wrapper;
}

/**
 * Build a full thread inside a fresh shadow root.
 *
 * options:
 *   topLevel:   array of comment specs rendered immediately (each expanded so its
 *               collapsed replies are reachable via "Show comment by" buttons).
 *   loadMoreBatches: array of arrays of specs; each "Load More" click renders the
 *               next batch. When empty the Load More button removes itself.
 *   loadMoreLabel:   text for the load-more button (default "Load More").
 *   loadMoreNeverResolves: if true, clicking Load More does nothing (stays put) —
 *               used to prove the expand loop is bounded and never hangs.
 *   loadMoreAsync:   if true, batches render on a microtask/timeout after click
 *               (exercises the settle delay in expandUntilStable).
 *
 * Returns { window, document, container, shadowRoot, commentsEl }.
 */
function buildThread(makeWindow, options = {}) {
  const { window } = makeWindow();
  const doc = window.document;

  const container = doc.createElement("div");
  container.id = "coral-shadow-container";
  doc.body.appendChild(container);
  const shadowRoot = container.attachShadow({ mode: "open" });

  const commentsEl = doc.createElement("div");
  commentsEl.className = "coral-comments";
  shadowRoot.appendChild(commentsEl);

  // Top-level comments are shown expanded so their collapsed replies surface as
  // "Show comment by" toggles (this is what the extension hunts for).
  (options.topLevel || []).forEach((spec) =>
    renderComment(doc, commentsEl, Object.assign({ collapsed: false }, spec), 0)
  );

  const batches = (options.loadMoreBatches || []).slice();
  if (batches.length > 0 || options.loadMoreNeverResolves) {
    const loadMore = doc.createElement("button");
    loadMore.className = "coral-load-more";
    loadMore.textContent = options.loadMoreLabel || "Load More";
    loadMore.addEventListener("click", () => {
      if (options.loadMoreNeverResolves) return; // intentionally inert
      const batch = batches.shift();
      const render = () => {
        if (batch) {
          batch.forEach((spec) =>
            renderComment(doc, commentsEl, Object.assign({ collapsed: false }, spec), 0)
          );
        }
        if (batches.length === 0 && loadMore.parentNode) {
          loadMore.parentNode.removeChild(loadMore);
        } else {
          loadMore.disabled = false;
        }
      };
      if (options.loadMoreAsync) {
        loadMore.disabled = true; // Coral disables while loading
        window.setTimeout(render, 5);
      } else {
        render();
      }
    });
    shadowRoot.appendChild(loadMore);
  }

  return { window, document: doc, container, shadowRoot, commentsEl };
}

// ---- Named scenarios used across the suites ----------------------------------

function reply(name, replies) {
  return { name, collapsed: true, replies: replies || [] };
}

const scenarios = {
  empty: () => ({ topLevel: [] }),

  short: () => ({
    topLevel: [
      { name: "Alice", replies: [reply("Bob"), reply("Carol")] },
      { name: "Dave", replies: [reply("Erin")] },
    ],
  }),

  nested: () => ({
    topLevel: [
      {
        name: "Top",
        replies: [reply("L1a", [reply("L2a", [reply("L3a")])]), reply("L1b")],
      },
    ],
  }),

  huge: () => ({
    topLevel: Array.from({ length: 40 }, (_, i) => ({
      name: `User${i}`,
      replies: [reply(`User${i}-r1`), reply(`User${i}-r2`)],
    })),
  }),

  unicode: () => ({
    topLevel: [
      { name: "李雷", replies: [reply("Ünüsé 😀"), reply("Ω≈ç√")] },
      { name: "محمد", replies: [reply("Zoë")] },
    ],
  }),

  withLoadMore: () => ({
    topLevel: [{ name: "First", replies: [reply("FirstReply")] }],
    loadMoreBatches: [
      [{ name: "Page2", replies: [reply("Page2Reply")] }],
      [{ name: "Page3", replies: [reply("Page3Reply")] }],
    ],
  }),

  withLoadMoreAsync: () => ({
    topLevel: [{ name: "First", replies: [reply("FirstReply")] }],
    loadMoreAsync: true,
    loadMoreBatches: [
      [{ name: "Page2", replies: [reply("Page2Reply")] }],
      [{ name: "Page3", replies: [reply("Page3Reply")] }],
    ],
  }),

  loadMoreStuck: () => ({
    topLevel: [{ name: "Only", replies: [reply("OnlyReply")] }],
    loadMoreNeverResolves: true,
  }),
};

module.exports = { buildThread, renderComment, scenarios, reply };
