"use strict";

/**
 * Regression: with "Always Expand" ON, collapsing a comment via the page's own
 * caret used to be instantly undone by the auto-expander. These tests reproduce
 * that and lock in the fix (user collapses are respected; popup "Expand All"
 * still force-expands).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeWindow, makeChromeStub, loadContentScript } = require("./harness");
const { buildThread, scenarios } = require("./fixtures");

function buttons(root) {
  return Array.from(root.querySelectorAll("button"));
}
function countCollapsed(root) {
  return buttons(root).filter((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Show comment by")
  ).length;
}
function indentOf(el) {
  let node = el;
  while (node) {
    const m = (node.className || "").match && (node.className || "").match(/coral-indent-(\d+)/);
    if (m) return parseInt(m[1], 10);
    node = node.parentElement;
  }
  return -1;
}
// Find an expanded reply's "Hide comment by" caret (indent >= 1).
function findReplyHideButton(root) {
  return buttons(root).find(
    (b) =>
      (b.getAttribute("aria-label") || "").startsWith("Hide comment by") &&
      indentOf(b) >= 1
  );
}

test("REGRESSION: with Always Expand ON, a user collapse is NOT auto-undone", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    // Turn Always Expand on → everything expands.
    await stub.sendMessage({ action: "setAutoExpand", enabled: true });
    assert.equal(countCollapsed(built.shadowRoot), 0, "all expanded after enabling");

    // User collapses one reply via the in-page caret (a real, non-programmatic click).
    const hideBtn = findReplyHideButton(built.shadowRoot);
    assert.ok(hideBtn, "found an expanded reply to collapse");
    hideBtn.click();
    assert.equal(countCollapsed(built.shadowRoot), 1, "the reply is now collapsed");

    // Fire another auto-expand tick (simulating the observer / cross-tab change).
    stub.setStorage({ alwaysExpand: true });

    // BUG WAS: the auto-expander re-opened it → count back to 0.
    assert.equal(
      countCollapsed(built.shadowRoot),
      1,
      "auto-expand must respect the user's manual collapse"
    );
  } finally {
    restore();
  }
});

test("REGRESSION: popup 'Expand All' force-clears a user collapse", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    await stub.sendMessage({ action: "setAutoExpand", enabled: true });
    const hideBtn = findReplyHideButton(built.shadowRoot);
    hideBtn.click();
    assert.equal(countCollapsed(built.shadowRoot), 1);

    // Explicit Expand All overrides the manual-collapse memory.
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, true);
    assert.equal(countCollapsed(built.shadowRoot), 0, "force expand re-opens everything");

    // And a subsequent auto tick keeps it open (flag was cleared).
    stub.setStorage({ alwaysExpand: true });
    assert.equal(countCollapsed(built.shadowRoot), 0);
  } finally {
    restore();
  }
});

test("REGRESSION: programmatic expand does not mark comments as user-collapsed", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    // Auto-expand (programmatic) should never set the user-collapse flag.
    await stub.sendMessage({ action: "setAutoExpand", enabled: true });
    const anyMarked = buttons(built.shadowRoot).some((b) => b.__ftUserCollapsed === true);
    assert.equal(anyMarked, false, "no button wrongly flagged from our own clicks");
  } finally {
    restore();
  }
});
