# Remove Data Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove chat data management and storage behavior from AnyChat, and update settings/about UI to reflect the new product scope.

**Architecture:** Remove the persistence pipeline end-to-end: frontend SQLite/chat-history logic, backup/import-export helpers, and Tauri SQL permissions/plugin wiring used only for data capture persistence. Keep service aggregation and icon caching intact. Simplify settings to only `services` and `about`, and replace About copy with direct project links.

**Tech Stack:** React 19, Zustand, Vitest, Tauri 2, Rust

### Task 1: Lock in UI expectations with tests

**Files:**

- Modify: `tests/unit/app-layout.test.tsx`
- Create: `tests/unit/settings-page.test.tsx`
- Modify: `tests/unit/app-store.test.ts`

**Step 1: Write the failing test**

- Assert `AppLayout` no longer initializes database / backup / chat capture listeners on mount.
- Assert `SettingsPage` does not render a `数据管理` tab.
- Assert `SettingsPage` about content links to `https://github.com/JS-banana/anychat` and references `https://github.com/JS-banana/AmberKeeper`.
- Assert store settings tabs only use `services` and `about`.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/app-layout.test.tsx tests/unit/settings-page.test.tsx tests/unit/app-store.test.ts`
Expected: FAIL because current UI still exposes data management and current layout still initializes persistence.

### Task 2: Remove frontend data management logic

**Files:**

- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/stores/app-store.ts`
- Modify: `src/types/index.ts`
- Delete: `src/components/ChatHistoryPanel.tsx`
- Delete: `src/components/SettingsDialog.tsx`
- Delete: `src/services/database.ts`
- Delete: `src/services/backup.ts`
- Delete: `src/services/import-export.ts`

**Step 1: Write the minimal implementation**

- Remove database initialization, backup startup, and captured message persistence from `AppLayout`.
- Simplify settings tab state to `services | about`.
- Remove data-management tab UI, history/search/export/backup flows, and related imports from `SettingsPage`.
- Update About section copy and add clickable project links.
- Delete unused data-management components and services.

**Step 2: Run targeted tests**

Run: `pnpm exec vitest run tests/unit/app-layout.test.tsx tests/unit/settings-page.test.tsx tests/unit/app-store.test.ts`
Expected: PASS

### Task 3: Remove Tauri persistence plumbing

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`
- Modify: `tests/setup.ts`
- Delete: `tests/unit/database.test.ts`

**Step 1: Write the minimal implementation**

- Remove SQL plugin setup and SQL capability permissions.
- Remove `capture_chat_message` command registration and any chat log file writes that only existed for persistence.
- Drop frontend SQL dependency if no longer referenced.
- Remove obsolete database test and plugin mocks.

**Step 2: Run verification**

Run: `pnpm exec vitest run`
Expected: PASS

Run: `pnpm build`
Expected: PASS
