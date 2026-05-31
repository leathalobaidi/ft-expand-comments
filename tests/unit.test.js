"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeWindow, loadPureApi } = require("./harness");
const { buildThread, scenarios } = require("./fixtures");

const api = loadPureApi();

// Helper: count visible "Show comment by" (collapsed) toggles in a root.
function countCollapsed(root) {
  return Array.from(root.querySelectorAll("button")).filter((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Show comment by")
  ).length;
}
function countExpanded(root) {
  return Array.from(root.querySelectorAll("button")).filter((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Hide comment by")
  ).length;
}

test("getIndentLevel reads coral-indent-N and is robust to junk", () => {
  const { window } = makeWindow();
  const doc = window.document;
  const wrap = doc.createElement("div");
  wrap.className = "coral-comment coral-indent-3";
  const btn = doc.createElement("button");
  wrap.appendChild(btn);
  assert.equal(api.getIndentLevel(btn), 3);

  const orphan = doc.createElement("button");
  assert.equal(api.getIndentLevel(orphan), -1);
  assert.equal(api.getIndentLevel(null), -1);
  assert.equal(api.getIndentLevel(undefined), -1);
});

test("isLoadMoreTrigger classifies pagination vs action vs toggle buttons", () => {
  const { window } = makeWindow();
  const doc = window.document;
  const mk = (opts) => {
    const b = doc.createElement("button");
    if (opts.label) b.setAttribute("aria-label", opts.label);
    if (opts.text) b.textContent = opts.text;
    if (opts.disabled) b.disabled = true;
    return b;
  };

  // Positives
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Load More" })), true);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Show 3 more replies" })), true);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Read 5 more replies" })), true);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "View more comments" })), true);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "2 more replies" })), true);

  // Negatives — individual comment toggles
  assert.equal(api.isLoadMoreTrigger(mk({ label: "Show comment by Jane" })), false);
  assert.equal(api.isLoadMoreTrigger(mk({ label: "Hide comment by Jane" })), false);

  // Negatives — action buttons that contain "more"-ish words but are not pagination
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Reply" })), false);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Report" })), false);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Share" })), false);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Submit" })), false);
  assert.equal(api.isLoadMoreTrigger(mk({ text: "" })), false);

  // Disabled load-more (Coral disables while loading) must be skipped.
  assert.equal(api.isLoadMoreTrigger(mk({ text: "Load More", disabled: true })), false);
});

test("expandPass clicks collapsed reply toggles and returns counts", () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.short());
  const before = countCollapsed(shadowRoot);
  assert.ok(before > 0, "fixture should start with collapsed replies");

  const res = api.expandPass(shadowRoot);
  assert.equal(res.expanded, before);
  assert.equal(countCollapsed(shadowRoot), 0, "no collapsed replies remain after one pass");
});

test("expandPass on empty thread is a clean no-op", () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.empty());
  const res = api.expandPass(shadowRoot);
  assert.deepEqual(res, { expanded: 0, loadMore: 0 });
});

test("expandPass tolerates a null / invalid root", () => {
  assert.deepEqual(api.expandPass(null), { expanded: 0, loadMore: 0 });
  assert.deepEqual(api.expandPass({}), { expanded: 0, loadMore: 0 });
});

test("expandUntilStable fully expands deeply nested threads", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.nested());
  const res = await api.expandUntilStable(shadowRoot, { sleep: () => Promise.resolve() });
  assert.equal(res.stable, true);
  assert.equal(countCollapsed(shadowRoot), 0, "every nesting level expanded");
  // Top + L1a + L2a + L3a + L1b = 5 expanded comments
  assert.equal(countExpanded(shadowRoot), 5);
});

