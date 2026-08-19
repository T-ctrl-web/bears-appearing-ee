# 熊出没集团 · 安全登录看板

> 文档工程师：肥波（光头强的宠物肥猫，不敲代码，专记代码做了啥）
> 口头禅："肥波记下来了！" "代码做了啥，问我就对啦。"
> 代码版本：2026-08-19 熊二实现版

---

## 一、项目简介

熊出没集团安全登录看板（secure-kanban）是一个**轻量级单页面 Web 应用**，为集团员工提供带安全登录的任务看板功能。全部采用原生 HTML / CSS / JavaScript 实现，零第三方框架依赖，开箱即用。

核心功能：

- 用户注册与登录（密码加盐哈希存储，绝不明文落盘）
- 任务看板三列管理：待办 / 进行中 / 完成
- HTML5 原生拖拽，任务在列间自由移动
- 任务内联编辑标题、删除
- localStorage 本地数据持久化，多用户数据隔离
- 纯前端安全防护：防 XSS、防暴力破解、防账号枚举、会话管理

技术栈一览：

| 项目 | 说明 |
| --- | --- |
| 语言 | 原生 HTML / CSS / JavaScript（ES5 风格，兼容性好） |
| 框架 | 无（不依赖 Vue / React / jQuery 等） |
| 存储 | localStorage + sessionStorage |
| 加密 | 浏览器内置 Web Crypto API（SHA-256） |
| 拖拽 | HTML5 Drag and Drop API（原生，无库） |

---

## 二、快速开始

### 环境要求

- 现代浏览器：Chrome 120+ / Firefox 121+ / Edge 120+
- 需支持 Web Crypto API（`crypto.subtle` / `crypto.getRandomValues`）
- 需支持 localStorage / sessionStorage

> 注意：Web Crypto API 在 `file://` 协议下多数浏览器可用，但部分版本 Firefox 要求 `https` 或 `localhost`。若哈希功能不可用，请用本地 HTTP 服务器打开。

### 打开方式

**方式一：直接打开（最简单）**

双击 `index.html`，在浏览器中打开即可使用。适合本地体验。

**方式二：本地 HTTP 服务器（推荐）**

如果遇到 Web Crypto API 不可用的情况，启动一个本地服务器：

```bash
# Python 3
python -m http.server 8000

# 或 Node.js（需先 npm i -g http-server）
http-server -p 8000
```

然后浏览器访问 `http://localhost:8000/index.html`。

### 首次使用

1. 打开页面，默认显示登录视图。
2. 点击底部"还没有账号？注册"切换到注册模式。
3. 输入用户名（字母数字下划线 3-20 位）和密码（6-20 位），点击注册。
4. 注册成功后自动切回登录模式，输入用户名密码登录。
5. 登录成功后进入看板视图，开始管理任务。

---

## 三、功能说明

### 3.1 注册

| 项目 | 规则 |
| --- | --- |
| 用户名 | 3-20 位，只允许字母（a-zA-Z）、数字（0-9）、下划线（_） |
| 密码 | 至少 6 位（建议字母+数字组合） |
| 限制 | 用户名唯一，重复注册不暴露具体原因 |

操作步骤：点击登录表单底部"还没有账号？注册" → 填写用户名和密码 → 点击"注册"按钮。注册成功后自动登录并进入看板视图，无需二次登录。

注册模式下"记住我"选项会隐藏，只有登录时才显示。

### 3.2 登录

| 项目 | 说明 |
| --- | --- |
| 默认登录 | 会话存入 sessionStorage，关闭标签页即清除 |
| 记住我 | 勾选后会话存入 localStorage，7 天内免登录，到期自动失效 |
| 登录失败 | 统一提示"用户名或密码错误"，不区分用户名不存在还是密码错 |
| 暴力破解防护 | 同一用户名连续失败 5 次，锁定 60 秒，期间提交直接拒绝 |
| 用户名不存在 | 做一次假哈希消耗时间后再返回错误，防止通过响应时间枚举账号 |

