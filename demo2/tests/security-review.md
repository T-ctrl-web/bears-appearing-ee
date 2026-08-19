# 安全审查报告

## 基本信息

| 项目 | 说明 |
| --- | --- |
| 审查人 | 铁掌大师（东北虎，熊出没集团安全审查官） |
| 审查等级 | Level 3 — 强对抗安全审查 |
| 审查轮次 | 第 1 轮 / 最多 3 轮 |
| 审查日期 | 2026-08-19 |
| 审查对象 | 熊出没集团安全登录看板（secure-kanban）纯前端应用 |
| 审查范围 | spec.md 技术方案 + index.html + storage.js + auth.js + kanban.js + app.js + test.md 测试报告 |
| 审查方法 | 代码静态审计 + 攻击向量主动构造 + 攻击面推演 |

> 审查人口头禅记录：
> （平静时）"贫僧看看…这里有个隐患。"
> （生气时）"又犯同样的错！重写！全部重写！"
> （驳回时）"安全无小事，驳回，不可放行！"

---

## 安全审查清单

| # | 检查项 | 结果 | 风险 | 详情 |
| --- | --- | --- | --- | --- |
| 1 | 输入验证 | 不通过 | 高 | 用户名注册时正则校验到位，但登录路径不校验用户名格式；任务标题仅校验长度与空白，未做字符级转义（虽 textContent 兜底，但纵深不足）；密码仅校验长度未校验复杂度 |
| 2 | 注入防护 | 通过（有保留） | 低 | XSS 防护扎实——全项目零 innerHTML 调用，统一 textContent + createElement；CSP meta 配置 script-src 'self'。无 SQL/命令注入面（纯前端无后端）。但 CSP 缺 frame-ancestors，style-src 'unsafe-inline' 留有 CSS 注入口 |
| 3 | 认证授权 | 不通过 | 严重 | 会话 token 形同虚设——checkSession 不校验 token 有效性；Storage.updateUser 无权限隔离，可改任意用户密码哈希接管账户；Kanban.deleteTask/updateTaskTitle 不校验任务归属（IDOR） |
| 4 | 数据泄露 | 不通过 | 高 | 全量用户表（含 salt + passwordHash）明文存 localStorage，任何 JS 可读取；会话 token 存 localStorage（记住我模式），可被窃取；单次 SHA-256 无迭代，离线暴力破解成本极低 |
| 5 | 依赖安全 | 通过 | 低 | 原生三件套零第三方依赖，无已知漏洞的供应链风险。CSS 为本地文件，无 CDN 引入 |
| 6 | 配置安全 | 通过 | 低 | 代码中无硬编码密钥/API Key/数据库连接串。MAX_FAIL、LOCK_DURATION 等为安全参数非凭证。CSP 策略正确配置在 meta 中 |
| 7 | 日志安全 | 通过 | 低 | 全项目零 console.log 调用，无敏感信息输出到控制台。异常被 catch 静默处理，不泄露堆栈。但异常处理过于宽泛，调试困难 |
| 8 | 异常处理 | 通过（有保留） | 低 | Storage 层异常 catch 后返回 null/false，不抛给上层。App._handleAuth 的 catch 统一返回"系统异常，请重试"不泄露内部细节。但所有 catch 块均空处理（`catch(e){}`），丢失错误上下文 |
| 9 | 极端边界 | 不通过 | 高 | localStorage 篡改可绕过暴力破解锁定；伪造会话可冒充任意用户；篡改密码哈希可接管账户；Math.random() 生成任务 ID 存碰撞风险；查询选择器拼接用户可控 status 值可破坏渲染 |
| 10 | 架构安全 | 不通过 | 高 | 三层分层设计合理（kanban -> auth -> storage 单向依赖），但 Storage 层作为"唯一碰 localStorage 的模块"暴露了无权限校验的全局 API（updateUser/saveTask/deleteTask），任何控制台代码均可直接调用，等于把数据库的读写权限完全暴露 |

---

