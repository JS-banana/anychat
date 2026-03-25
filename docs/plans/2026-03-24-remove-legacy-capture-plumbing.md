# Remove Legacy Capture Plumbing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove legacy chat data capture, local relay, and related stale references so AnyChat stays focused on Web embedding and service management only.

**Architecture:** Keep the current React + Tauri shell for service switching, settings, and icon handling. Remove the unused Tauri-side fetch/DOM capture script, local HTTP relay, custom protocol receiver, and the remote IPC capability that existed only for chat-data collection. Also remove stale project-document references that still imply data-capture scope.

**Tech Stack:** React 19, Zustand, Vitest, Tauri 2, Rust

### Task 1: Lock cleanup scope with failing checks

**Files:**
- Modify: `tests/unit/app-layout.test.tsx`
- Modify: `tests/unit/settings-page.test.tsx`

**Step 1: Assert the current product scope**

- Confirm UI tests still only cover Web management behavior.
- Add coverage for About copy so it does not position AnyChat as a data-management app.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/app-layout.test.tsx tests/unit/settings-page.test.tsx`

Expected: PASS or FAIL only on wording/scope drift, not on unrelated behavior.

### Task 2: Remove Tauri capture/runtime plumbing

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Delete: `src-tauri/capabilities/remote-access.json`

**Step 1: Write the minimal implementation**

- Reduce the injected webview script to auth/login compatibility behavior only.
- Remove chat message capture state, API interception, DOM fallback capture, queue polling, local HTTP server on `127.0.0.1:33445`, and `anychat://capture` protocol handling.
- Remove now-unused Rust dependencies that existed only for capture transport.

**Step 2: Run targeted verification**

Run: `npm run build`

Expected: PASS

### Task 3: Remove stale local references and dead code

**Files:**
- Modify: `AGENTS.md`
- Delete: `src/hooks/useIconCache.ts`

**Step 1: Write the minimal implementation**

- Remove AGENTS doc references that still point contributors at data-capture research as if it were active scope.
- Delete the unused hook left behind from older icon/cache experiments.

**Step 2: Run full verification**

Run: `npx vitest run`

Expected: PASS

Run: `npm run build`

Expected: PASS