操作步骤：输入用户名和密码 → 可选勾选"记住我" → 点击"登录"。登录成功后自动切换到看板视图，顶部显示"登出"按钮。

登录过程中按钮会显示"登录中..."并禁用，防止重复提交。

### 3.3 看板操作

看板分为三列：待办、进行中、完成。每个任务是一张卡片。

| 操作 | 说明 |
| --- | --- |
| 新增任务 | 在顶部输入框输入标题（1-100 字符），回车或点击"新增"按钮，任务默认加入"待办"列 |
| 拖拽移动 | 按住任务卡片拖到目标列的任意位置释放，自动更新状态和列内顺序 |
| 编辑标题 | 点击卡片上的"编辑"按钮，标题变为输入框，回车保存、Esc 取消 |
| 删除任务 | 点击卡片上的"删除"按钮，立即删除（无确认弹窗） |
| 登出 | 点击顶部"登出"按钮，清除会话，返回登录视图 |

任务数据按登录用户隔离（`owner` 字段），不同用户的任务互不串台。空列表会显示"暂无任务"提示。

### 3.4 数据存储位置

| 数据 | 存储位置 | 说明 |
| --- | --- | --- |
| 用户表（含盐和哈希） | localStorage `sc:users` | 持久化，关浏览器不丢 |
| 任务表 | localStorage `sc:tasks` | 持久化，按 owner 字段过滤 |
| 默认会话 | sessionStorage `sc:session` | 关标签页即清除 |
| 记住我会话 | localStorage `sc:session_remember` | 7 天过期 |
| 登录失败计数 | 随用户记录存入 `sc:users` | 锁定解除后清零 |

---

## 四、技术架构

### 4.1 四模块分层

项目按职责拆为四个模块，单向依赖，谁也不许越权直接碰 localStorage：

```
┌──────────────────────────────────────────────────┐
│                   index.html                     │
│        登录视图 / 看板视图（CSS display 切换）      │
└────────────────────┬─────────────────────────────┘
                     │ <script> 加载顺序
        ┌────────────┼──────────────┐
        ▼            ▼              ▼         ▼
   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐
   │storage.js│ │ auth.js  │ │ kanban.js  │ │  app.js   │
   │  存储层   │ │  认证层  │ │  业务层    │ │  入口层   │
   └─────┬────┘ └────┬─────┘ └─────┬─────┘ └─────┬────┘
         ▲           │             │              │
         └───────────┴─────────────┘              │
              auth / kanban 单向依赖 storage       │
              kanban 操作前先问 auth 登录态        │
              app 依赖三者，管生命周期和视图切换    │
```

脚本加载顺序：`storage.js → auth.js → kanban.js → app.js`，保证引用时下层已就绪。

### 4.2 各模块职责

**storage.js（存储层 / 最底层）** —— 对 localStorage / sessionStorage 做统一封装，负责命名空间管理（`sc:` 前缀）、JSON 序列化反序列化、异常兜底。它是唯一有权碰浏览器存储的模块，别的模块想读写数据必须调它的 API。纯存储，不依赖任何其他模块。

暴露全局对象 `Storage`，主要方法：

| 方法 | 说明 |
| --- | --- |
| `get(key)` / `set(key, value)` / `remove(key)` | 通用读写删 |
| `getUsers()` / `saveUser(user)` / `findUser(name)` / `updateUser(name, patch)` | 用户表 CRUD |
| `getTasks(owner)` / `saveTask(task)` / `updateTask(id, patch)` / `deleteTask(id)` | 任务表 CRUD |
| `getSession()` / `setSession(session, remember)` / `clearSession()` | 会话读写清 |

**auth.js（认证层）** —— 登录、注册、登出、会话判断全归它。调用 storage.js 读写用户表与会话，调用浏览器 Web Crypto API 做密码加盐哈希与比对。所有"现在是谁、登没登录"的判断都从这儿出。

