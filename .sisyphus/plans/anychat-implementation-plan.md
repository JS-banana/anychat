# AnyChat 项目实施计划

> 基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端

**版本**: v1.0  
**日期**: 2026-01-14  
**状态**: 待实施

---

## 一、项目概述

### 命名

- **项目名称**: AnyChat
- **包标识符**: `com.anychat.app`
- **定位**: 统一入口 + 本地可控的聊天数据沉淀

### 实施范围

1. 工程化配置完善
2. 项目名称更新
3. 预置服务列表扩展
4. Sidebar 激活状态 UI 优化
5. 核心业务逻辑测试
6. Logo 替换

### 预计工时

- 总计：8-12 小时
- 分 6 个阶段实施

---

## 二、阶段 1：工程化配置（2h）

### 1.1 需要新增的文件

#### `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{rs,py,sh}]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

#### `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": []
}
```

#### `.prettierignore`

```
node_modules
dist
src-tauri/target
*.ico
*.icns
*.png
*.svg
pnpm-lock.yaml
.git
```

#### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

#### `tests/setup.ts`

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: vi.fn(),
      select: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
```

### 1.2 需要安装的依赖

```bash
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom prettier
```

### 1.3 需要更新的 package.json scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "format": "prettier --write . --ignore-unknown",
    "format:check": "prettier --check . --ignore-unknown",
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## 三、阶段 2：项目名称更新（0.5h）

### 2.1 需要修改的文件

#### `package.json`

```json
{
  "name": "anychat",
  "version": "0.1.0"
}
```

#### `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AnyChat",
  "version": "0.1.0",
  "identifier": "com.anychat.app"
}
```

#### `src-tauri/Cargo.toml`

```toml
[package]
name = "anychat"
version = "0.1.0"
description = "Multi-AI Chat Aggregator Desktop App"
```

#### `src-tauri/src/lib.rs`

- 将所有 `[ChatBox]` 日志标记替换为 `[AnyChat]`

#### `README.md`

- 标题改为 `# AnyChat - 多 AI 聊天聚合应用`
- 更新所有 ChatBox 引用

#### `AGENTS.md`

- 更新项目名称引用

---

## 四、阶段 3：预置服务列表完善（1.5h）

### 3.1 更新 `src/types/index.ts`

```typescript
export interface ChatService {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  brandColor?: string; // 新增：品牌主色
  enabled: boolean;
  order: number;
  isBuiltin?: boolean; // 新增：标记内置服务
}

export const DEFAULT_SERVICES: ChatService[] = [
  // === 默认启用（国际主流） ===
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    iconUrl: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg',
    brandColor: '#00A67E',
    enabled: true,
    order: 0,
    isBuiltin: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    iconUrl: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
    brandColor: '#4796E3',
    enabled: true,
    order: 1,
    isBuiltin: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    iconUrl: 'https://claude.ai/favicon.ico',
    brandColor: '#DA7756',
    enabled: true,
    order: 2,
    isBuiltin: true,
  },

  // === 默认隐藏（国际） ===
  {
    id: 'grok',
    name: 'Grok',
    url: 'https://grok.com',
    iconUrl: 'https://grok.com/favicon.ico',
    brandColor: '#000000',
    enabled: false,
    order: 3,
    isBuiltin: true,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    url: 'https://copilot.microsoft.com',
    iconUrl: 'https://copilot.microsoft.com/favicon.ico',
    brandColor: '#00A2ED',
    enabled: false,
    order: 4,
    isBuiltin: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://perplexity.ai',
    iconUrl: 'https://www.perplexity.ai/favicon.ico',
    brandColor: '#21808D',
    enabled: false,
    order: 5,
    isBuiltin: true,
  },
  {
    id: 'poe',
    name: 'Poe',
    url: 'https://poe.com',
    iconUrl: 'https://poe.com/favicon.ico',
    brandColor: '#B92B27',
    enabled: false,
    order: 6,
    isBuiltin: true,
  },

  // === 默认隐藏（国产） ===
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    iconUrl: 'https://chat.deepseek.com/favicon.svg',
    brandColor: '#4D6BFE',
    enabled: false,
    order: 7,
    isBuiltin: true,
  },
  {
    id: 'qwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen',
    iconUrl:
      'https://img.alicdn.com/imgextra/i1/O1CN01AKUdFc1l0o4yoOHVd_!!6000000004758-2-tps-512-512.png',
    brandColor: '#6366F1',
    enabled: false,
    order: 8,
    isBuiltin: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    iconUrl: 'https://statics.moonshot.cn/kimi-chat/favicon.ico',
    brandColor: '#000000',
    enabled: false,
    order: 9,
    isBuiltin: true,
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat',
    iconUrl: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/logo-doubao-overflow.png',
    brandColor: '#FF6B35',
    enabled: false,
    order: 10,
    isBuiltin: true,
  },
  {
    id: 'glm',
    name: '智谱清言',
    url: 'https://chatglm.cn',
    iconUrl: 'https://chatglm.cn/favicon.ico',
    brandColor: '#1E3A8A',
    enabled: false,
    order: 11,
    isBuiltin: true,
  },
];
```