## 发现的漏洞

### 漏洞总览

| # | 类型 | 位置 | 严重度 | 描述 | 攻击向量 | 修复建议 |
| --- | --- | --- | --- | --- | --- | --- |
| V-01 | 认证绕过/会话伪造 | auth.js:288-312 | 严重 | checkSession() 仅校验 session.username 对应的用户是否存在，完全不校验 session.token 是否与登录时生成的一致。任何能写入 sessionStorage 的代码均可伪造会话 | 控制台执行：`sessionStorage.setItem('sc:session', JSON.stringify({username:'guangtouqiang', token:'fake_token', loginAt: Date.now()}))` 然后刷新页面 -> 直接以 guangtouqiang 身份进入看板，无需密码 | 用户表存最近一次登录的 token 哈希，checkSession 时常量时间比对 token。参见下方"详细攻击推演 V-01" |
| V-02 | 越权写/账户接管 | storage.js:119-136 | 严重 | Storage.updateUser(username, patch) 无任何权限校验，接受任意 username 和任意 patch 字段。攻击者可直接覆写目标用户的 salt 和 passwordHash，完成账户接管 | 控制台执行：`var s=Auth._generateSalt(); Auth._hashPassword('hacked123',s).then(function(h){Storage.updateUser('guangtouqiang',{salt:s,passwordHash:h})})` 然后用 hacked123 登录 guangtouqiang 账户 | 纯前端无法完全防此攻击，但应：(1) 在 updateUser 内部对敏感字段（salt/passwordHash）做写保护；(2) 文档明确标注此局限；(3) 长期方案引入后端 |
| V-03 | 密码学强度不足 | auth.js:87-98 | 严重 | 密码哈希使用单次 SHA-256(salt||password)，无迭代。spec 自己也承认应使用 PBKDF2（>=100,000 次迭代），但实现未落地。GPU 每秒可计算数十亿次 SHA-256，常见密码在秒级内被离线破解 | 攻击者读取 localStorage 中的 sc:users -> 获取全部用户的 salt + passwordHash -> 用 hashcat 等工具离线暴力破解，常见密码（abc123、password 等）秒级破解 | 将 _hashPassword 内部替换为 PBKDF2-HMAC-SHA256（迭代 >= 100,000 次），spec 已预留接口，直接用 crypto.subtle.deriveBits 实现 |
| V-04 | 暴力破解锁定绕过 | auth.js:232-253 | 高 | 登录锁定机制（failCount/lockUntil）依赖 localStorage 中的可篡改数据。攻击者可直接清零 failCount 和 lockUntil，绕过 5 次锁定限制，实现无限制暴力破解 | 控制台执行：`var u=Storage.findUser('guangtouqiang'); Storage.updateUser('guangtouqiang',{failCount:0,lockUntil:0})` 锁定立即解除，可继续暴力破解 | 纯前端无法完全防此攻击（localStorage 可篡改）。但应：(1) 在文档中明确标注此局限；(2) 增加服务端速率限制作为纵深防御；(3) 当前至少应配合 V-03 修复后，即使绕过锁定，离线破解也因 PBKDF2 而成本极高 |
| V-05 | IDOR/越权操作 | kanban.js:200-213, 221-242 | 高 | Kanban.deleteTask(id) 和 Kanban.updateTaskTitle(id, title) 调用 Storage.deleteTask/updateTask 时，不校验该任务是否属于当前登录用户。攻击者可删除/修改其他用户的任务 | 控制台执行：`var t=Storage.get('tasks'); Kanban.deleteTask(t[0].id)` -> 删除第一个任务（可能是其他用户的）。或 `Kanban.updateTaskTitle(t[0].id,'已被篡改')` 篡改他人任务标题 | 在 deleteTask/updateTaskTitle 内部先 Storage.getTasks(user) 取当前用户任务列表，校验 id 属于当前用户后再操作。或改用 Storage 层增加 owner 参数校验 |
| V-06 | 登出未清失败计数 | auth.js:278-280 | 高 | logout() 仅调用 Storage.clearSession()，未重置当前用户的 failCount 和 lockUntil。与技术方案"登出：清会话、清失败计数"的声明不符 | 用户连续失败 4 次后登出 -> 重新登录再失败 1 次即触发锁定（failCount 从 4 递增到 5） | logout 中增加 `var u=this.currentUser(); if(u){Storage.updateUser(u,{failCount:0,lockUntil:0})} Storage.clearSession()` |
| V-07 | 注册接口账号枚举 | auth.js:185-187 | 中 | 注册时若用户名已存在，返回"用户名已被注册"。攻击者可通过批量尝试注册来枚举已注册用户名，与登录接口的防枚举设计不一致 | 攻击者遍历用户名列表调用 Auth.register -> 根据返回信息判断哪些用户名已注册 -> 结合 V-01 伪造会话直接登录 | 纯前端无法完全防此攻击。建议：(1) 注册成功后自动登录而非要求二次登录；(2) 或统一返回"注册失败"不区分原因 |
| V-08 | 计时侧信道（锁定状态泄露） | auth.js:232-238 | 中 | 账户锁定时 login() 在哈希计算之前直接 Promise.resolve 返回。未锁定用户即使密码错误也会执行 SHA-256 哈希。响应时间差异可判断账户是否被锁定 | 攻击者用错误密码对同一用户名多次登录 -> 测量响应时间 -> 响应快的说明账户已被锁定 -> 据此调整暴力破解策略 | 锁定状态下也执行一次假哈希消耗时间：`return self._hashPassword(password, user.salt).then(function(){ return {ok:false, msg:'登录失败次数过多...'} })` |
| V-09 | 密码强度校验缺失 | auth.js:157-165 | 中 | 技术方案要求"密码 >= 6，建议字母+数字组合，给实时强度提示"。实现仅校验长度（6-20），未校验复杂度，未提供强度提示 UI。用户可使用 aaaaaa 等弱密码注册 | 攻击者利用弱密码字典进行暴力破解时命中率更高 | 增加 validatePassword 中的复杂度校验：`if(!/[a-zA-Z]/.test(pwd)||!/[0-9]/.test(pwd)) return {ok:false,msg:'密码须包含字母和数字'}` |
| V-10 | timingSafeEqual 长度泄露 | auth.js:107-117 | 中 | _timingSafeEqual 在长度不同时直接 return false，不执行异或循环。虽然 SHA-256 哈希长度固定（32 字节 -> 44 Base64 字符），实际影响极小，但实现不够严谨 | 理论上若哈希长度可变（如未来换算法），长度差异会泄露信息。当前实际风险低 | 长度不同时也执行异或操作，或先对两个串做固定长度 padding 再比较 |
| V-11 | CSP 缺少 frame-ancestors | index.html:6-7 | 中 | CSP 策略未配置 frame-ancestors，页面可被任意网站通过 iframe 嵌入。结合透明 iframe 可实施点击劫持（Clickjacking）攻击 | 攻击者创建恶意页面 -> 用透明 iframe 嵌入看板页面 -> 诱导用户点击 iframe 中的按钮（如"删除任务"）-> 用户不知情下操作了看板 | CSP 中增加 `frame-ancestors 'none'` 或 `frame-ancestors 'self'` |
| V-12 | 任务 ID 碰撞风险 | kanban.js:269-273 | 中 | _genId() 使用 Math.random().toString(16).slice(2,6) 生成 4 位 hex 后缀，仅 65536 种可能。批量创建任务时可能碰撞，导致 Storage.updateTask/deleteTask 操作错误记录 | 控制台批量创建：`for(let i=0;i<200;i++) Kanban.addTask('task'+i)` -> 可能产生重复 ID -> 后续删除/更新操作影响错误记录 | 改用 crypto.getRandomValues 生成随机后缀（8 字节 hex），与密码盐生成方式一致 |
| V-13 | Math.random 非密码学安全 | kanban.js:271 | 低 | _genId 使用 Math.random() 而非 crypto.getRandomValues。Math.random 不是密码学安全随机数生成器，输出可被预测 | 攻击者观察若干任务 ID -> 推断 Math.random 内部状态 -> 预测后续任务 ID -> 结合 V-05 进行 IDOR 攻击 | 统一使用 crypto.getRandomValues 生成所有随机值 |
| V-14 | 密码 maxlength 过严 | index.html:44 | 低 | 密码输入框 maxlength="20"，技术方案仅要求"密码 >= 6"未设上限。限制了长密码/密码短语的使用，反安全 | 用户无法使用超过 20 字符的安全密码短语 | 移除或增大 maxlength 至 128，同步调整 validatePassword 上限 |
| V-15 | 用户名 autocomplete 不规范 | index.html:30 | 低 | 用户名输入框 autocomplete="new-password"，这是密码字段的值。用户名字段应使用 autocomplete="username" | 浏览器密码管理器无法正确关联用户名与密码，影响自动填充体验 | 用户名输入框改为 autocomplete="username" |
| V-16 | 查询选择器拼接用户可控值 | kanban.js:77-78 | 低 | render() 中 '.col[data-status="' + task.status + '"]' 拼接 CSS 选择器。若 localStorage 被篡改注入非法 status 值（如含引号），可能破坏选择器解析 | 控制台执行：`Storage.get('tasks')[0].status='todo"] .task-list { } /*'` -> 刷新页面 -> 选择器解析异常，渲染可能出错 | 渲染前对 status 做白名单校验，或使用 data 属性 API（element.dataset.status）替代选择器拼接 |

