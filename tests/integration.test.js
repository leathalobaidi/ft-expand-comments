"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeWindow, makeChromeStub, loadContentScript } = require("./harness");
const { buildThread, scenarios } = require("./fixtures");

function countCollapsed(root) {
  return Array.from(root.querySelectorAll("button")).filter((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Show comment by")
  ).length;
}

test("message 'expand' fully expands and reports counts", async () => {
  const built = buildThread(makeWindow, scenarios.withLoadMore());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, true);
    assert.ok(res.count > 0, "expanded some comments");
    assert.ok(res.loadMore >= 2, "drained Load More batches");
    assert.equal(res.stable, true);
    assert.equal(countCollapsed(built.shadowRoot), 0);
  } finally {
    restore();
  }
});

test("message 'collapse' collapses replies only", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    await stub.sendMessage({ action: "expand" });
    const res = await stub.sendMessage({ action: "collapse" });
    assert.equal(res.success, true);
    assert.ok(res.count > 0, "collapsed at least one reply");
  } finally {
    restore();
  }
});

test("message 'getState' reflects auto-expand + collapse flags", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    let state = await stub.sendMessage({ action: "getState" });
    assert.equal(state.autoExpandEnabled, false);

    await stub.sendMessage({ action: "setAutoExpand", enabled: true });
    state = await stub.sendMessage({ action: "getState" });
    assert.equal(state.autoExpandEnabled, true);

    await stub.sendMessage({ action: "collapse" });
    state = await stub.sendMessage({ action: "getState" });
    assert.equal(state.manualCollapseActive, true);
  } finally {
    restore();
  }
});

test("unknown action returns a clean error, not a throw", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "frobnicate" });
    assert.equal(res.success, false);
    assert.match(res.error, /unknown action/i);
  } finally {
    restore();
  }
});

test("storage.onChanged in another tab re-expands when enabled", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    // Prime cachedShadowRoot via a state query.
    await stub.sendMessage({ action: "getState" });
    assert.ok(countCollapsed(built.shadowRoot) > 0);

    stub.setStorage({ alwaysExpand: true }); // simulates toggle in another tab
    // autoExpandTick runs a single synchronous pass.
    assert.equal(
      countCollapsed(built.shadowRoot),
      0,
      "replies auto-expanded after cross-tab enable"
    );
  } finally {
    restore();
  }
});

test("double injection is a no-op (single message listener registered)", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const first = loadContentScript(built.window, stub.chrome);
  // Re-run on the same window/chrome — should bail out on __ftExpandInit.
  const second = loadContentScript(built.window, stub.chrome);
  try {
    assert.equal(stub.messageListeners.length, 1, "only one onMessage listener");
    const res = await stub.sendMessage({ action: "getState" });
    assert.equal(res.success, true);
  } finally {
    second.restore();
    first.restore();
  }
});
