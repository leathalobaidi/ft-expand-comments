# FT Expand All Comments — Build, Test & Hardening Report (v2.1)

**Date:** 2026-05-31
**Scope:** Autonomous end-to-end audit, repair, test-harness build, chaos testing, and
expert-persona review of the Chrome extension at `leathalobaidi/ft-expand-comments`.
**Result:** ✅ **READY** — 29/29 automated tests pass; no blocking persona objections remain.

---

## 1. Readiness verdict

**Yes — ready for a real first-time FT reader.** The extension now expands comment threads
*exhaustively* (nested replies + "Load More" pagination, not just top-level toggles), handles
empty/huge/malformed/unicode threads without crashing, recovers from single-page navigation,
guards against double injection and timer leaks, and degrades to clear, human-readable messages
when comments aren't loaded. The core DOM logic is covered by 29 automated tests (unit +
integration + chaos). The one accessibility gap found in review (an unlabelled toggle) is fixed.
Residual risk is the usual one for any DOM-scraping extension: FT changing Coral's markup/labels —
mitigated with conservative, well-bounded selectors but not eliminable.

---

## 2. What changed (repair & hardening)

| # | Change | Why |
|---|--------|-----|
| 1 | **Exhaustive expand** — `expandUntilStable` now clicks "Load More" / "Show N more replies" pagination and loops until the thread is stable | Old code only clicked individual `Show comment by` toggles, leaving long threads partially loaded |
| 2 | **Bounded, non-hanging loop** — hard iteration cap (30) + no-progress early exit | A stuck/inert "Load More" can never hang the page; stops in ~3 passes |
| 3 | **Double-injection guard** (`__ftExpandInit`) | Re-injection would otherwise stack observers/intervals |
| 4 | **Debounced MutationObserver** (250 ms) | Old observer ran a full sweep on every micro-mutation |
| 5 | **SPA re-acquire** (`getShadowRoot` re-queries if container detached) | FT client-side nav swaps the Coral container; stale ref went dead |
| 6 | **Leak cleanup** — observer + all intervals tracked and cleared on `pagehide`; timers `unref()`'d | Old observer/intervals ran for the whole page lifetime, never disconnected |
| 7 | **Friendlier popup errors** — maps raw `Could not establish connection` to actionable text; disables buttons + "Expanding…" feedback | Old popup surfaced raw Chrome errors |
| 8 | **Accessibility** — `lang="en"`, `role="status"`/`aria-live` on status, `aria-labelledby`/`aria-describedby` on the toggle | Toggle had no programmatic accessible name |
| 9 | **Testability** — pure DOM helpers exported for Node; runtime only starts under real `chrome.*` | Logic was locked inside an IIFE, untestable |
| 10 | Version bump `2.0 → 2.1` | Hardening release |

---

## 3. PASS/FAIL matrix

| Area | Test | Expected | Result |
|------|------|----------|--------|
| Install/load | Manifest valid MV3, content script + popup wired | loads clean | ✅ PASS |
| Pure logic | `getIndentLevel` reads `coral-indent-N`, robust to junk/null | correct level / -1 | ✅ PASS |
| Pure logic | `isLoadMoreTrigger` matches pagination, rejects toggles + action buttons + disabled | correct classification | ✅ PASS |
| Expand | `expandPass` clicks collapsed reply toggles | all collapsed → expanded | ✅ PASS |
| Expand | empty thread | clean no-op | ✅ PASS |
| Expand | null/invalid root | no throw | ✅ PASS |
| Expand | deeply nested (4 levels) | every level expanded | ✅ PASS |
| Expand | Load More pagination (multi-batch) | all batches drained, button removed | ✅ PASS |
| Expand | stuck Load More | bounded, `stable:false`, no hang | ✅ PASS |
| Expand | huge (40 top + 80 replies) | 120 expanded, bounded | ✅ PASS |
| Expand | unicode/emoji names | fully expanded | ✅ PASS |
| Collapse | replies only (indent ≥ 1), top-level kept | 2 top-level remain | ✅ PASS |
| Message API | `expand` reports count/loadMore/stable | success + counts | ✅ PASS |
| Message API | `collapse` | success + count | ✅ PASS |
| Message API | `getState` reflects flags | accurate | ✅ PASS |
| Message API | unknown action | clean error, no throw | ✅ PASS |
| Message API | cross-tab `storage.onChanged` re-expands | auto-expands | ✅ PASS |
| Robustness | double injection | single listener, no-op | ✅ PASS |
| **Chaos** | message before mount | clean "not loaded" error | ✅ PASS |
| **Chaos** | rapid double-click expand | no crash, fully expanded | ✅ PASS |
| **Chaos** | stuck Load More via message | bounded, resolves | ✅ PASS |
| **Chaos** | unknown markup (Reply/Report/Share/Sign in/Submit) | never clicked | ✅ PASS |
| **Chaos** | malformed nodes (no label, junk indent) | no throw | ✅ PASS |
| **Chaos** | corrupted storage value | coerced safely to disabled | ✅ PASS |
| **Chaos** | collapse before expand | safe no-op | ✅ PASS |
| Popup a11y | `lang`, live region, toggle accessible name, button text, disabled style | all present | ✅ PASS (5 tests) |

