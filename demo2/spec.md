# 熊出没集团安全登录看板 技术架构方案

> 强哥我寻思一下…这活儿得从模块切分、密码咋存、页面咋切三处下手。毛毛那份调研报告钻得挺深，密码存储、防 XSS、CSP 全给你扒出来了，我照着落地就行。下面这套方案，三模块分层 + Web Crypto API 加盐哈希 + 纯前端 view 切换，原生三件套一把梭。

- 项目：secure-kanban（安全登录看板）
- 技术栈：原生 HTML / CSS / JavaScript，无框架依赖
- 存储：localStorage（密码严禁明文）
- 输出范围：架构、安全、数据结构、接口、页面、安全清单
- 依据：`PROJECT.txt`（脚手架与文件职责）、`research.md`（安全调研报告）

---

## 架构概述

### 三模块划分

脚手架已经把文件职责切好了，我顺着它把逻辑层也分成三层，单向依赖，谁也不许越权直接摸 localStorage。

```
┌──────────────────────────────────────────────────┐
│                   index.html                     │
│        登录视图 / 看板视图（CSS display 切换）      │
└────────────────────┬─────────────────────────────┘
                     │ <script> 加载顺序
        ┌────────────┼──────────────┐
        ▼            ▼              ▼
   ┌──────────┐ ┌──────────┐ ┌───────────┐
   │storage.js│ │ auth.js  │ │ kanban.js  │
   │  存储层   │ │  认证层  │ │  业务层    │
   └─────┬────┘ └────┬─────┘ └─────┬─────┘
         ▲           │             │
         └───────────┴─────────────┘
              auth / kanban 单向依赖 storage
              kanban 操作前先问 auth 登录态
```

**storage.js（存储层 / 最底层）** —— 对 localStorage 做统一封装，负责命名空间管理、JSON 序列化反序列化、异常兜底。它是唯一有权碰 localStorage 的模块，别的模块想读写数据必须调它的 API。这一层不引用 auth、kanban，纯存储，谁也不依赖。

**auth.js（认证层）** —— 登录、注册、登出、会话判断全归它。它调用 storage.js 读写用户表与会话，调用浏览器 Web Crypto API 做密码加盐哈希与比对。所有"现在是谁、登没登录"的判断都从这儿出。

**kanban.js（业务层）** —— 看板三列（待办 / 进行中 / 完成）的渲染、任务增删改、HTML5 原生拖拽全在这层。它依赖 storage.js 读写任务数据，依赖 auth.js 拿当前登录用户名（任务按用户隔离）。

依赖关系一句话：`kanban.js → auth.js → storage.js`，单向、不回头。`index.html` 按 `storage.js → auth.js → kanban.js` 顺序加载脚本，保证引用时下层已就绪。这条规矩对应 `PROJECT.txt` 里"数据存储统一走 storage.js，其他模块不要直接操作 localStorage"那条备注，我用依赖方向给它焊死。

### 页面加载生命周期

1. `index.html` 按序加载三个脚本，各自暴露一个全局对象（`Storage` / `Auth` / `Kanban`）。
2. `DOMContentLoaded` 触发后，入口函数 `App.init()` 调 `Auth.checkSession()`。
3. 有有效会话 → 渲染看板视图、调 `Kanban.init()`；无会话 → 渲染登录视图。
4. 登录/登出成功后，`App.showView()` 切换两个视图并触发对应模块的初始化或清理。

---

## 安全设计

毛毛报告的核心结论就一句：localStorage 里绝不能存明文密码，任何能跑 JS 的脚本都能把它薅走。本方案是纯前端无后端，没法用 HttpOnly Cookie + 服务端哈希那套"黄金标准"，所以密码这关必须在客户端用 Web Crypto API 自己扛，XSS 这关得从渲染源头堵。

### 密码存储方案（核心）

**采用 Web Crypto API 的 SHA-256 + 每用户独立随机盐值**，注册时存盐和哈希、登录时重新哈希比对，全程不留明文。具体流程：

