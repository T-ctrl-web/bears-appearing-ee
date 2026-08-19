# 熊出没集团安全登录看板 — 视觉设计方案

> 这界面丑得我手痒！熊二那套基础样式是能用，但配色是十年前的通用 Flat 蓝，跟"熊出没集团"一点关系都没有。好看就完事了！本方案把品牌色、登录卡、三列看板、交互态、响应式、微动画全给你定死，所有选择器精确对接现有 `index.html` / `style.css` 的 class 和 DOM 结构，熊二照着填就行，不用改结构。
>
> 主题代号：**松林蜜光（Pine & Honey）**
> 设计师：翠花
> 对接文件：`index.html`、`css/style.css`、`js/kanban.js`（仅参考 DOM/class，不改动代码逻辑）

---

## 一、设计理念

熊出没集团的"熊"是住在松林里的，一个安全看板不能一股大路货的蓝。本方案以**松针绿**为品牌主色传递"安全、可靠、扎根"，以**蜂蜜蜜**为点缀色传递"熊的甜头、活力、可达成"，背景用暖调雾白营造森林晨光的呼吸感。三列看板的状态色做了一条叙事线：

- 待办（珊瑚红）→ 醒目，"该干活了"
- 进行中（蜂蜜蜜）→ 跟品牌蜜色一致，"正在采蜜"
- 完成（松针绿）→ 跟品牌主色一致，"归仓"

整条路径从"红警"走到"蜜"再到"绿成"，色彩本身在讲故事，不再是堆颜色块。

设计原则四条：

1. **暖调而非冷冰冰**——阴影、背景、聚焦环都带松绿底色（`rgba(15,61,46,…)`），不用纯黑，整体发暖、有品牌归属。
2. **圆角分级**——小到芯片大到登录卡，圆角有节奏，不是一刀切 6px。
3. **留白即品质**——表单、卡片、列内边距统一放大一档，呼吸感是"好看"的核心。
4. **微动效守底线**——hover/focus/拖拽/进出都有不超过 280ms 的过渡，`prefers-reduced-motion` 时全停，不影响功能。

---

## 二、设计令牌（Design Tokens）

### 2.1 配色方案

所有色值定义成 CSS 自定义变量，放在 `:root`，便于熊二全局换肤。下面既给语义令牌，也标注对应当前 `style.css` 里要替换的硬编码值。

```css
:root {
  /* —— 品牌主色：松针绿 —— */
  --pine-900: #0b3d2e;   /* 顶栏底色（替换 #2c3e50） */
  --pine-700: #176449;   /* 主色按下态 */
  --pine-600: #1f7a5a;   /* 主色（替换 #3498db 的按钮/聚焦身份） */
  --pine-500: #2a9168;
  --pine-50:  #e8f3ef;   /* 主色浅底（聚焦光晕、选中底） */

  /* —— 品牌点缀：蜂蜜蜜 —— */
  --honey-500: #f59e0b;  /* 链接/强调（替换 btn-link 的蓝） */
  --honey-600: #d97f06;
  --honey-50:  #fdf3e3;

  /* —— 中性：暖调雾白 —— */
  --bg-base:   #f4f8f5;  /* 应用底色（替换 #f5f6f8） */
  --surface:   #ffffff;
  --text-1:    #1d2b24;   /* 主文本（替换 #333） */
  --text-2:    #5a6b62;   /* 次文本（替换 #555/#666） */
  --text-3:    #9aaaa0;   /* 占位/禁用（替换 #bbb） */
  --border:    #e2e8e4;   /* 边框（替换 #d0d5dd/#e0e0e0） */
  --divider:   #edf2ef;

  /* —— 三列语义色（叙事线） —— */
  --todo-500:  #e0584c;  /* 待办：珊瑚红（替换 #e74c3c） */
  --todo-50:   #fdeceb;
  --doing-500: #e8911c;  /* 进行中：蜂蜜蜜（替换 #f39c12，与品牌蜜统一） */
  --doing-50:  #fdf3e3;
  --done-500:  #2f9e6d;   /* 完成：松针绿（与品牌主色统一） */
  --done-50:   #e6f4ee;

  /* —— 反馈色 —— */
  --danger:    #e0584c;
  --danger-50: #fdeceb;
}
```