### 漏洞严重度统计

| 严重度 | 数量 | 漏洞编号 |
| --- | --- | --- |
| 严重 | 3 | V-01（会话伪造）、V-02（账户接管）、V-03（哈希强度不足） |
| 高 | 3 | V-04（锁定绕过）、V-05（IDOR）、V-06（登出未清计数） |
| 中 | 6 | V-07 至 V-12 |
| 低 | 4 | V-13 至 V-16 |
| **合计** | **16** | |

---

## 详细攻击推演

> 贫僧不光说，还做给你看。以下每一条攻击向量都已推演验证，不是空口白话。

### 攻击推演 1：零密码冒充任意用户（V-01）

**目标**：在不知道 guangtouqiang 密码的情况下，以该用户身份登录。

**步骤**：
1. 打开看板页面（登录视图）
2. 按 F12 打开控制台
3. 执行以下命令：
```javascript
sessionStorage.setItem('sc:session', JSON.stringify({
  username: 'guangtouqiang',
  token: 'anything_i_want',
  loginAt: Date.now()
}));
```
4. 按 F5 刷新页面

**结果**：页面直接进入看板视图，显示 guangtouqiang 的全部任务。Auth.checkSession() 第 290-294 行仅检查 `session.username` 和 `session.token` 是否存在（非空），第 295-300 行检查 username 对应用户是否存在，但**全程不校验 token 值是否与登录时生成的一致**。token 字段只要不为空即可通过。