**Totals: 29 tests, 29 pass, 0 fail** (`cd tests && npm install && node --test`).

---

## 4. Bug log

| ID | Severity | Bug | Repro | Fix |
|----|----------|-----|-------|-----|
| B1 | High | Expand not exhaustive — long threads stay partly collapsed; "Load More" / "Show N more replies" never clicked | Open a long FT thread, click Expand All → buried replies/extra pages remain hidden | `expandUntilStable` + `isLoadMoreTrigger` (changes #1/#2); tests cover nested + multi-batch |
| B2 | Med | Observer + 2 intervals never disconnected → leak across SPA nav | Navigate between FT articles in one tab | `teardown()` on `pagehide`; timers tracked + `unref()` (change #6) |
| B3 | Med | Stale shadowRoot after FT client-side navigation | SPA-navigate to a new article, use popup → "not loaded" or no-op | `getShadowRoot()` re-acquires on detached container (change #5) |
| B4 | Med | No debounce; full DOM sweep per mutation on large threads | Auto-expand on a busy thread | 250 ms debounce (change #4) |
| B5 | Low | Double injection would stack observers/intervals | Re-inject content script | `__ftExpandInit` guard (change #3) |
| B6 | Low | Raw Chrome error shown to user ("Could not establish connection…") | Click Expand on an FT page before comments load | `friendlyError()` mapping (change #7) |
| B7 | Low (a11y) | "Always Expand" checkbox had no accessible name | Screen reader on popup | `aria-labelledby`/`aria-describedby` (change #8) |

No open bugs.

---

## 5. Expert review panel

| Persona | Verdict | Top objections | Resolution |
|---------|---------|----------------|------------|
| **Steve Jobs** | Pass | (1) No visual feedback on the button while working; (2) why open the popup every time? (3) wording | JOBS-1 fixed: `:disabled` style + "Expanding…" status. (2) addressed by existing **Always Expand**; on-page button deemed out of scope for a 1-job utility. |
| **Peter Thiel** | Pass | Defensibility — is it more than "another filter"? | It restores a capability FT *removed* (one-click expand-all) — a concrete utility, not a marginal filter. No code change. |
| **Bill Gates** | Pass | 10k-comment scale, data integrity, what breaks at volume | Bounded loop + debounce + no-progress exit; huge-thread test (120 nodes) passes; each pass is O(n) but only on explicit user action. No blocking. |
| **FT Product / Editorial Lead** | Pass | ToS, scraping, paywall, minimal permissions | Extension only clicks UI controls — reads no comment text, sends nothing externally, stores one boolean, `activeTab`+`storage` only, matches `www.ft.com` only. Compliant. |
| **Accessibility Advocate** | Pass *(after fix)* | **Blocking:** unlabelled toggle; live-region for status | A11Y-1 fixed: `aria-labelledby`/`aria-describedby` on toggle, `role=status`/`aria-live` on status, `lang`. Locked by `popup.test.js`. |
| **Power Commenter** | Pass | Does expand-all *truly* get every buried sub-reply and every "load more"? | Yes — `expandUntilStable` recurses + drains pagination; nested + multi-batch tests prove it; partial-state honestly reported ("run again for the rest"). |

No blocking objections remain after two full loops.

---

## 6. Assumptions made

1. **Coral aria-labels** — the extension keys off `Show comment by …` / `Hide comment by …`. Assumed current and stable (consistent with the existing code and README). A reskin by FT would require selector updates.
2. **Pagination copy** — `isLoadMoreTrigger` matches "Load More", "Show/Read/View N more replies/comments". Assumed to cover Coral's real button text; deliberately conservative to avoid clicking action buttons.
3. **Coral disables "Load More" while loading** — relied upon so we don't double-fire; `isLoadMoreTrigger` skips `disabled` buttons. The stuck-button path is the safety net if this assumption fails.
4. **Live ft.com is paywalled/rate-limited** — so testing is against deterministic offline jsdom fixtures that replicate Coral's shadow-DOM behaviour, not the live site. Fixture fidelity is the limit of this test layer; a one-off manual smoke test on a real FT article is recommended before Web Store submission.
5. **Settle delay (350 ms)** between expand passes is enough for async "Load More" content to render in a real browser. Tunable via `EXPAND_SETTLE_MS`.
6. **Single-page navigation** on FT rebuilds `#coral-shadow-container`; re-acquire logic assumes the container id is stable.
7. **MV3 content-script model** — no service worker needed; all logic is in the content script + popup.

---

## 7. Deliverables

- Repaired extension: `extension/{manifest.json, content.js, popup.html, popup.js}` (v2.1)
- Test harness + fixtures: `tests/{harness.js, fixtures.js, unit.test.js, integration.test.js, chaos.test.js, popup.test.js, package.json}`
- This report: `BUILD-TEST-REPORT.md`

Run tests: `cd tests && npm install && node --test`