注册：
1. `crypto.getRandomValues(new Uint8Array(16))` 生成 16 字节随机盐，Base64 编码。
2. 把盐字节与密码字节拼接，`crypto.subtle.digest('SHA-256', data)` 算出 32 字节摘要，Base64 编码。
3. 用户表里存 `{username, salt, passwordHash}`，密码原文用完即丢，绝不落盘。

登录：
1. 按 username 取出该用户的 `salt`。
2. 对输入密码用同一套盐再算一次 SHA-256。
3. 常量时间比对两个 Base64 哈希串（逐字节异或后归零判定），防计时侧信道。一致则放行。

关键代码骨架（落在 `auth.js`）：

```js
// 16 字节随机盐，Base64
function generateSalt(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return toBase64(arr);
}

// SHA-256(salt_bytes || password_bytes)，Base64
async function hashPassword(password, saltB64) {
  const salt = fromBase64(saltB64);
  const enc = new TextEncoder();
  const pwd = enc.encode(password);
  const data = new Uint8Array(salt.length + pwd.length);
  data.set(salt, 0);
  data.set(pwd, salt.length);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(new Uint8Array(digest));
}

// 常量时间比对，防计时侧信道
function timingSafeEqual(a, b) {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
```

**为什么盐要每用户独立**：彩虹表是针对固定盐或无盐的预计算攻击。每个用户一把随机盐，攻击者即便拿到存储也得逐个用户重新预计算，成本指数级抬升。

**进阶加固提示**：毛毛报告里更狠的方案是 PBKDF2-HMAC-SHA256（迭代 ≥ 100,000 次，W3C 建议 600,000 次），同样用 `crypto.subtle.deriveBits()` 实现，防彩虹表和暴力破解更强。当前 SHA-256+盐满足"密码不明文"的安全基线，且实现最轻；若后续要提安全级别，把 `hashPassword` 内部换成 PBKDF2 即可，对外接口不动，平滑升级。这一点我在接口设计里把哈希函数独立成内部方法，就是为以后换算法留口子。

### 防 XSS

看板任务标题、用户名这些动态内容，一律用 `textContent` 写进 DOM，`innerHTML` 在本项目禁用。这是 DOM 型 XSS的根治办法——根本不把用户输入当 HTML 解析。任务卡片的 DOM 结构用 `document.createElement` 手搓，文本节点用 `textContent` 赋值。

`index.html` 顶部用 `<meta http-equiv="Content-Security-Policy">` 配 CSP，作为 XSS 最后一道防线：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'">
```

脚本只许同源、不许内联（`script-src 'self'`），外部脚本就算被注入也跑不起来。样式留 `'unsafe-inline'` 是因为原生项目样式内联较多，CSS 注入危害低，务实取舍。

### 输入校验

校验分两层：前端即时校验（体验）+ 提交前二次校验（兜底）。纯前端没有后端，这第二层就是最终防线。

- 用户名：正则 `^[a-zA-Z0-9_]{3,20}$`，只许字母数字下划线、3-20 位，把 `<` `>` `&` `"` `'` 这类危险字符挡在门外。
- 密码：长度 ≥ 6，建议字母+数字组合，给实时强度提示。
- 任务标题：1-100 字符，提交前做长度校验与空白裁剪。

登录失败统一回"用户名或密码错误"，不区分"用户名不存在"还是"密码错"，防账号枚举。

### 防暴力破解

同一用户名连续登录失败 5 次，锁 60 秒。失败计数和锁定到期时间存 localStorage（按用户名记），倒计时内提交直接拒绝。提交按钮加 loading 态 + 防抖，防重复点击。

### 会话管理（纯前端版）

无后端就没有 Access/Refresh Token 双 token 那套。登录成功后，`sessionStorage` 存一条会话（用户名 + 登录时间戳 + 随机 sessionToken），刷新页面靠 `Auth.checkSession()` 续上。sessionStorage 关标签页即清，比 localStorage 持久化凭证更稳。"记住我"勾选时，会话迁到 localStorage 并带 7 天过期时间，到期自动失效。