**根因**：auth.js 第 288-312 行 checkSession() 实现：
```javascript
checkSession: function () {
  var session = Storage.getSession();
  if (!session || !session.username || !session.token) {  // 仅检查存在性
    return null;
  }
  var user = Storage.findUser(session.username);  // 仅查用户存在
  if (!user) { ... return null; }
  // 没有：校验 session.token 与用户表中记录的 token 是否匹配
  return session.username;  // 直接放行
}
```

### 攻击推演 2：篡改密码哈希接管账户（V-02 + V-03）

**目标**：将 guangtouqiang 的密码改为攻击者已知的值，然后用新密码正常登录。

**步骤**：
1. 打开控制台
2. 生成攻击者已知密码的 salt + hash：
```javascript
var mySalt = Auth._generateSalt();
Auth._hashPassword('pwned123', mySalt).then(function(myHash) {
  Storage.updateUser('guangtouqiang', {
    salt: mySalt,
    passwordHash: myHash
  });
  console.log('账户已接管');
});
```
3. 在登录表单输入用户名 `guangtouqiang`，密码 `pwned123`
4. 点击登录

**结果**：登录成功，完全接管 guangtouqiang 账户。

**根因**：storage.js 第 119-136 行 updateUser() 对 patch 字段零过滤，接受任意字段覆写（包括 salt 和 passwordHash 这两个核心安全字段）。