暴露全局对象 `Auth`，主要方法：

| 方法 | 说明 |
| --- | --- |
| `register(username, password)` | 注册：生成盐+哈希，写用户表 |
| `login(username, password, remember)` | 登录：取盐重算哈希比对，通过则建会话 |
| `logout()` | 登出：清会话 |
| `checkSession()` | 校验会话有效性，返回 username 或 null |
| `currentUser()` | 取当前登录用户名（轻量，不校验过期） |
| `validateUsername(name)` / `validatePassword(pwd)` | 输入校验 |
| `_generateSalt()` / `_hashPassword(pwd, salt)` / `_timingSafeEqual(a, b)` | 内部哈希方法（留 PBKDF2 升级口子） |

**kanban.js（业务层）** —— 看板三列的渲染、任务增删改、HTML5 原生拖拽全在这层。依赖 storage.js 读写任务数据，依赖 auth.js 拿当前登录用户名（任务按用户隔离）。所有写操作前先确认 `Auth.currentUser()` 非空。

暴露全局对象 `Kanban`，主要方法：

| 方法 | 说明 |
| --- | --- |
| `init()` | 初始化：绑定拖拽事件、首次渲染、绑定按钮 |
| `render()` | 全量重渲染三列（按当前用户过滤） |
| `addTask(title)` | 新增任务到待办列 |
| `moveTask(id, newStatus, insertIndex)` | 拖拽后移动：更新 status 与 order |
| `deleteTask(id)` | 删除任务 |
| `updateTaskTitle(id, title)` | 内联编辑任务标题 |
| `_createTaskElement(task)` | 用 createElement + textContent 构建卡片 DOM |

**app.js（入口层）** —— 页面生命周期管理、视图切换、表单事件绑定。`DOMContentLoaded` 触发后调 `Auth.checkSession()` 判断登没登录，有会话 → 看板视图 + `Kanban.init()`，无会话 → 登录视图。

暴露全局对象 `App`，主要方法：

| 方法 | 说明 |
| --- | --- |
| `init()` | 入口：检查会话、切换视图、绑定事件 |
| `showView(name)` | 切换登录/看板视图 |
| `bindEvents()` | 绑定表单提交、模式切换、登出事件 |
| `_handleAuth()` | 处理认证表单提交（登录或注册） |
| `_setMode(mode)` | 切换表单模式（登录/注册） |

> 架构小记：技术方案 spec.md 原本设计了三模块（storage / auth / kanban），实际实现中熊二加了一个 `app.js` 入口层，把视图切换和事件绑定从看板模块里拆出来，职责更清晰。肥波记下来了！

### 4.3 页面加载生命周期

1. `index.html` 按序加载四个脚本，各自暴露全局对象（`Storage` / `Auth` / `Kanban` / `App`）。
2. `DOMContentLoaded` 触发后，入口函数 `App.init()` 调 `Auth.checkSession()`。
3. 有有效会话 → 渲染看板视图、调 `Kanban.init()`；无会话 → 渲染登录视图。
4. 登录/登出成功后，`App.showView()` 切换两个视图并触发对应模块的初始化或清理。

### 4.4 单页双视图

`index.html` 一个页面装两个视图（登录视图 `#login-view` + 看板视图 `#kanban-view`），靠 CSS `display` / `hidden` 属性切换，不引入路由库。两个视图的 DOM 同时存在，隐藏的那个用 `hidden` 属性藏起来。

---

## 五、安全设计

本应用是纯前端无后端，没法用 HttpOnly Cookie + 服务端哈希那套"黄金标准"，所以安全和数据存储全在客户端扛。

### 5.1 密码加密存储（核心）

**采用 Web Crypto API 的 SHA-256 + 每用户独立随机盐值。**

注册流程：
1. `crypto.getRandomValues(new Uint8Array(16))` 生成 16 字节随机盐，Base64 编码。
2. 把盐字节与密码字节拼接，`crypto.subtle.digest('SHA-256', data)` 算出 32 字节摘要，Base64 编码。
3. 用户表里存 `{username, salt, passwordHash}`，密码原文用完即丢，绝不落盘。