test("expandUntilStable drains Load More pagination", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.withLoadMore());
  const res = await api.expandUntilStable(shadowRoot, { sleep: () => Promise.resolve() });
  assert.equal(res.stable, true);
  assert.ok(res.loadMore >= 2, "should click Load More for each batch");
  assert.equal(countCollapsed(shadowRoot), 0);
  // First + Page2 + Page3 top-level, each with one expanded reply = 6 expanded
  assert.equal(countExpanded(shadowRoot), 6);
  // Load More button removed once drained
  assert.equal(shadowRoot.querySelector(".coral-load-more"), null);
});

test("expandUntilStable is bounded when Load More never resolves (no hang)", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.loadMoreStuck());
  const res = await api.expandUntilStable(shadowRoot, {
    sleep: () => Promise.resolve(),
    maxIterations: 50,
  });
  assert.equal(res.stable, false, "reports it did not reach a stable state");
  assert.ok(
    res.iterations < 50,
    "exits early via no-progress detection rather than looping to the cap"
  );
  assert.ok(res.iterations <= 5, `expected quick no-progress exit, got ${res.iterations}`);
});

test("collapseReplies collapses only replies (indent>=1), keeps top-level", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.short());
  await api.expandUntilStable(shadowRoot, { sleep: () => Promise.resolve() });
  const expandedBefore = countExpanded(shadowRoot);
  assert.ok(expandedBefore > 0);

  const collapsed = api.collapseReplies(shadowRoot);
  assert.ok(collapsed > 0);
  // Top-level (Alice, Dave) remain expanded; their replies are now collapsed.
  const stillExpanded = countExpanded(shadowRoot);
  assert.equal(stillExpanded, 2, "two top-level comments stay expanded");
});

test("huge thread (40 top-level, 80 replies) expands fully and stays bounded", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.huge());
  const res = await api.expandUntilStable(shadowRoot, { sleep: () => Promise.resolve() });
  assert.equal(res.stable, true);
  assert.equal(countCollapsed(shadowRoot), 0);
  assert.equal(countExpanded(shadowRoot), 120, "40 top-level + 80 replies expanded");
});

test("unicode / emoji author names are handled", async () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.unicode());
  const res = await api.expandUntilStable(shadowRoot, { sleep: () => Promise.resolve() });
  assert.equal(res.stable, true);
  assert.equal(countCollapsed(shadowRoot), 0);
});

test("expandPass(force=false) respects __ftUserCollapsed; force=true clears it", () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.short());
  const collapsedBtns = Array.from(shadowRoot.querySelectorAll("button")).filter((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Show comment by")
  );
  const before = collapsedBtns.length;
  assert.ok(before >= 2, "fixture starts with multiple collapsed replies");

  // The user deliberately collapsed this one.
  const userKept = collapsedBtns[0];
  userKept.__ftUserCollapsed = true;

  // Auto-expand (non-force) opens everything EXCEPT the user-collapsed reply.
  const res1 = api.expandPass(shadowRoot, false);
  assert.equal(res1.expanded, before - 1, "all but the user-collapsed reply expanded");
  assert.equal(countCollapsed(shadowRoot), 1, "the user-collapsed reply stays collapsed");
  assert.equal(userKept.__ftUserCollapsed, true, "mark preserved under non-force");

  // The popup's "Expand All" (force) overrides the user mark and clears it.
  const res2 = api.expandPass(shadowRoot, true);
  assert.equal(res2.expanded, 1, "the previously-kept reply now expands under force");
  assert.equal(userKept.__ftUserCollapsed, false, "force clears the user-collapse mark");
  assert.equal(countCollapsed(shadowRoot), 0, "nothing collapsed after a force pass");
});

test("expandPass with no force argument defaults to respecting user collapse", () => {
  const { shadowRoot } = buildThread(makeWindow, scenarios.short());
  const btn = Array.from(shadowRoot.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") || "").startsWith("Show comment by")
  );
  btn.__ftUserCollapsed = true;
  api.expandPass(shadowRoot); // legacy 1-arg call site
  assert.equal(countCollapsed(shadowRoot), 1, "default pass leaves the user-collapsed reply alone");
});