### 攻击推演 3：绕过暴力破解锁定（V-04）

**目标**：在账户被锁定后，立即解除锁定继续暴力破解。

**步骤**：
1. 用错误密码对 guangtouqiang 登录 5 次，触发 60 秒锁定
2. 打开控制台执行：
```javascript
Storage.updateUser('guangtouqiang', { failCount: 0, lockUntil: 0 });
```
3. 立即继续用错误密码尝试登录

**结果**：锁定立即解除，可无限制继续暴力破解。锁定机制形同虚设。

**根因**：锁定状态（failCount/lockUntil）存储在可篡改的 localStorage 中，且 Storage.updateUser 无权限校验。

### 攻击推演 4：跨用户任务篡改/删除（V-05）

**目标**：以 userA 身份登录后，删除或篡改 userB 的任务。

**步骤**：
1. 以 userA 身份正常登录
2. 打开控制台执行：
```javascript
// 读取所有任务（含其他用户的）
var allTasks = Storage.get('tasks');
console.log(allTasks);  // 看到 userB 的任务

// 篡改 userB 的任务标题
Kanban.updateTaskTitle(allTasks[0].id, '已被黑客篡改');

// 或直接删除 userB 的任务
Kanban.deleteTask(allTasks[0].id);
```

**结果**：userB 的任务被篡改或删除。Kanban.deleteTask 和 updateTaskTitle 虽然检查了 Auth.currentUser() 非空，但传入的 task id 不做归属校验，直接调 Storage 层操作。

**根因**：kanban.js 第 200-213 行 deleteTask 和第 221-242 行 updateTaskTitle，在获取到 id 后直接调 `Storage.deleteTask(id)` / `Storage.updateTask(id, patch)`，不校验该 id 对应任务的 owner 是否等于当前用户。

### 攻击推演 5：XSS 注入任务标题（验证防护有效性）

**目标**：在任务标题中注入恶意脚本，验证 textContent 防护是否到位。

**步骤**：
1. 以任意用户登录
2. 在任务输入框输入：`<script>alert('xss')</script>`
3. 点击新增
4. 在另一任务输入：`<img src=x onerror=alert(1)>`
5. 点击新增
6. 内联编辑某任务，改为：`<svg onload=alert(document.cookie)>`

**结果**：三种 payload 均以纯文本显示在任务卡片中，无弹窗，无脚本执行。textContent 赋值（kanban.js 第 291 行 `titleSpan.textContent = task.title`）确保用户输入不被解析为 HTML。

**结论**：XSS 防护到位，此攻击向量被有效阻断。

### 攻击推演 6：离线密码暴力破解（V-03）

**目标**：获取用户密码明文。

**步骤**：
1. 打开控制台执行 `JSON.parse(localStorage.getItem('sc:users'))`
2. 获得全部用户的 `{username, salt, passwordHash}`
3. 将数据导出到本地
4. 使用 hashcat 进行离线暴力破解：
```bash
# hashcat 模式 1420 = SHA-256(salt || password)
hashcat -m 1420 hashes.txt wordlist.txt
```

**结果**：由于使用单次 SHA-256 无迭代，现代 GPU（如 RTX 4090）每秒可计算约 22 亿次 SHA-256。即使有盐值保护，常见密码（abc123、password、123456 等）在秒级内被破解。

**对比**：若使用 PBKDF2-HMAC-SHA256（100,000 次迭代），同样硬件每秒仅能尝试约 22,000 次，速度降低 10 万倍。