登录流程：
1. 按 username 取出该用户的 `salt`。
2. 对输入密码用同一套盐再算一次 SHA-256。
3. 常量时间比对两个 Base64 哈希串（逐字节异或后归零判定），防计时侧信道。一致则放行。

关键设计点：

- **每用户独立盐**：攻击者即便拿到存储也得逐个用户重新预计算彩虹表，成本指数级抬升。
- **常量时间比对**（`_timingSafeEqual`）：哈希比对不因内容差异提前返回，防计时侧信道攻击。
- **用户不存在时做假哈希**：用户名不存在时不直接返回，而是生成假盐做一次完整哈希再返回错误，使响应时间与正常错误密码接近，防通过时间差枚举账号。
- **PBKDF2 升级口子**：哈希函数独立成 `Auth._hashPassword` 内部方法，未来要升级到 PBKDF2-HMAC-SHA256（迭代 ≥ 100,000 次）只需换内部实现，对外接口不动。

### 5.2 防 XSS

| 措施 | 说明 |
| --- | --- |
| 禁用 innerHTML | 全项目不使用 `innerHTML` 渲染用户输入，任务标题、用户名、错误提示一律用 `textContent` |
| createElement 手搓 DOM | 任务卡片用 `document.createElement` 逐个构建，不拼 HTML 字符串 |
| CSP 策略 | `index.html` 顶部配置 Content-Security-Policy meta 标签 |
| 无第三方脚本 | 不引入外部 CDN 脚本，杜绝供应链注入 |

CSP 策略内容：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
```

- `script-src 'self'`：只许同源脚本，禁内联脚本，外部脚本就算被注入也跑不起来。
- `style-src 'self' 'unsafe-inline'`：样式留 `'unsafe-inline'` 因为原生项目样式内联较多，CSS 注入危害低，务实取舍。

### 5.3 输入校验

校验分两层：前端即时校验（体验）+ 提交前二次校验（兜底）。纯前端没有后端，这第二层就是最终防线。

| 输入 | 规则 | 目的 |
| --- | --- | --- |
| 用户名 | 正则 `^[a-zA-Z0-9_]{3,20}$` | 只许字母数字下划线，把 `<` `>` `&` `"` `'` 挡在门外 |
| 密码 | 至少 6 位 | 基础强度要求 |
| 任务标题 | 1-100 字符，提交前空白裁剪 | 防空标题和超长输入 |

登录失败统一回"用户名或密码错误"，不区分"用户名不存在"还是"密码错"，防账号枚举。

### 5.4 防暴力破解

| 规则 | 说明 |
| --- | --- |
| 失败计数 | 同一用户名连续登录失败 5 次，锁定 60 秒 |
| 锁定存储 | `failCount` 和 `lockUntil` 随用户记录持久化到 localStorage |
| 锁定行为 | 倒计时内提交直接拒绝，提示剩余秒数 |
| 锁定解除 | 到期后 `failCount` 清零，下一轮重新计数 |
| 防重复提交 | 提交按钮 loading 态 + 防抖标志 `_submitting`，提交中拒绝二次点击 |

### 5.5 会话管理

无后端就没有 Access/Refresh Token 双 token 那套。会话设计如下：

| 模式 | 存储 | 过期 | 说明 |
| --- | --- | --- | --- |
| 默认 | sessionStorage | 关标签页即清除 | 临时会话，不持久 |
| 记住我 | localStorage | 7 天 | 带过期时间戳，到期自动失效 |

会话数据只存三样：随机 token（32 字节，`crypto.getRandomValues` 生成）+ 用户名指针 + 登录时间戳。不存密码、不存哈希。校验时拿 token 反查用户表确认用户存在即可。即便会话被偷，攻击者拿到的也是个 token，不是密码。

