# Post Cleanup Sweep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the remaining stale test/doc/code references left behind after the legacy capture cleanup so the repo reflects the current Web-aggregation scope cleanly.

**Architecture:** Keep runtime behavior unchanged. Focus this sweep on obsolete planning docs, dead helper branches in `src-tauri/src/lib.rs`, and old persistence-oriented language in tests. Only remove things that no longer affect the shipping product.

**Tech Stack:** React 19, Vitest, Tauri 2, Rust

### Task 1: Clean stale tests and wording

**Files:**
- Modify: `tests/unit/app-layout.test.tsx`

**Step 1: Write the failing test / expectation**

- Adjust test wording and setup so it only describes current Webview behavior, not deleted database/backup/capture modules.

**Step 2: Run the targeted test**

Run: `npx vitest run tests/unit/app-layout.test.tsx`

Expected: PASS after cleanup.

### Task 2: Remove dead runtime branches

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the minimal implementation**

- Remove helper branches and debug markers that no longer add behavior, including the always-false new-window gate.

**Step 2: Verify Rust compilation**

Run: `cargo check`

Expected: PASS

### Task 3: Remove obsolete docs

**Files:**
- Delete: `docs/plans/2026-03-24-remove-data-management-implementation.md`

**Step 1: Write the minimal implementation**

- Remove the superseded plan file so contributors see the current cleanup plan only.

**Step 2: Run full verification**

Run: `npx vitest run`

Expected: PASS