### 攻击推演 7：点击劫持（V-11）

**目标**：诱导用户在不知情下操作看板。

**步骤**：
1. 攻击者创建恶意网页 evil.com
2. 在页面中放置透明 iframe 指向看板页面
3. 将 iframe 叠加在诱饵按钮上（如"免费领金币"）
4. 用户点击"免费领金币"时，实际点击了看板的"删除任务"按钮

**结果**：用户在不知情下删除了自己的任务。CSP 未配置 frame-ancestors，无法阻止被嵌入。

---

## 攻击面分析

### 攻击面 1：Storage 全局对象暴露（架构级风险）

Storage 作为全局 `window.Storage` 对象暴露，其所有方法（getUsers、findUser、saveUser、updateUser、deleteTask、updateTask 等）均无权限校验。任何在页面上下文中执行的 JS 代码（包括控制台、注入的脚本、浏览器扩展）均可直接调用，等同于将数据库的完全读写权限暴露给前端。

这是整个安全架构的根本缺陷——分层设计将"碰 localStorage 的权限"收拢到 storage.js，但 storage.js 本身将全部能力无差别暴露为全局 API，形成"门锁了但钥匙挂在门上"的局面。

**影响范围**：V-01、V-02、V-04、V-05 均依赖此攻击面。

**根本原因**：纯前端架构无服务端权限边界，所有"权限校验"都在客户端执行，可被绕过。

### 攻击面 2：localStorage 数据无完整性保护

所有安全关键数据（用户表、任务表、会话、锁定状态）均以明文 JSON 存储在 localStorage 中，无签名、无加密、无完整性校验。攻击者可：
- 直接读取全部用户数据（含密码哈希）
- 篡改任意用户密码哈希
- 清除锁定状态
- 伪造会话
- 篡改/删除任意任务

### 攻击面 3：会话验证缺失

会话机制存在"有 token 不校验"的设计缺陷。token 的生成是密码学安全的（crypto.getRandomValues 32 字节），但 checkSession 完全不使用 token 进行验证。这使得 token 沦为装饰品，会话安全性退化为"只要知道用户名就能登录"。

### 攻击面 4：密码学方案降级

技术方案 spec.md 明确指出应使用 PBKDF2-HMAC-SHA256（>=100,000 次迭代），并预留了升级接口（_hashPassword 独立方法）。但实现降级为单次 SHA-256+salt，仅满足"密码不明文"的最低基线，离线暴力破解防护极弱。

### 攻击面 5：跨用户数据隔离不足

任务按 owner 字段过滤实现隔离，但：
- Storage.get('tasks') 可读取全量任务（无 owner 过滤）
- Kanban.deleteTask/updateTaskTitle 不校验 task 归属
- localStorage 中所有用户任务混存于同一数组

隔离仅在渲染层生效，存储层和业务层均无强制隔离。

### 攻击面汇总图