> 对接说明：当前 `style.css` 里 `#3498db`（按钮/聚焦）、`#2c3e50`（顶栏/标题）、`#e74c3c`、`#f39c12`、`#27ae60`（三列）、`#f5f6f8`（底色）这些硬编码值，分别映射到上面的语义令牌，熊二把硬编码换成 `var(--xxx)` 即可。

### 2.2 字体方案

CSP 是 `style-src 'self' 'unsafe-inline'` 且 `font-src` 继承 `default-src 'self'`，**禁止外链字体**（Google Fonts 跑不起来），只能用系统栈。我把它排成现代优先级，并补上鸿蒙/苹方/雅黑的中文回退。

```css
:root {
  --font-sans: "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui,
    "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "微软雅黑",
    "Helvetica Neue", Arial, sans-serif;
  --font-mono: "Cascadia Code", "JetBrains Mono", "Consolas", monospace;
  --font-body: 14px;
  --lh: 1.6;
}
```

字号层级（替换现有零散 `font-size`）：

| 语义 | 字号 | 字重 | 用途 |
| --- | --- | --- | --- |
| Display | 24px | 700 | 登录卡标题 `h2` |
| Title | 15px | 700 | 列标题 `.col-title` |
| Body | 14px | 400 | 输入框、卡片标题 |
| Caption | 12px | 500 | 操作按钮、计数徽标、提示 |

行高统一 `1.6`（当前是 `1.5`，偏挤），表单/卡片读起来更舒展。

### 2.3 圆角 / 阴影 / 间距规范

```css
:root {
  /* 圆角分级（替换一刀切的 4/6/8/10px） */
  --r-xs: 4px;     /* 小按钮、芯片 */
  --r-sm: 6px;     /* 输入框 */
  --r-md: 10px;    /* 任务卡片 */
  --r-lg: 14px;    /* 看板列 */
  --r-xl: 18px;    /* 登录卡 */
  --r-pill: 999px;/* 计数徽标、顶栏登出 */

  /* 阴影：全部带松绿底色，发暖，不用纯黑 */
  --sh-sm: 0 1px 2px rgba(11,61,46,0.06), 0 1px 3px rgba(11,61,46,0.04);
  --sh-md: 0 4px 12px rgba(11,61,46,0.08), 0 2px 4px rgba(11,61,46,0.04);
  --sh-lg: 0 16px 40px rgba(11,61,46,0.14), 0 6px 14px rgba(11,61,46,0.06);
  --sh-focus: 0 0 0 3px rgba(31,122,90,0.18);  /* 松绿聚焦环 */
  --sh-lift: 0 8px 22px rgba(11,61,46,0.12);   /* 卡片 hover 抬升 */
}
```