会话里不存密码、不存哈希，只存一个无意义随机 token + 用户名指针，校验时拿 token 反查用户表即可。即便会话被偷，攻击者拿到的也是个 token，不是密码。

---

## 数据结构设计

所有 localStorage key 统一前缀 `sc:`（secure-kanban），命名空间隔离，避免和别人家应用撞 key。

### localStorage key 一览

| Key | 存放内容 | 数据类型 |
| --- | --- | --- |
| `sc:users` | 全量用户表 | JSON 数组 |
| `sc:tasks` | 全量任务表（按 owner 过滤） | JSON 数组 |
| `sc:loginFail` | 登录失败计数与锁定（可选） | JSON 对象，key 为 username |
| `sc:session_remember` | 仅勾选"记住我"时的持久会话 | JSON 对象，不勾则不写 |

sessionStorage key：

| Key | 存放内容 |
| --- | --- |
| `sc:session` | 当前会话（用户名 + 登录时间 + 随机 token） |

### 用户数据格式（`sc:users` 单项）

```json
{
  "username": "guangtouqiang",
  "salt": "hK8p2...==",
  "passwordHash": "9f2c1...==",
  "createdAt": 1760380800000,
  "failCount": 0,
  "lockUntil": 0
}
```

- `username`：登录名，唯一键，正则校验过。
- `salt` / `passwordHash`：Web Crypto API 产物，Base64 字符串。密码原文永不出现。
- `createdAt`：注册时间戳（ms）。
- `failCount` / `lockUntil`：防暴力破解计数与锁定到期时间戳；锁定解除后清零。

### 任务数据格式（`sc:tasks` 单项）

```json
{
  "id": "task_1760380900123_a3f9",
  "title": "去砍树",
  "status": "todo",
  "owner": "guangtouqiang",
  "order": 0,
  "createdAt": 1760380900123,
  "updatedAt": 1760380905123
}
```

- `id`：`task_` + 时间戳 + 4 位随机后缀，保证唯一。
- `title`：任务文本，渲染走 `textContent`。
- `status`：三态枚举 `"todo"` / `"doing"` / `"done"`，对应三列。
- `owner`：所属用户名，看板按当前登录用户过滤，多用户数据互不串台。
- `order`：列内排序，拖拽换列或换序时更新。

### 会话数据格式（`sc:session` / `sc:session_remember`）

```json
{
  "username": "guangtouqiang",
  "token": "8a7b...e4",
  "loginAt": 1760380800000,
  "expiresAt": 1760985600000
}
```

`token` 是登录时 `crypto.getRandomValues` 生成的随机串，无业务含义，仅用于会话有效性反查。`expiresAt` 仅"记住我"会话有，sessionStorage 会话不设过期、靠关页清除。

---

## 接口定义

每个模块暴露一个全局对象，方法用 JSDoc 风格签名。返回值统一用 `{ok: boolean, msg?: string, data?: T}` 结构，调用方一眼能判断成败。

### storage.js → `Storage`

存储层只管读写与序列化，不含任何业务判断。

```js
const Storage = {
  // —— 通用 ——
  /** 读 key，JSON 反序列化；不存在或解析失败返回 null */
  get(key): any | null
  /** 写 key，JSON 序列化；失败返回 false */
  set(key, value): boolean
  /** 删 key */
  remove(key): void

  // —— 用户表 ——
  /** 取全量用户 */
  getUsers(): User[]
  /** 新增用户（username 已存在则返回 false） */
  saveUser(user): boolean
  /** 按 username 查用户，无则返回 null */
  findUser(username): User | null
  /** 按 username 局部更新字段 */
  updateUser(username, patch): boolean

  // —— 任务表 ——
  /** 取某 owner 的全部任务，按 status+order 排序 */
  getTasks(owner): Task[]
  /** 新增任务 */
  saveTask(task): boolean
  /** 按 id 局部更新（status/order/title 等） */
  updateTask(id, patch): boolean
  /** 按 id 删除任务 */
  deleteTask(id): boolean

  // —— 会话 ——
  /** 取当前会话（优先 sessionStorage，再查 localStorage 记住我） */
  getSession(): Session | null
  /** 写会话（remember=true 落 localStorage，否则落 sessionStorage） */
  setSession(session, remember): void
  /** 清两处会话 */
  clearSession(): void
}
```