切换"记住我"时会先清掉另一处存储（`clearSession`），避免双份残留。

---

## 六、目录结构说明

```
demo2/
├── index.html              主页面（登录视图 + 看板视图，单页双视图）
├── css/
│   └── style.css           全局样式（布局、配色、交互态、响应式）
├── js/
│   ├── storage.js          存储层（封装 localStorage / sessionStorage）
│   ├── auth.js             认证层（注册 / 登录 / 登出 / 会话 / 密码哈希）
│   ├── kanban.js           业务层（看板渲染 / 任务 CRUD / 拖拽）
│   └── app.js              入口层（生命周期 / 视图切换 / 事件绑定）
├── tests/
│   ├── .gitkeep            目录占位
│   └── test.md             测试用例报告（蹦蹦编写）
├── PROJECT.txt             项目脚手架说明（拖拖编写）
├── research.md             安全调研报告（毛毛编写）
├── spec.md                 技术架构方案
├── ui-spec.md              UI 设计规范
└── README.md              本文档（肥波编写）
```

---

## 七、文件清单

| 文件 | 大小 | 职责 | 编写者 |
| --- | --- | --- | --- |
| `index.html` | 3.4 KB | 单页面入口，承载登录与看板 DOM 结构，配置 CSP | 熊二 |
| `css/style.css` | 9.8 KB | 全局样式，松林蜜光主题（松针绿品牌色+蜂蜜蜜点缀色+三列语义色叙事线） | 翠花 |
| `js/storage.js` | 8.3 KB | 存储层，唯一碰 localStorage 的模块 | 熊二 |
| `js/auth.js` | 10.0 KB | 认证层，密码哈希、登录注册登出、会话判断、防暴力 | 熊二 |
| `js/kanban.js` | 14.5 KB | 业务层，看板渲染、任务增删改、HTML5 拖拽 | 熊二 |
| `js/app.js` | 6.3 KB | 入口层，页面生命周期、视图切换、表单事件 | 熊二 |
| `tests/test.md` | 34.3 KB | 测试用例报告，覆盖功能/校验/安全/边界/性能 | 蹦蹦 |
| `PROJECT.txt` | 2.8 KB | 项目脚手架与文件职责说明 | 拖拖 |
| `research.md` | 16.2 KB | 安全调研报告（密码存储、防 XSS、CSP） | 毛毛 |
| `spec.md` | 19.9 KB | 技术架构方案 | 毛毛 |
| `ui-spec.md` | 29.8 KB | UI 设计规范 | — |
| `README.md` | — | 本使用文档 | 肥波 |

---

## 八、已知问题

### 已修复（萝卜头修复 + 翠花主题落地）

以下 Bug 在集成验证后由萝卜头（调试）全部修复：

| Bug | 严重度 | 说明 | 修复方式 |
|-----|--------|------|----------|
| BUG-005 | P3 | 拖拽高亮残留 | 改用 dragenter/dragleave 计数器 |
| BUG-009 | P3 | 密码 maxlength 过严 | maxlength 20→128，placeholder 更新 |
| BUG-010 | P3 | 选择器拼接用户可控值 | render() 加 STATUS_LIST 白名单校验 |
| BUG-011 | P3 | autocomplete 值不规范 | 用户名改 autocomplete="username" |
| BUG-012 | P2 | 注册接口账号枚举 | 模糊错误提示 + 注册成功自动登录 |
| BUG-013 | P3 | blur 与 Enter 双触发 | save/cancel 中先移除事件监听器 |

翠花"松林蜜光"主题已落地到 style.css，包含松针绿品牌色、蜂蜜蜜点缀色、三列语义色叙事线、微动效。

### 待后续

P2/P3 级别的体验优化和功能增强，不阻断当前交付。

---

> 这文档肥波搞定！项目简介、快速开始、功能说明、技术架构、安全设计、目录结构、文件清单、已知问题八节齐活。代码做了啥，问我就对啦。
