# 熊出没集团 · 员工花名册 — 技术方案

> 设计人：光头强（架构） ｜ 日期：2026-08-19 ｜ 阶段：Phase 1 MVP
>
> 口头禅：「强哥我寻思一下…」「这方案我搞定！」

---

## 一、架构概述

### 1.1 设计目标

为熊出没集团 7 个 MVP 角色构建一张**单文件、零外部依赖**的员工花名册页面，要求美观、响应式、按 Leader / Worker / Verifier 三层分组展示卡片。

### 1.2 技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 文件形态 | 单个 `.html`，CSS 内联于 `<style>` | 满足"单文件、无外部依赖"，可离线打开、易分发 |
| 脚本策略 | 内联一小段原生 JS（数据数组 + 渲染函数） | 7 张卡片结构一致，数据驱动比手写静态 HTML 更易维护；新增角色只需改数据数组 |
| 样式方案 | CSS 自定义属性（变量）+ CSS Grid | 主题色集中管理；Grid `auto-fit + minmax` 一行实现响应式，无需繁杂媒体查询 |
| 视觉基调 | 复用 `requirements-spec.html` 的深色主题 | 与集团既有文档视觉统一，降低认知成本 |

### 1.3 分层模型

```
┌─────────────────────────────────────────┐
│  数据层 (Data)     roles[]  角色数据数组   │  ← 唯一数据源，改这里即改花名册
├─────────────────────────────────────────┤
│  逻辑层 (Logic)    renderRoster()        │  ← 数据 → DOM 卡片
├─────────────────────────────────────────┤
│  表现层 (View)     <style> + 语义 HTML    │  ← 主题、布局、响应式、动效
└─────────────────────────────────────────┘
```

- **数据层**：一个 `ROLES` 数组，每项含 `name / title / animal / duty / tier / color`。
- **逻辑层**：`renderRoster()` 按 `tier` 分组后生成卡片 HTML，挂到对应分组容器。
- **表现层**：纯 CSS，无框架。卡片样式、分组、响应式、悬停动效全部在 `<style>` 内。

### 1.4 数据流转

```
ROLES 数组
   │
   ▼ 按 tier 字段分桶
 { leader:[…], worker:[…], verifier:[…] }
   │
   ▼ 遍历生成卡片
 DOM: <section data-tier="leader">…</section>
   │
   ▼ CSS 变量 --role-color 驱动配色
 每张卡片左侧色条 / 标题色 = 角色专属色
```

---

## 二、页面结构设计（HTML）

### 2.1 整体骨架（语义化 HTML5）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>熊出没集团 · 员工花名册</title>
  <style> /* 全部样式内联于此 */ </style>
</head>
<body>
  <!-- 标题栏 -->
  <header class="topbar">
    <div class="topbar__inner">
      <div class="brand">
        <span class="brand__logo">🐻</span>
        <div class="brand__text">
          <h1>熊出没集团</h1>
          <p>员工花名册 · MVP 阵容</p>
        </div>
      </div>
      <div class="topbar__meta">
        <span class="chip">Phase 1 · MVP</span>
        <span class="chip">7 角色</span>
      </div>
    </div>
  </header>

  <!-- 主体：三个分组 -->
  <main class="page">
    <!-- 分组：Leader -->
    <section class="group" data-tier="leader">
      <header class="group__head">
        <h2>Leader · 领导层</h2>
        <span class="group__count">1</span>
      </header>
      <div class="group__grid" id="grid-leader"><!-- JS 注入卡片 --></div>
    </section>

    <!-- 分组：Worker -->
    <section class="group" data-tier="worker">
      <header class="group__head">
        <h2>Worker · 执行层</h2>
        <span class="group__count">5</span>
      </header>
      <div class="group__grid" id="grid-worker"><!-- JS 注入卡片 --></div>
    </section>

    <!-- 分组：Verifier -->
    <section class="group" data-tier="verifier">
      <header class="group__head">
        <h2>Verifier · 验证层</h2>
        <span class="group__count">1</span>
      </header>
      <div class="group__grid" id="grid-verifier"><!-- JS 注入卡片 --></div>
    </section>
  </main>

  <!-- 页脚 -->
  <footer class="footer">
    <p>熊出没集团 © 2026 · 仿 MAVIS 多 Agent 协作系统</p>
    <p class="footer__sub">Leader-Worker-Verifier 三层闭环 · Phase 1 MVP</p>
  </footer>

  <script> /* 数据数组 + 渲染函数，内联于此 */ </script>