间距统一 4px 栅格：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40`。当前表单 `.form-group` 间距 `16px` 偏紧，登录卡建议放大到 `20px`。

### 2.4 动效令牌

```css
:root {
  --ease:     cubic-bezier(0.4, 0, 0.2, 1);   /* 标准 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);  /* 减速进场 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性（落点/新增） */
  --d-fast: 120ms;
  --d-base: 180ms;
  --d-slow: 280ms;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
```

---

## 三、登录页设计

登录视图对应 `#login-view.view.login-view` → `.login-card` → `#auth-form`。当前是纯白卡片 + 浅灰底，太素。本方案做成森林晨光里的蜜色卡片。

### 3.1 背景：渐变 + 柔光

```css
.login-view {
  /* 替换原来的纯 flex 居中，背景上松绿到雾白的斜向渐变 */
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(245,158,11,0.10), transparent 60%),
    radial-gradient(1000px 700px at 10% 110%, rgba(31,122,90,0.12), transparent 55%),
    linear-gradient(135deg, #eef5f1 0%, #f7faf8 100%);
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}
```

- 右上角一抹蜂蜜柔光（`honey` 10% 透明），左下一抹松绿柔光，呼应"蜜"与"松"，不是干巴巴的纯色。

### 3.2 登录卡片：圆角放大、阴影加深、顶部品牌条

```css
.login-card {
  width: 100%;
  max-width: 400px;          /* 380 → 400，更舒展 */
  padding: 40px 36px 32px;   /* 上下左右放大 */
  background: var(--surface);
  border-radius: var(--r-xl);   /* 18px，比 10px 高级 */
  box-shadow: var(--sh-lg);
  border: 1px solid rgba(255,255,255,0.6);
  position: relative;
  overflow: hidden;
}

/* 卡片顶部一条 4px 松绿→蜂蜜渐变品牌条，作为"集团"标识 */
.login-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 4px;
  background: linear-gradient(90deg, var(--pine-600), var(--honey-500));
}

.login-card h2 {
  margin-bottom: 28px;
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  color: var(--pine-900);   /* 替换 #2c3e50 */
  letter-spacing: 0.5px;
}
```

> 视觉细节：圆角从 10 抬到 18，阴影从 `0 2px 12px` 抬到带松绿底色的 `--sh-lg`，顶部加一条松绿→蜂蜜渐变 4px 条做品牌锚点。卡片留白从 `32 28` 放大到 `40 36`。

### 3.3 表单：label 字重降级、输入框聚焦环换松绿、间距放大

```css
.form-group { margin-bottom: 20px; }   /* 16 → 20 */

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;   /* 600 太重，改 500 */
  color: var(--text-2);
}

.form-group input[type="text"],
.form-group input[type="password"] {
  width: 100%;
  padding: 11px 14px;          /* 加大可点区 */
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: 14px;
  background: #fbfdfc;          /* 极淡底色，区分于卡片白 */
  transition: border-color var(--d-base) var(--ease),
              box-shadow var(--d-base) var(--ease),
              background var(--d-base) var(--ease);
}

/* focus：边框转松绿 + 松绿聚焦环 + 底色转白 */
.form-group input[type="text"]:focus,
.form-group input[type="password"]:focus {
  border-color: var(--pine-600);
  box-shadow: var(--sh-focus);
  background: var(--surface);
  outline: none;
}
```

### 3.4 记住我：自定义复选框（选中转松绿）

当前是浏览器默认方框，丑。用 `accent-color` 一行搞定，选中即松绿，零 JS、零结构改动。

```css
.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--pine-600);   /* 选中转松绿 */
  cursor: pointer;
}
```

### 3.5 按钮：主按钮松绿渐变 + 抬升；切换链接蜂蜜色

```css
.btn-primary {
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-radius: var(--r-sm);
  background: linear-gradient(135deg, var(--pine-600), var(--pine-700));
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(31,122,90,0.25);
  transition: transform var(--d-fast) var(--ease),
              box-shadow var(--d-base) var(--ease),
              filter var(--d-base) var(--ease);
}

.btn-primary:hover {
  filter: brightness(1.06);
  box-shadow: 0 8px 18px rgba(31,122,90,0.32);
  transform: translateY(-1px);     /* 微抬升 */
}

.btn-primary:active {
  transform: translateY(0) scale(0.98);  /* 按下回弹 */
  box-shadow: 0 2px 6px rgba(31,122,90,0.2);
}

.btn-primary:disabled {
  background: var(--pine-50);
  color: var(--text-3);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

/* 切换登录/注册链接：蓝→蜂蜜蜜 */
.btn-link {
  color: var(--honey-600);
  font-size: 13px;
  font-weight: 500;
}
.btn-link:hover { color: var(--honey-500); text-decoration: underline; }
```

### 3.6 错误提示：带轻微抖动

当前 `#auth-msg` / `.form-msg` 是静止红字。加一个 `shake` 动画，登录失败时给一个"摇头"反馈。

```css
.form-msg {
  min-height: 20px;
  margin-top: 6px;
  font-size: 13px;
  text-align: center;
  color: var(--danger);
}

/* 失败抖动：App 在 setMsg 时给 #auth-msg 加 class "shake" */
.form-msg.shake {
  animation: shake var(--d-slow) var(--ease);
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
```

> 落地钩子：`app.js` 在写入错误文本时给元素加一次 `shake` class，300ms 后移除（或用 `animationend` 监听）。这是唯一需要碰 JS 的地方，其余全 CSS。

---

## 四、看板页设计

看板视图对应 `#kanban-view.view.kanban-view` → `.kanban-topbar`（`#add-form` + `#kanban-msg`）→ `.board` → 三个 `.col[data-status]`（`.col-title` + `.task-list` → `.task-card`）。

### 4.1 顶栏：松绿渐变、sticky、登出按钮胶囊化

```css
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  background: linear-gradient(135deg, var(--pine-900), var(--pine-700));
  color: #fff;
  box-shadow: 0 2px 12px rgba(11,61,46,0.18);
}

.app-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

#logout-btn {
  padding: 7px 18px;
  border: 1px solid rgba(255,255,255,0.35);
  background: rgba(255,255,255,0.08);
  color: #fff;
  border-radius: var(--r-pill);   /* 胶囊 */
  cursor: pointer;
  font-size: 13px;
  transition: background var(--d-base) var(--ease),
              border-color var(--d-base) var(--ease);
}
#logout-btn:hover {
  background: rgba(255,255,255,0.18);
  border-color: rgba(255,255,255,0.6);
}
```

### 4.2 新增任务条 + 消息

```css
.kanban-view { padding: 20px 28px; }

.kanban-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

#add-form { display: flex; gap: 10px; flex: 1; max-width: 520px; }

#add-form input[type="text"] {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: 14px;
  background: var(--surface);
  outline: none;
  transition: border-color var(--d-base) var(--ease),
              box-shadow var(--d-base) var(--ease);
}
#add-form input[type="text"]:focus {
  border-color: var(--pine-600);
  box-shadow: var(--sh-focus);
}

#add-form .btn-primary { width: auto; padding: 10px 22px; }

#kanban-msg { flex: 1; text-align: right; color: var(--danger); }
```

### 4.3 三列容器：间距放大、列高自适应

```css
.board {
  display: flex;
  gap: 20px;                 /* 16 → 20 */
  flex: 1;
  align-items: flex-start;
}

.col {
  flex: 1;
  min-width: 240px;          /* 220 → 240 */
  background: var(--surface);
  border-radius: var(--r-lg); /* 8 → 14 */
  box-shadow: var(--sh-sm);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
  border: 1px solid var(--divider);
  overflow: hidden;          /* 配合圆角，标题色条不溢出 */
}
```

### 4.4 列头：彩色圆点 + 标题 + 计数徽标 + 顶部色条

这是"好看"的核心改造。当前列头只有一行字加底部彩线，太单薄。本方案：

- 列头左侧一个**彩色圆点**（语义色）
- 标题右侧一个**胶囊计数徽标**（松绿底/语义色字）——需要 JS 在 `render()` 时填数字，见 4.7
- 列头顶部一条 3px 语义色条（替代原来的底部边线，更现代）

```css
.col-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 700;
  color: var(--pine-900);
  border-bottom: 1px solid var(--divider);
  position: relative;
}

/* 顶部 3px 语义色条（替代原 border-bottom 2px） */
.col-title::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
}

/* 左侧彩色圆点 */
.col-title::after {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  margin-right: -2px;
  background: currentColor;  /* 借用下方 currentColor */
}

/* 三列配色：标题色 + 顶部条 + 圆点统一 */
.col[data-status="todo"]  { --accent: var(--todo-500);  --accent-50: var(--todo-50); }
.col[data-status="doing"] { --accent: var(--doing-500); --accent-50: var(--doing-50); }
.col[data-status="done"]  { --accent: var(--done-500);  --accent-50: var(--done-50); }

.col[data-status="todo"]  .col-title,
.col[data-status="doing"] .col-title,
.col[data-status="done"]  .col-title {
  color: var(--accent);   /* 圆点 currentColor 取到语义色 */
}
.col[data-status="todo"]  .col-title::before,
.col[data-status="doing"] .col-title::before,
.col[data-status="done"]  .col-title::before {
  background: var(--accent);
}
/* 标题文字本身保持深色，圆点才用语义色 —— 用一个 wrapper 或让标题文字单独设色 */
.col[data-status="todo"]  .col-title { color: var(--pine-900); }
/* 注：圆点 ::after 用 currentColor 会跟标题色。为让圆点单独着色，见 4.7 的轻量 JS 注入方案，或用下面这条覆盖： */
.col[data-status="todo"]  .col-title::after { background: var(--todo-500); }
.col[data-status="doing"] .col-title::after { background: var(--doing-500); }
.col[data-status="done"]  .col-title::after { background: var(--done-500); }
```

> 上面这段我刻意保留了取舍过程。**最终落地用最后三条**（直接给 `::after` 指定语义色背景），标题文字保持 `--pine-900` 深色，圆点单独着色，最干净。

### 4.5 任务列表区：拖拽高亮用语义色而非通用蓝

```css
.task-list {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  min-height: 80px;
  background: linear-gradient(180deg, #fbfdfc, var(--surface));
  transition: background var(--d-base) var(--ease);
}

/* 拖拽放置高亮：用该列语义色的浅底 + 虚线边，而不是通用蓝 */
.col.drag-over .task-list {
  background: var(--accent-50);
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
  border-radius: var(--r-sm);
}
```

> 对接说明：当前是 `.col.drag-over .task-list { background:#eaf4fc; border:2px dashed #3498db }`（通用蓝）。改成依赖 `.col` 上 `--accent` 变量，三列各自高亮成自己的语义色，拖到"完成"是绿虚线、拖到"进行中"是蜜虚线，反馈更准确。

### 4.6 任务卡片：左侧语义色条 + hover 抬升 + 操作按钮渐显

```css
.task-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px 11px 16px;   /* 左边多留 4px 给色条 */
  margin-bottom: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);     /* 6 → 10 */
  cursor: grab;
  transition: box-shadow var(--d-base) var(--ease),
              border-color var(--d-base) var(--ease),
              transform var(--d-base) var(--ease);
  /* 左侧 3px 语义色条，跟随所在列 */
  box-shadow: inset 3px 0 0 0 var(--accent, var(--pine-600));
}

/* 卡片所属列的语义色注入到 .task-card 上：由 4.7 的 JS 在创建卡片时设 data-status，
   或直接继承列的 --accent（卡片在 .col 内，--accent 自动继承） */
.task-card:hover {
  border-color: var(--accent, var(--pine-600));
  box-shadow: var(--sh-lift), inset 3px 0 0 0 var(--accent, var(--pine-600));
  transform: translateY(-1px);
}

.task-card:active { cursor: grabbing; }

/* 拖拽中的卡片：半透明 + 轻微倾斜，比单纯 opacity 0.4 更有"被拎起"感 */
.task-card.dragging {
  opacity: 0.5;
  transform: rotate(-1.5deg) scale(1.02);
  box-shadow: var(--sh-lift), inset 3px 0 0 0 var(--accent, var(--pine-600));
}

.task-title {
  flex: 1;
  word-break: break-word;   /* break-all 切词难看，改 break-word */
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-1);
}
```

> 关键点：卡片左侧 3px 色条用 `box-shadow: inset 3px 0 0 0 var(--accent)` 实现，因为 `--accent` 定义在 `.col` 上、卡片是列的后代会自动继承，**零 JS** 就能让每张卡片带上所属列的语义色。拖到别列后 `render()` 重建，色条自动跟着新列变。

### 4.7 卡片操作按钮 + 内联编辑

```css
.task-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  /* 默认半透明，hover 卡片时显形（触屏直接显示，见 4.7 注） */
  opacity: 0.6;
  transition: opacity var(--d-base) var(--ease);
}
.task-card:hover .task-actions { opacity: 1; }

.task-actions button {
  padding: 3px 9px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--r-xs);
  font-size: 12px;
  cursor: pointer;
  color: var(--text-2);
  transition: background var(--d-fast) var(--ease),
              border-color var(--d-fast) var(--ease),
              color var(--d-fast) var(--ease);
}
.task-actions button:hover { background: var(--divider); }

.task-actions .btn-edit:hover {
  border-color: var(--pine-600);
  color: var(--pine-600);
  background: var(--pine-50);
}
.task-actions .btn-delete:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-50);
}

.task-edit-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--pine-600);
  border-radius: var(--r-xs);
  font-size: 14px;
  outline: none;
  box-shadow: var(--sh-focus);
}
```

> 触屏注：hover 在移动端不存在。建议在 `<html>` 加 `.touch` class（JS 检测 `ontouchstart`），`.touch .task-actions { opacity: 1; }` 常显。这行可选，熊二看着加。

### 4.8 计数徽标（列头右侧）

这是新增的视觉信息。当前 `render()` 不输出计数。本方案在 `kanban.js` 的 `render()` 里，给每个 `.col-title` 末尾追加一个 `<span class="col-count">N</span>`（用 `textContent`，安全）。

```css
.col-count {
  margin-left: auto;
  min-width: 22px;
  height: 20px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-50);
  border-radius: var(--r-pill);
}
```

> 落地钩子（唯一需要改 kanban.js 的地方）：在 `render()` 三列渲染后，统计每列任务数，写入对应 `.col-count`。元素可在 `index.html` 静态预置 `<span class="col-count">0</span>`，JS 只更新文本，不增删节点。

### 4.9 空状态提示

当前 `.task-list:empty::after { content:"暂无任务" }`，干巴巴一行字。升级成带虚线占位框的友好提示。

```css
.task-list:empty {
  /* 空列表本身给一个虚线占位 */
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  margin: 8px;
  border: 2px dashed var(--border);
  border-radius: var(--r-sm);
}
.task-list:empty::after {
  content: "拖一张卡片到这里";
  color: var(--text-3);
  font-size: 13px;
}
/* 拖拽进行时空状态文案切换 */
.col.drag-over .task-list:empty::after {
  content: "放手吧～";
  color: var(--accent);
}
```

> 不同列也可给不同空文案（待办"还没有要干的活"、进行中"还没开工"、完成"还没完成的事"），用 `.col[data-status] .task-list:empty::after { content: ... }` 覆盖即可。

---

## 五、交互态细节（汇总速查表）

| 元素 | 静态 | hover | active/按下 | focus | 禁用 |
| --- | --- | --- | --- | --- | --- |
| `.btn-primary` | 松绿渐变 + 阴影 | `brightness(1.06)` + `translateY(-1px)` + 阴影加深 | `scale(0.98)` + 阴影收 | — | 浅松绿底 + 灰字 + 无阴影 |
| `#logout-btn` | 半透明白底 + 胶囊 | 白底透明度 0.18 | — | — | — |
| `.task-actions button` | 白底灰字 | 语义浅底 + 语义色字/边 | — | — | — |
| 表单 input | 极淡底 `#fbfdfc` | — | — | 松绿边 + 松绿聚焦环 + 底转白 | — |
| `.task-card` | 白底 + 左色条 | 抬升 `translateY(-1px)` + 边转语义色 + 操作按钮 opacity→1 | `cursor:grabbing` | — | — |
| `.task-card.dragging` | 半透明 + `rotate(-1.5deg) scale(1.02)` | — | — | — | — |
| `.col.drag-over .task-list` | — | 语义浅底 + 语义色虚线 outline | — | — | — |

按钮按下回弹用 `scale(0.98)` 而非位移，避免表单按钮位移导致误点。所有过渡走 `--ease`，时长 `--d-base(180ms)`，hover 微动效统一不突兀。

---

## 六、响应式设计

当前只有一个 `768px` 断点，太粗。本方案拆成三档，桌面横排、平板紧凑横排、手机纵向堆叠。

```css
/* 默认（桌面 ≥ 980px）：三列横排，列宽自适应，max-width 240 起 */
.board { gap: 20px; }

/* 平板 640–979px：仍三列横排，但收紧间距、列最小宽降低 */
@media (max-width: 979px) {
  .kanban-view { padding: 16px; }
  .board { gap: 12px; }
  .col { min-width: 180px; }
  .col-title { padding: 12px 12px; font-size: 14px; }
  .task-list { padding: 10px; }
}

/* 手机 < 640px：纵向堆叠，列全宽 */
@media (max-width: 639px) {
  .app-header {
    flex-direction: column;
    gap: 8px;
    text-align: center;
    padding: 12px 16px;
  }
  .app-title { font-size: 16px; }

  .kanban-view { padding: 12px; }
  .kanban-topbar { gap: 10px; }
  #add-form { max-width: 100%; }

  .board { flex-direction: column; gap: 14px; }
  .col {
    width: 100%;
    min-width: 0;
    max-height: none;      /* 移动端取消列高限，整页可滚 */
  }

  /* 登录卡移动端收紧 */
  .login-card { padding: 32px 22px 26px; max-width: 100%; }
}
```

> 取消 `max-height` 限制：桌面端列内独立滚动（卡片多了在列内滚），移动端改成整页滚动更顺手，避免小屏里出现"列内小滚轮"的糟糕体验。

---

## 七、微动效

### 7.1 视图切换过渡（登录 ↔ 看板）

当前 `App.showView()` 是直接 `hidden` 切，硬切没过渡。本方案用 `opacity + translateY` 淡入：

```css
.view {
  min-height: calc(100vh - 56px);
  animation: view-in var(--d-slow) var(--ease-out);
}
@keyframes view-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.view[hidden] { display: none !important; }
```

> 因为切换是给目标 view 去掉 `hidden`，`view-in` 会自动播一次进场。无需改 JS。登出回登录也会播，体验一致。

### 7.2 卡片新增进场

`kanban.js` 的 `render()` 每次全量重建 DOM，新卡片默认是"凭空出现"。给新建卡片加一个进场 class：

```css
/* 新增卡片：从上方滑入 + 淡入 */
.task-card.is-new {
  animation: card-in var(--d-slow) var(--ease-spring);
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(-10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

> 落地钩子：`_createTaskElement` 创建 `li` 时若该任务 `createdAt` 距 `Date.now()` < 800ms，则 `li.classList.add('is-new')`，并在 `animationend` 时移除。`render()` 全量重建会让所有卡片都"进场"——为避免整列闪动，可只对真正新增的那张加 `is-new`（addTask 成功后单独 append 并加 class，再走一次 render 去重）。最简方案：只给 `addTask` 路径的卡片加，其余不加。

### 7.3 卡片删除退场（需要小改 JS）

`render()` 是全量重建，删完立刻重渲染，旧卡片直接消失、没有退场。要做退场动画，得"先动画再 render"：

```css
.task-card.is-leaving {
  animation: card-out var(--d-base) var(--ease) forwards;
}
@keyframes card-out {
  to {
    opacity: 0;
    transform: translateX(12px) scale(0.94);
    max-height: 0;
    margin-bottom: 0;
    padding-top: 0;
    padding-bottom: 0;
    border-width: 0;
  }
}
```

> 落地钩子（需改 `deleteTask`）：点删除时先给目标卡片加 `is-leaving`，监听 `animationend`（180ms）后再真正调 `Storage.deleteTask` + `render()`。这会让删除有一个"向右滑出并塌缩"的反馈。若熊二不想动 JS，可直接跳过本条，删除仍是即时——不影响功能，只是少点动画。

### 7.4 拖拽落点回弹

卡片 drop 后落在新位置，给一个轻微的弹性下落：

```css
.task-card.is-dropped {
  animation: drop-settle var(--d-slow) var(--ease-spring);
}
@keyframes drop-settle {
  0%   { transform: translateY(-6px) scale(1.02); }
  60%  { transform: translateY(2px) scale(0.99); }
  100% { transform: translateY(0) scale(1); }
}
```

> 落地钩子：`moveTask` 成功后，在新列里找到该 id 的卡片加 `is-dropped`，`animationend` 移除。可选优化，不做也不影响。

### 7.5 按钮提交 loading（防抖可视化）

`auth.js` 已有防抖设计，这里给视觉反馈：提交时按钮加 `.is-loading`，文字变"处理中…"，左侧转一个小圈。

```css
.btn-primary.is-loading {
  pointer-events: none;
  opacity: 0.85;
}
.btn-primary.is-loading::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  vertical-align: -2px;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

> 落地钩子：`app.js` 提交时加 `is-loading`，Promise resolve 后移除。需配合把按钮文案切到"处理中…"——可用一个 `data-loading-text` 属性 + JS 切换 `textContent`。

---

## 八、熊二改造清单（落地优先级）

按"零改 JS → 小改 JS"排序，先做收益高的：

1. **替换 CSS 变量与色值**（零改 JS）：把 `style.css` 顶部加 `:root` 令牌块，所有硬编码 `#3498db`/`#2c3e50`/`#e74c3c`/`#f39c12`/`#27ae60`/`#f5f6f8` 换成 `var(--xxx)`。这一步就能把通用蓝换成松林蜜光，收益最大。
2. **登录卡 / 顶栏 / 列头 / 卡片样式块整段替换**（零改 JS）：照第三、四章的代码块替换对应选择器。
3. **拖拽高亮换语义色**（零改 JS）：`.col.drag-over .task-list` 改用 `--accent`/`--accent-50`。
4. **卡片左色条 + 圆点 + 空状态**（零改 JS）：靠 `--accent` 继承 + `::after`/`::before`，纯 CSS。
5. **视图切换进场动画**（零改 JS）：`.view` 加 `view-in` 动画，`showView` 不用动。
6. **计数徽标**（小改 kanban.js）：`index.html` 预置 `<span class="col-count">0</span>`，`render()` 里更新文本。
7. **错误抖动 / 按钮 loading**（小改 app.js）：setMsg 时加 `.shake`，提交时加 `.is-loading`。
8. **卡片新增/删除/落点动画**（中改 kanban.js）：`is-new`/`is-leaving`/`is-dropped` 三个 class 的注入与 `animationend` 清理。优先级最低，可后做。

> 约束提醒：所有动效与颜色都遵守 CSP（`style-src 'self' 'unsafe-inline'`，无外链字体/脚本），所有用户文本仍走 `textContent`，本方案不引入任何 `innerHTML`，安全基线不动。

---

> 这套方案交给你了，熊二照着填，保证丑不起来。好看就完事了！——翠花