### auth.js → `Auth`

认证层，含密码哈希、登录注册登出、会话判断、输入校验。哈希函数独立成内部方法，方便以后换 PBKDF2。

```js
const Auth = {
  // —— 密码哈希（内部）——
  /** 生成 16 字节随机盐，Base64 */
  _generateSalt(len?): string
  /** SHA-256(salt || password)，Base64 */
  _hashPassword(password, saltB64): Promise<string>
  /** 常量时间比对两个哈希串 */
  _timingSafeEqual(a, b): boolean

  // —— 输入校验 ——
  /** 用户名校验：{ok, msg} */
  validateUsername(name): {ok: boolean, msg?: string}
  /** 密码强度校验：{ok, msg} */
  validatePassword(pwd): {ok: boolean, msg?: string}

  // —— 认证流程 ——
  /** 注册：生成盐+哈希，写用户表。失败（用户名已存在/格式错）返回 {ok:false,msg} */
  register(username, password): Promise<Result>
  /** 登录：取盐重算哈希比对，通过则建会话。失败统一返回"用户名或密码错误"，并累加 failCount */
  login(username, password, remember): Promise<Result>
  /** 登出：清会话、清失败计数 */
  logout(): void

  // —— 会话 ——
  /** 校验会话有效性（token 反查用户存在 + 未过期），返回 username 或 null */
  checkSession(): string | null
  /** 取当前登录用户名（不校验过期，轻量） */
  currentUser(): string | null
}
```

### kanban.js → `Kanban`

业务层，管看板渲染与任务操作，所有写操作前先确认 `Auth.currentUser()` 非空。

```js
const Kanban = {
  /** 初始化：绑定拖拽事件、首次渲染、绑定新增/删除按钮 */
  init(): void
  /** 全量重渲染三列（按当前用户过滤任务） */
  render(): void
  /** 新增任务到 todo 列。标题非法返回 {ok:false,msg} */
  addTask(title): Result
  /** 拖拽后移动：更新 status 与 order */
  moveTask(id, newStatus, newOrder): Result
  /** 删除任务 */
  deleteTask(id): Result
  /** 内联编辑任务标题 */
  updateTaskTitle(id, title): Result
  // —— 内部 ——
  /** 校验任务标题长度与空白 */
  _validateTitle(title): {ok: boolean, msg?: string}
  /** 用 createElement+textContent 构建单个任务卡片 DOM */
  _createTaskElement(task): HTMLElement
}
```

模块间调用链举例：用户拖一张卡片到"完成"列 → `Kanban.moveTask(id, 'done', newOrder)` → `Storage.updateTask(id, {status:'done', order:newOrder, updatedAt:Date.now()})` → `Kanban.render()`。全程不碰 localStorage，全走 `Storage`。

---

## 页面结构设计

### 单页双视图

`index.html` 一个页面装两个视图，靠 CSS `display` 切换，不引入路由库。两个视图的 DOM 同时存在，隐藏的那个 `hidden` 属性或 `display:none`。

```html
<body>
  <header> 熊出没集团 · 安全登录看板 <button id="logout-btn" hidden>登出</button> </header>

  <!-- 登录视图 -->
  <section id="login-view">
    <form id="login-form">
      <input id="username" autocomplete="new-password">
      <input id="password" type="password" autocomplete="new-password">
      <label><input type="checkbox" id="remember"> 记住我</label>
      <button type="submit">登录</button>
      <button type="button" id="register-btn">注册</button>
      <p id="login-msg"></p>
    </form>
  </section>

  <!-- 看板视图 -->
  <section id="kanban-view" hidden>
    <form id="add-form"><input id="task-title"><button>新增</button></form>
    <div class="board">
      <div class="col" data-status="todo">  待办  <ul class="task-list"></ul></div>
      <div class="col" data-status="doing"> 进行中<ul class="task-list"></ul></div>
      <div class="col" data-status="done">  完成  <ul class="task-list"></ul></div>
    </div>
  </section>

  <script src="js/storage.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/kanban.js"></script>
</body>
```

