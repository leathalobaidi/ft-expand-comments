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

test("CHAOS: message before comments mount → clean 'not loaded' error", async () => {
  const { window } = makeWindow(); // no coral container at all
  const stub = makeChromeStub();
  const { restore } = loadContentScript(window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, false);
    assert.match(res.error, /not loaded/i);
  } finally {
    restore();
  }
});

test("CHAOS: rapid double 'expand' clicks do not crash and end fully expanded", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const [a, b] = await Promise.all([
      stub.sendMessage({ action: "expand" }),
      stub.sendMessage({ action: "expand" }),
    ]);
    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.equal(countCollapsed(built.shadowRoot), 0, "no collapsed replies remain");
  } finally {
    restore();
  }
});

test("CHAOS: stuck Load More via message stays bounded and resolves", async () => {
  const built = buildThread(makeWindow, scenarios.loadMoreStuck());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, true);
    assert.equal(res.stable, false, "honestly reports the thread may not be fully drained");
    // It still expands what it can (the one real reply).
    assert.equal(countCollapsed(built.shadowRoot), 0);
  } finally {
    restore();
  }
});

test("CHAOS: unknown / unexpected markup is ignored, not clicked", async () => {
  const built = buildThread(makeWindow, scenarios.empty());
  const doc = built.document;
  // Inject buttons that must never be clicked by the extension.
  ["Reply", "Report", "Share this", "Sign in", "Submit comment"].forEach((t) => {
    const b = doc.createElement("button");
    b.textContent = t;
    let clicked = false;
    b.addEventListener("click", () => (clicked = true));
    b._wasClicked = () => clicked;
    built.shadowRoot.appendChild(b);
  });
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, true);
    assert.equal(res.count, 0, "no comment toggles to click");
    const anyClicked = Array.from(built.shadowRoot.querySelectorAll("button")).some(
      (b) => b._wasClicked && b._wasClicked()
    );
    assert.equal(anyClicked, false, "action buttons were never clicked");
  } finally {
    restore();
  }
});

test("CHAOS: malformed comment nodes (missing labels) do not throw", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  const doc = built.document;
  // A button with no aria-label and no text, plus a wrapper with junk className.
  const junkWrap = doc.createElement("div");
  junkWrap.className = "coral-indent-notanumber";
  const junkBtn = doc.createElement("button");
  junkWrap.appendChild(junkBtn);
  built.shadowRoot.appendChild(junkWrap);

  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "expand" });
    assert.equal(res.success, true, "expand completed despite malformed node");
    assert.equal(countCollapsed(built.shadowRoot), 0);
  } finally {
    restore();
  }
});

test("CHAOS: corrupted storage value does not break setting load", async () => {
  const built = buildThread(makeWindow, scenarios.short());
  // alwaysExpand stored as a non-boolean string — must be coerced safely.
  const stub = makeChromeStub({ alwaysExpand: "yes-please" });
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    await stub.sendMessage({ action: "getState" });
    const state = await stub.sendMessage({ action: "getState" });
    // Non-true value must be treated as disabled, not crash.
    assert.equal(state.autoExpandEnabled, false);
    assert.equal(state.success, true);
  } finally {
    restore();
  }
});

test("CHAOS: collapse before expand is a safe no-op", async () => {
  const built = buildThread(makeWindow, scenarios.empty());
  const stub = makeChromeStub();
  const { restore } = loadContentScript(built.window, stub.chrome);
  try {
    const res = await stub.sendMessage({ action: "collapse" });
    assert.equal(res.success, true);
    assert.equal(res.count, 0);
  } finally {
    restore();
  }
});