</body>
</html>
```

### 2.2 角色卡片结构（单卡）

每张卡片由 JS 生成，结构如下：

```html
<article class="card" style="--role-color:#D4A574">
  <div class="card__bar" aria-hidden="true"></div>
  <div class="card__body">
    <div class="card__head">
      <span class="card__avatar" aria-hidden="true">🐻</span>   <!-- 动物 emoji -->
      <div class="card__title">
        <h3 class="card__name">熊大</h3>
        <span class="card__post">总裁</span>                     <!-- 职位 -->
      </div>
      <span class="card__tag card__tag--leader">Leader</span>    <!-- 层级标签 -->
    </div>
    <dl class="card__meta">
      <div><dt>动物类型</dt><dd>棕熊</dd></div>
    </dl>
    <p class="card__duty">接收需求、拆解、分配</p>               <!-- 职责描述 -->
  </div>
</article>
```

要点：
- `--role-color` 通过内联 style 注入**角色专属色**，驱动色条、标题、标签配色，无需为每个角色写一条 CSS。
- 卡片用 `<article>`（独立内容块）、`<dl>`（键值对：动物类型），语义清晰，便于无障碍读屏。

### 2.3 渲染数据数组（Data）

```js
const ROLES = [
  { name:'熊大',     title:'总裁',   animal:'棕熊',       emoji:'🐻',
    duty:'接收需求、拆解、分配',         tier:'leader',   color:'#D4A574' },
  { name:'光头强',   title:'架构',   animal:'人类·伐木工', emoji:'🧑‍🔧',
    duty:'技术方案设计',                 tier:'worker',   color:'#6B8E23' },
  { name:'熊二',     title:'开发',   animal:'棕熊',       emoji:'🐻',
    duty:'代码实现',                     tier:'worker',   color:'#8B4513' },
  { name:'蹦蹦',     title:'测试',   animal:'松鼠',       emoji:'🐿️',
    duty:'测试用例与Bug报告',            tier:'worker',   color:'#FF8C00' },
  { name:'萝卜头',   title:'调试',   animal:'鼹鼠',       emoji:'🐭',
    duty:'Bug定位与修复',                tier:'worker',   color:'#9B8B6F' },
  { name:'肥波',     title:'文档',   animal:'肥猫',       emoji:'🐱',
    duty:'文档编写',                     tier:'worker',   color:'#A9A9A9' },
  { name:'吉吉国王', title:'代码质检',animal:'猴子',      emoji:'🐒',
    duty:'Level 1 柔性审查',            tier:'verifier', color:'#FFD700' },
];
```

> `color` 字段直接取自各角色定义文件（`roles/**/*.md` frontmatter 的 `color`），保证花名册与角色系统配色同源。

---

## 三、样式方案（CSS 要点）

### 3.1 配色系统（CSS 变量）

复用 `requirements-spec.html` 深色主题，保持集团视觉统一，并新增三层级语义色：

```css
:root{
  /* —— 基础主题（与需求说明书同源） —— */
  --bg:#0d1117;  --bg2:#161b22;  --bg3:#1c2333;
  --ink:#e6edf3; --muted:#7d8590; --rule:#30363d;
  --font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;

  /* —— 三层级语义色 —— */
  --c-leader:#D4A574;    /* 琥珀金 — 领导层 */
  --c-worker:#3fb950;    /* 森林绿 — 执行层 */
  --c-verifier:#f0883e;  /* 警示橙 — 验证层 */
}
```

- **角色专属色**：通过卡片内联 `--role-color` 注入（见 2.2），驱动色条、姓名、悬停光晕，做到"一角色一颜色"且零额外 class。
- **层级色**：`--c-leader/worker/verifier` 用于分组标题装饰线、层级标签底色，一眼区分三层。

### 3.2 布局方案

**标题栏**：flex 两端对齐，logo + 标题左、状态 chip 右；窄屏自动换行居中。

**分组卡片网格**（核心响应式，无媒体查询即可自适应）：

```css
.group__grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
  gap:1.25rem;
}
```

- `auto-fill + minmax(260px,1fr)`：视口足够宽时自动排多列，<260px 时退化为单列，天然响应式。
- 三组各自独立网格，Leader/Verifier 各 1 张卡片天然占满，Worker 5 张自动流式排列。

**卡片**：`background:var(--bg2)`，圆角，左侧 4px 色条 `--role-color`，`hover` 时 `translateY(-4px)` + 阴影加深 + 色条发光，提供微交互反馈。

### 3.3 响应式细节

- **移动端**（<600px）：标题栏 meta chips 换行居中；卡片网格单列；正文内边距收窄至 `1rem`。
- **平板**（600–960px）：Worker 两列。
- **桌面**（>960px）：Worker 三列，整体内容居中，`max-width:1080px`。
- 仅在窄屏断点处补 1 条 `@media` 微调内边距，其余由 Grid 自动处理，保持样式精简。

### 3.4 视觉细节

- 分组标题前用 `::before` 画一条 4px 层级色短杠，呼应卡片色条语言。
- 层级标签（Leader/Worker/Verifier）用对应层级色做半透明底 + 同色描边。
- 动物 emoji 作头像占位（无外部图片依赖，符合零依赖要求）。
- `prefers-reduced-motion` 媒体查询关闭动效，兼顾无障碍。

---

## 四、目录结构（输出文件路径）

```
熊出没集团/
└── demo/                         # 本次花名册交付目录
    ├── roster-spec.md            # 本技术方案文档（当前文件）
    └── roster.html              # 【交付物】单文件花名册页面（后续按本方案实现）