### 视图切换方案

入口对象 `App` 持有切换逻辑，比 hash 路由更轻、够用：

```js
const App = {
  init() {
    const user = Auth.checkSession();
    if (user) { this.showView('kanban'); Kanban.init(); }
    else      { this.showView('login'); }
    this.bindEvents();        // 登录/注册/登出表单提交
  },
  showView(name) {
    const isKanban = name === 'kanban';
    document.getElementById('kanban-view').hidden = !isKanban;
    document.getElementById('login-view').hidden =  isKanban;
    document.getElementById('logout-btn').hidden   = !isKanban;
  }
};
document.addEventListener('DOMContentLoaded', () => App.init());
```

### 登录 → 看板的切换流程

1. 登录表单 submit → `Auth.login(username, password, remember)`。
2. 成功 → `App.showView('kanban')` → `Kanban.init()` 渲染当前用户任务。失败 → `#login-msg` 用 `textContent` 显示"用户名或密码错误"，不动视图。
3. 登出按钮 → `Auth.logout()` → `App.showView('login')`，并清空看板 DOM（`Kanban.render()` 在无用户时渲染空列表）。

### 拖拽实现

原生 HTML5 Drag and Drop API，无库。任务卡片 `draggable="true"`，监听 `dragstart`（记 `id`）、列 `dragover`（`preventDefault` 允许放置）、`drop`（取 `id`，按落点算新 `status` 与 `order`，调 `Kanban.moveTask`）。落点 order 取相邻两张卡片 order 中值，保证拖拽后顺序连续。

---

## 安全要点清单

落地版，对着毛毛报告的清单逐条收敛到纯前端能做的。

**密码存储**
- 密码绝不明文落 localStorage，注册即用 Web Crypto API SHA-256 + 16 字节随机盐哈希，只存 `salt` 与 `passwordHash`
- 每用户独立盐，防彩虹表预计算
- 登录哈希比对用常量时间比较，防计时侧信道
- 哈希函数独立成 `Auth._hashPassword`，留 PBKDF2 升级口子

**防 XSS**
- 全项目禁用 `innerHTML` 渲染用户输入，任务标题、用户名、错误提示一律 `textContent`
- 任务卡片用 `document.createElement` 手搓，不拼 HTML 字符串
- `index.html` 配 CSP meta：`script-src 'self'`，禁内联脚本
- 不引入第三方 CDN 脚本；如必须引入，配 SRI 完整性校验

**输入校验**
- 用户名 `^[a-zA-Z0-9_]{3,20}$`、密码 ≥ 6、任务标题 1-100，提交前二次校验
- 登录失败统一提示"用户名或密码错误"，防账号枚举
- 密码字段 `type="password"` + `autocomplete="new-password"`

**会话与防暴力**
- 会话只存随机 token + 用户名指针，不存密码/哈希
- 默认 sessionStorage（关页即清）；"记住我"迁 localStorage 并带 7 天过期
- 同用户名失败 5 次锁 60 秒，`failCount`/`lockUntil` 持久化
- 提交按钮 loading 态 + 防抖，防重复提交

**工程纪律**
- 模块单向依赖 `kanban → auth → storage`，localStorage 只在 `storage.js` 出现
- 生产环境移除 `console.log` 中任何含密码/哈希/会话 token 的输出
- 上线前做一轮 XSS 自查（手动注入 `<img onerror>` 等payload 验证 `textContent` 拦截）

---

> 这方案我搞定！三模块分层清爽，密码用 Web Crypto API 加盐哈希扛住，XSS 从 `textContent` 根治加 CSP 兜底，会话纯前端版用 token 反查不存密码。熊二、翠花照着接口填实现就行，别越权碰别人的模块。慢慢来，稳稳的。
