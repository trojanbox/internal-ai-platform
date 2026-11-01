# @repo/ui

业务无关 UI Primitive / Design System 边界。

## 规则

- `apps/web` 和业务 Feature 只 import `@repo/ui`，不直接 import `radix-ui`。
- Radix Primitives 统一依赖官方聚合包 `radix-ui`；不要为单个 Primitive 分别安装 `@radix-ui/react-*`。
- Dialog、Dropdown Menu、Tooltip、Popover、Select、Tabs 等复杂交互优先通过 Radix Primitives 实现。
- Radix 负责行为、Focus、Keyboard、ARIA、Portal、Dismiss；视觉继续由 CSS Modules + Semantic Token 管理。
- Button、Input 等有完整原生 HTML 语义的简单控件可以直接封装原生元素，不为了统一机械套 Radix。
- `packages/ui` 不依赖 Router、业务 Contract、业务 Feature 或 `packages/i18n`；调用方负责传入用户文案。
- `src/` 根只保留 Package Public API；组件先按组件类别组织，再进入独立组件目录。
- 新的组件类别只在真实组件出现后创建，不预建空目录。
- 新增复杂 Primitive 时，同目录补至少一个可观察行为测试。

## 当前结构

```text
src/
├── components/
│   ├── actions/
│   │   └── button/          # native semantic primitive
│   └── overlays/
│       ├── dialog/          # Radix Dialog
│       ├── dropdown-menu/   # Radix Dropdown Menu
│       └── tooltip/         # Radix Tooltip
├── test/
├── types/
└── index.ts                 # Package Public API
```