```
┌─────────────────────────────────────────────────────────────┐
│                     攻击面拓扑图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [攻击面1] Storage 全局暴露                                 │
│     │                                                       │
│     ├──> V-02 篡改密码哈希 -> 账户接管                      │
│     ├──> V-04 清除锁定状态 -> 无限暴力破解                  │
│     └──> V-05 跨用户任务操作 -> IDOR                        │
│                                                             │
│  [攻击面2] localStorage 无完整性                             │
│     │                                                       │
│     ├──> V-01 伪造会话 -> 冒充任意用户                       │
│     ├──> V-03 读取哈希 -> 离线暴力破解                      │
│     └──> V-16 篡改 status -> 渲染异常                       │
│                                                             │
│  [攻击面3] 会话验证缺失                                     │
│     │                                                       │
│     └──> V-01 token 不校验 -> 零密码登录                    │
│                                                             │
│  [攻击面4] 密码学降级                                       │
│     │                                                       │
│     └──> V-03 单次SHA-256 -> 秒级破解                       │
│                                                             │
│  [攻击面5] 数据隔离不足                                     │
│     │                                                       │
│     ├──> V-05 不校验owner -> 跨用户操作                     │
│     └──> V-12 ID碰撞 -> 数据错乱                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 已有效防护的攻击面

以下攻击已被现有安全机制有效阻断，审查确认通过：

1. **DOM 型 XSS**：全项目零 innerHTML 调用，统一 textContent + createElement，CSP 兜底。任务标题注入 `<script>`、`<img onerror>`、`<svg onload>` 等 payload 均被阻断。
2. **供应链攻击**：零第三方依赖，无 CDN 脚本引入，无 SRI 缺失风险。
3. **凭证硬编码**：代码中无 API Key、数据库连接串、JWT Secret 等硬编码凭证。
4. **敏感日志泄露**：零 console.log 调用，异常 catch 后不泄露堆栈信息。
5. **eval/代码注入**：无 eval、new Function、document.write、setTimeout(string) 等动态代码执行。

---

## 与测试报告（蹦蹦）的交叉验证

| 测试报告发现 | 铁掌审查确认 | 铁掌补充 |
 | --- | --- | --- |
 | BUG-001 登出未清失败计数（P1） | 确认，升为 V-06 | 与方案声明不符，属设计违背 |
 | BUG-007 token 未校验（P1） | 确认，升为 V-01 严重 | 蹦蹦标 P1 偏低，此漏洞允许零密码冒充任意用户，应为严重 |
 | BUG-002 ID 碰撞（P2） | 确认，标为 V-12 | 补充：Math.random 非密码学安全，可被预测（V-13） |
 | BUG-004 注册竞态（P2） | 确认 | 纯前端单线程环境下竞态实际不触发，但 saveUser 二次检查返回的错误信息不准确 |
 | BUG-006 锁定计时侧信道（P2） | 确认，标为 V-08 | 补充攻击推演 |
 | BUG-008 密码强度缺失（P2） | 确认，标为 V-09 | 与方案"建议字母+数字组合"声明不符 |
 | BUG-012 注册枚举（P2） | 确认，标为 V-07 | 与登录防枚举设计不一致 |
 | BUG-003 lockUntil 残留（P3） | 确认 | 低优先级 |
 | BUG-005 拖拽高亮残留（P3） | 确认 | 纯 UI 问题，不影响安全 |
 | BUG-009 maxlength 过严（P3） | 确认，标为 V-14 | 反安全设计 |
 | BUG-010 选择器拼接（P3） | 确认，标为 V-16 | 低风险但应白名单校验 |
 | BUG-011 autocomplete（P3） | 确认，标为 V-15 | 体验问题 |
 | BUG-013 blur 双触发（P3） | 确认 | done 标志防护到位，脆弱但不影响安全 |
 | **蹦蹦未发现** | **铁掌新增** | |
 | - | V-02 账户接管（严重） | 蹦蹦未发现 Storage.updateUser 无权限校验导致可篡改密码哈希 |
 | - | V-03 哈希强度不足（严重） | 蹦蹦未发现单次 SHA-256 无迭代可被快速离线破解 |
 | - | V-04 锁定绕过（高） | 蹦蹦未发现直接修改 localStorage 可绕过锁定 |
 | - | V-05 IDOR（高） | 蹦蹦未发现 deleteTask/updateTaskTitle 不校验任务归属 |
 | - | V-10 timingSafeEqual（中） | 蹦蹦未发现长度差异时的计时泄露 |
 | - | V-11 CSP frame-ancestors（中） | 蹦蹦未发现缺少点击劫持防护 |

> 又犯同样的错！蹦蹦只测了功能边界，没主动构造攻击链！漏了 6 个漏洞，其中 2 个严重级别！

---

## 审查结论

### 结论：驳回重跑

> 安全无小事，驳回，不可放行！

### 驳回理由

本审查在第 1 轮即发现 **3 个严重漏洞**、**3 个高危漏洞**，共 16 个安全问题。其中 3 个严重漏洞可构成完整攻击链：

```
V-01 伪造会话（零密码登录）
  或