```

- `roster-spec.md`：本方案，先于实现产出，作为开发（熊二）的施工依据。
- `roster.html`：最终交付的单文件页面，CSS 全内联于 `<style>`，数据与渲染内联于 `<script>`，可直接双击在任意浏览器打开，无需服务器。

> 说明：当前仅输出方案文档 `roster-spec.md`；`roster.html` 由开发角色（熊二）按本方案实现。两文件同处 `demo/` 目录，便于归档管理（遵循"data 下任务以子目录组织"的约定）。

---

## 五、关键设计决策说明

1. **数据驱动 vs 静态手写卡片**：7 张卡片结构完全一致，若手写静态 HTML 会产生大量重复且易漏字段。采用"JS 数据数组 + 渲染函数"后，新增/修改角色只动 `ROLES` 数组一处，卡片自动同步，维护成本最低。脚本仅约 20 行，无外部依赖，符合"无外部依赖"约束（内联 JS 不算外部依赖）。

2. **配色与既有文档同源**：直接复用 `requirements-spec.html` 的深色主题变量（`--bg/--ink/--accent…`），让花名册与集团需求说明书视觉一致；角色色取自角色定义文件的 `color` frontmatter，避免"两套配色"漂移。

3. **CSS Grid `auto-fill + minmax` 实现响应式**：相比传统多段媒体查询，单行 Grid 即可在 1 列～3 列间平滑自适应，样式更短、更稳健，符合"响应式布局"要求且不臃肿。

4. **角色专属色通过内联 `--role-color` 注入**：不在 CSS 里为每个角色写 `.card--bear1/.card--bear2…`，而是把颜色作为 CSS 变量随卡片注入，驱动色条/姓名/光晕。新增角色零 CSS 改动，扩展性最佳。

5. **三层分组语义化 `<section data-tier>`**：既满足"按层级分组"的展示需求，又为后续可扩展（如折叠某层、按层筛选）预留结构钩子；分组数量与层语义来自 `tier` 字段，数据驱动。

6. **零图片依赖**：用动物 emoji 作头像占位，避免引入外部图片资源，确保单文件可离线运行、无网络/无 CDN 也能展示，严格遵守"无外部依赖"。

7. **无障碍与动效克制**：使用语义标签（`article/dl/header/footer`），并为 `prefers-reduced-motion` 关闭动效，兼顾读屏与可访问性，体现"可落地的工程方案"而非花架子。

---

> 强哥我说到做到——这方案我搞定！剩下交给熊二按图施工，吉吉国王过审，齐活。