---

## 五、阶段 4：Sidebar 激活状态 UI 优化（2h）

### 4.1 更新 `src/index.css`

添加新的 CSS 变量：

```css
.dark {
  /* 现有变量保持不变... */

  /* 新增：激活状态专用 */
  --sidebar-active-indicator: 224.3 76.3% 60%;
  --sidebar-active-bg: 0 0% 100% / 0.06;
  --sidebar-active-ring: 224.3 76.3% 48% / 0.3;
  --sidebar-hover-bg: 0 0% 100% / 0.04;
}
```

### 4.2 更新 `src/components/Sidebar.tsx`

关键样式改动：

```tsx
// 按钮容器样式
className={cn(
  'relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200',
  isActive
    ? 'bg-white/[0.06] ring-1 ring-white/10'  // 轻微背景 + 边框
    : 'bg-sidebar-accent/50 hover:bg-white/[0.04]'
)}

// 左侧激活指示条
{isActive && (
  <motion.div
    layoutId="activeIndicator"
    className="absolute -left-[6px] h-6 w-1 rounded-full bg-blue-500"
    initial={false}
    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
  />
)}

// 图标容器（独立，不受背景影响）
<div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg">
  <img
    src={iconUrl}
    alt={service.name}
    className="h-6 w-6 object-contain"
    onError={() => handleImageError(service.id)}
  />
</div>
```

**设计要点：**

1. 左侧蓝色竖条指示器（不干扰图标本身）
2. 轻微白色背景高亮（6% 透明度）
3. 细微边框环（10% 透明度）
4. 图标容器独立于背景

---

## 六、阶段 5：核心业务逻辑测试（2h）

### 5.1 测试目录结构

```
tests/
├── setup.ts                    # 测试初始化
└── unit/
    ├── app-store.test.ts      # 状态管理测试
    ├── icon.test.ts           # 图标工具测试
    └── database.test.ts       # 数据库逻辑测试
```

### 5.2 `tests/unit/app-store.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/app-store';
import { DEFAULT_SERVICES } from '@/types';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      services: [...DEFAULT_SERVICES],
      activeServiceId: DEFAULT_SERVICES.find((s) => s.enabled)?.id ?? null,
      settingsOpen: false,
      addServiceDialogOpen: false,
      chatHistoryOpen: false,
    });
  });

  describe('setActiveService', () => {
    it('should set active service when service is enabled', () => {
      const { setActiveService } = useAppStore.getState();
      const enabledService = DEFAULT_SERVICES.find((s) => s.enabled);

      setActiveService(enabledService!.id);
      expect(useAppStore.getState().activeServiceId).toBe(enabledService!.id);
    });

    it('should not set active service when service is disabled', () => {
      const { setActiveService } = useAppStore.getState();
      const disabledService = DEFAULT_SERVICES.find((s) => !s.enabled);
      const initialActiveId = useAppStore.getState().activeServiceId;

      setActiveService(disabledService!.id);
      expect(useAppStore.getState().activeServiceId).toBe(initialActiveId);
    });
  });

  describe('addService', () => {
    it('should add new custom service', () => {
      const { addService } = useAppStore.getState();
      const initialCount = useAppStore.getState().services.length;

      addService({
        name: 'Test AI',
        url: 'https://test.ai',
        enabled: true,
      });

      const services = useAppStore.getState().services;
      expect(services.length).toBe(initialCount + 1);
      expect(services[services.length - 1].name).toBe('Test AI');
    });
  });

  describe('removeService', () => {
    it('should remove service by id', () => {
      const { removeService } = useAppStore.getState();
      const serviceToRemove = DEFAULT_SERVICES[0];
      const initialCount = useAppStore.getState().services.length;

      removeService(serviceToRemove.id);

      expect(useAppStore.getState().services.length).toBe(initialCount - 1);
    });
  });

  describe('toggleServiceEnabled', () => {
    it('should toggle service enabled state', () => {
      const { toggleServiceEnabled } = useAppStore.getState();
      const service = DEFAULT_SERVICES[0];
      const initialEnabled = service.enabled;

      toggleServiceEnabled(service.id);

      const updatedService = useAppStore.getState().services.find((s) => s.id === service.id);
      expect(updatedService?.enabled).toBe(!initialEnabled);
    });
  });

  describe('reorderServices', () => {
    it('should reorder services correctly', () => {
      const { reorderServices } = useAppStore.getState();
      const services = useAppStore.getState().services;
      const firstId = services[0].id;
      const secondId = services[1].id;

      reorderServices(0, 1);

      const reorderedServices = useAppStore.getState().services;
      expect(reorderedServices[0].id).toBe(secondId);
      expect(reorderedServices[1].id).toBe(firstId);
    });
  });
});
```

### 5.3 `tests/unit/icon.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { getServiceIconCandidates } from '@/lib/icon';