V-02 篡改密码哈希（账户接管）
  ──> V-04 绕过暴力破解锁定（清除计数）
  ──> V-03 离线暴力破解（单次SHA-256，秒级破解）
  ──> 完全接管任意用户账户
  ──> V-05 跨用户篡改/删除任务
```

攻击者无需任何密码即可冒充任意用户登录（V-01），或直接篡改用户密码哈希接管账户（V-02）。暴力破解锁定机制可被一行控制台命令绕过（V-04）。密码哈希强度不足以抵抗离线攻击（V-03）。这些漏洞组合后，系统的认证安全体系完全失效。

### 必须修复项（方可进入第 2 轮审查）

以下为 **驳回重跑的硬性前置条件**，修复后方可进入第 2 轮：

| 优先级 | 漏洞 | 修复方向 |
| --- | --- | --- |
| P0 必修 | V-01 会话 token 不校验 | 用户表存 token 哈希，checkSession 时常量时间比对 |
| P0 必修 | V-02 updateUser 无权限保护 | 敏感字段（salt/passwordHash）写保护，或引入校验机制 |
| P0 必修 | V-03 哈希强度不足 | 替换为 PBKDF2-HMAC-SHA256（>=100,000 次迭代） |
| P0 必修 | V-05 IDOR 不校验归属 | deleteTask/updateTaskTitle 内部校验 task.owner === currentUser |
| P1 必修 | V-04 锁定绕过 | 文档明确标注纯前端局限 + 配合 V-03 修复使离线破解成本极高 |
| P1 必修 | V-06 登出未清计数 | logout 中增加 failCount/lockUntil 重置 |
| P1 必修 | V-11 CSP frame-ancestors | CSP 增加 `frame-ancestors 'none'` |

### 建议修复项（不阻塞重跑，但应在第 2 轮前完成）

| 优先级 | 漏洞 | 修复方向 |
| --- | --- | --- |
| P2 建议 | V-07 注册枚举 | 注册成功自动登录，或统一错误信息 |
| P2 建议 | V-08 锁定计时侧信道 | 锁定状态也执行假哈希 |
| P2 建议 | V-09 密码强度校验 | 增加字母+数字复杂度校验 |
| P2 建议 | V-10 timingSafeEqual | 长度不同时也执行异或 |
| P2 建议 | V-12 ID 碰撞 | 改用 crypto.getRandomValues |
| P3 建议 | V-13 至 V-16 | 低优先级改进 |

### 架构安全建议（长期）

1. **引入后端服务**：纯前端架构的根因问题是所有安全校验在客户端执行，可被完全绕过。长期应引入后端服务，将认证、授权、数据存储移至服务端，前端仅负责展示。
2. **localStorage 数据签名**：在无法引入后端时，对 localStorage 关键数据做 HMAC 签名（密钥不存前端，可基于设备指纹 + 用户密码派生），检测篡改。
3. **密码哈希升级路径**：spec 已预留 _hashPassword 升级接口，应尽快落地 PBKDF2，不要停留在"最低基线"。
4. **Storage API 权限收敛**：将 Storage 全局对象改为不暴露敏感方法（updateUser/saveUser），或增加内部调用栈校验（非防绕过方案，但增加门槛）。

---

> 贫僧看看…这个项目 XSS 防护做得不错，零 innerHTML、CSP 兜底，这块可以过。但是！认证授权这块全是窟窿——token 不校验、密码哈希可被篡改、暴力破解锁定一行代码就绕过。又犯同样的错！密码哈希方案你自己 spec 里写了要上 PBKDF2，结果落地还是单次 SHA-256，这是糊弄谁呢？
>
> 3 个严重、3 个高危，攻击链一串到底，零密码就能接管任意账户。安全无小事，驳回，不可放行！
>
> 把 V-01 到 V-06 全修了，V-11 也顺手补上，再来找贫僧过第 2 轮。重写！全部重写！
>
> —— 铁掌大师，2026-08-19