describe('getServiceIconCandidates', () => {
  it('should return explicit icon URL first when provided', () => {
    const candidates = getServiceIconCandidates(
      'https://chatgpt.com',
      'https://example.com/custom-icon.png'
    );

    expect(candidates[0]).toBe('https://example.com/custom-icon.png');
  });

  it('should include Google S2 favicon as fallback', () => {
    const candidates = getServiceIconCandidates('https://chatgpt.com');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toContain('google.com/s2/favicons');
  });

  it('should return empty array for invalid URLs', () => {
    const candidates = getServiceIconCandidates('not-a-valid-url');

    expect(candidates.length).toBe(0);
  });
});
```

---

## 七、阶段 6：Logo 替换（1h）

### 6.1 Logo 生成提示词

**推荐 - Midjourney 命令：**

```
/imagine modern minimalist app icon, three overlapping chat bubbles merging into one, gradient from emerald green to sky blue to violet purple, flat design, clean geometric, macOS dock icon style, rounded square container, no text, centered, dark background --v 6.1 --ar 1:1 --stylize 50
```

**备选提示词：**

```
/imagine minimalist app icon, infinity symbol made of two intertwining chat bubbles, teal to green gradient and blue to purple gradient, smooth flowing curves, macOS dock icon, no text --v 6.1 --ar 1:1 --stylize 50
```

### 6.2 需要替换的文件

```
src-tauri/icons/
├── 32x32.png           # 32x32 像素
├── 128x128.png         # 128x128 像素
├── 128x128@2x.png      # 256x256 像素 (Retina)
├── icon.icns           # macOS 图标包
├── icon.ico            # Windows 图标
├── icon.png            # 512x512 主图
├── Square*.png         # Windows Store 各尺寸
└── StoreLogo.png       # Windows Store Logo
```

### 6.3 图标生成工具

- **icns 生成**: https://cloudconvert.com/png-to-icns
- **ico 生成**: https://cloudconvert.com/png-to-ico
- **批量生成**: https://icon.kitchen/

---

## 八、验收标准

### 8.1 功能验收

- [ ] 项目可正常 `pnpm tauri dev` 启动
- [ ] 所有预置服务可正常切换
- [ ] Sidebar 激活状态清晰可辨
- [ ] 新增服务可正常使用
- [ ] 服务启用/禁用功能正常

### 8.2 工程验收

- [ ] `pnpm format:check` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 全部通过
- [ ] `pnpm build` 成功

### 8.3 UI 验收

- [ ] 激活状态与非激活状态对比明显
- [ ] 不同颜色图标的激活状态一致
- [ ] 动画过渡流畅
- [ ] 深色模式下可读性良好

---

## 九、实施顺序

```
阶段 1 ──→ 阶段 2 ──→ 阶段 3 ──→ 阶段 4 ──→ 阶段 5 ──→ 阶段 6
工程配置    名称更新    服务列表    UI优化      测试       Logo
  2h         0.5h        1.5h        2h         2h        1h
```

---

## 十、风险与注意事项

1. **图标 URL 可能失效**：部分服务的 iconUrl 可能随时间变化，需要 Google S2 兜底
2. **服务 DOM 选择器变化**：Chat 服务的 DOM 结构可能变化，影响数据捕获
3. **Zustand 持久化兼容性**：新增 `brandColor`、`isBuiltin` 字段需考虑旧数据兼容
4. **测试覆盖范围**：当前仅覆盖核心逻辑，UI 组件测试暂不包含

---

## 十一、后续迭代建议

1. **P0 - 自动数据捕获稳定化**
2. **P1 - 自动备份功能**
3. **P2 - 系统托盘支持**
4. **P2 - 拖拽排序服务**
5. **P3 - 浅色模式支持**

---

**计划制定人**: AI Assistant  
**审核状态**: 待用户确认  
**预计总工时**: 8-12 小时
