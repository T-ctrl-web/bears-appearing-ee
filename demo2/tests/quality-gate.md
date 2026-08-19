# 质量门禁报告

> 审查人：小狸（狐狸，熊出没集团质量门禁官）
> 审查日期：2026-08-19
> 审查对象：熊出没集团安全登录看板（secure-kanban）
> 审查范围：spec.md + index.html + 4 个 JS 模块 + style.css + test.md + design-review.md + security-review.md + visual-review.md + README.md（全部交付物）
> 口头禅："想蒙混过关？没门！" "不达标？打回去！"

---

## 门禁检查

| # | 检查项 | 结果 | 备注 |
| --- | --- | --- | --- |
| 1 | 需求覆盖 | **通过** | 登录（auth.js login）、注册（auth.js register）、看板三列（index.html todo/doing/done）、拖拽（kanban.js \_bindColumnDnD）、删除（kanban.js deleteTask）、数据存储（storage.js 封装 localStorage/sessionStorage）——6 项需求全部有对应实现 |
| 2 | 测试充分性 | **有条件通过** | 测试报告含 69 条用例覆盖功能/校验/安全/边界/性能五大维度，数量充分。但 SEC-007（"密码哈希使用 SHA-256"）和 SEC-017（"token 不校验有效性-已知缺陷"）两条用例已过时：代码已升级为 PBKDF2 且已修复 token 校验，这两条用例预期结果与当前代码矛盾，需更新 |
| 3 | 已知问题 | **部分通过** | 2 个 P1 Bug（BUG-001 登出未清计数、BUG-007 token 未校验）均已修复。但 13 项 Bug 中仍有 6 项未修复（详见下方修复验证），含 1 项 P2 安全问题（BUG-012 注册枚举）和 5 项 P3 低优先级问题 |
| 4 | 文档完整性 | **不通过** | 交付物齐全（spec/README/test/三份审查报告/index.html/CSS/4 个 JS），但文档与代码不一致：spec.md 第 60 行和 README.md 第 229 行均声明密码哈希采用"SHA-256 + 盐"，实际代码（auth.js 第 90-114 行）已升级为 PBKDF2-HMAC-SHA256（100,000 次迭代）。spec.md 接口定义章节仍未纳入 App 模块（设计审查问题 #6 未修复）。测试报告 SEC-007/SEC-017 预期结果已过时 |
| 5 | 代码质量 | **有条件通过** | 代码语法全部通过（node --check 4 个文件均无错误）；架构纪律良好（零 innerHTML 调用、零 console 输出、auth/kanban/app 三模块均不直接碰 localStorage，全走 Storage）；安全审查 P0/P1 必修项全部修复。但设计审查 7 项必修中 3 项未修复（#1 N+1 性能瓶颈、#5 注册枚举、#6 App 接口未入 spec），其中 #1 为"严重"级别 |
| 6 | 集成检查 | **通过** | 脚本加载顺序 storage→auth→kanban→app 正确；模块间接口对接正确：App.init() 调 Auth.checkSession()（已改为 Promise.then 异步处理）；App 登录成功调 Kanban.init()；Kanban 调 Auth.currentUser() 和 Storage.getTasks()；Auth 调 Storage 读写用户/会话。全局对象 Storage/Auth/Kanban/App 均正确暴露 |
| 7 | 交付物清单 | **通过** | 交付物齐全：index.html（3.4KB）、css/style.css（6.5KB）、js/storage.js（9.4KB）、js/auth.js（14.4KB）、js/kanban.js（15.8KB）、js/app.js（6.5KB）、tests/test.md、tests/design-review.md、tests/security-review.md、tests/visual-review.md、README.md、spec.md、ui-spec.md、research.md、PROJECT.txt |
| 8 | 回退方案 | **不通过** | 无明确的回退/降级方案文档。代码层面有零散兜底：Storage.set() 配额满返回 false、sessionStorage 不可用时降级到 localStorage、JSON 解析失败返回 null。但无系统性的降级策略文档：Web Crypto API 不可用时如何降级？数据结构升级时如何迁移？localStorage 被清空时如何恢复？这些场景未在 spec 或 README 中说明 |

---

## 修复验证

### 一、萝卜头 13 项 Bug 修复逐项核对

以下逐项核对测试报告（test.md）中 BUG-001 至 BUG-013 的修复情况，对照代码实际实现。

| Bug # | 描述 | 级别 | 修复状态 | 核对依据 |
| --- | --- | --- | --- | --- |
| BUG-001 | 登出未清除失败计数 | P1 | **已修复** | auth.js `logout()`（第 352-359 行）增加 `var user = this.currentUser(); if (user) { this._secureUpdateUser(user, { failCount: 0, lockUntil: 0 }); }`，通过授权通道重置 failCount 和 lockUntil，再调 `Storage.clearSession()`。注释标记 V-06/BUG-001 |
| BUG-002 | 任务 ID 碰撞风险 | P2 | **已修复** | kanban.js `_genId()`（第 299-309 行）改用 `crypto.getRandomValues(new Uint8Array(4))` 生成 4 字节随机数转 8 位 hex 后缀（约 42 亿种可能），替代原 `Math.random().toString(16).slice(2,6)`（仅 65536 种）。注释标记 BUG-002 |
| BUG-003 | 锁定后 lockUntil 残留 | P3 | **已修复** | auth.js `login()`（第 301-305 行）增加过期锁定清理逻辑：`if (user.lockUntil && user.lockUntil <= now) { self._secureUpdateUser(username, { lockUntil: 0, failCount: 0 }); user.lockUntil = 0; user.failCount = 0; }`。注释标记 BUG-003 |
| BUG-004 | 注册并发竞态错误信息 | P2 | **已修复** | auth.js `register()`（第 253-259 行）saveUser 返回 false 时增加二次检查：`if (Storage.findUser(username)) { return { ok: false, msg: '用户名已被注册' }; }`，区分"用户名重复"和"其他失败"。注释标记 BUG-004 |
| BUG-005 | 拖拽高亮残留 | P3 | **未修复** | kanban.js `_bindColumnDnD()`（第 464-468 行）dragleave 仍使用 `if (e.target === col)` 判断。修复建议为使用 dragenter/dragleave 计数器，但代码未改。从子元素移出列边界时高亮不会移除 |
| BUG-006 | 锁定用户计时侧信道 | P2 | **已修复** | auth.js `login()`（第 292-298 行）锁定路径改为先执行哈希再返回：`return self._hashPassword(password, user.salt).then(function () { return { ok: false, msg: '登录失败次数过多...' }; })`。注释标记 BUG-006 / V-04 |
| BUG-007 | 会话 token 未校验有效性 | P1 | **已修复** | auth.js 新增 `_hashToken()` 方法（第 144-150 行），login 成功时计算 token 哈希存入用户表 `sessionTokenHash`（第 328-330 行），checkSession 校验 `session.token` 哈希与用户表 `sessionTokenHash` 匹配（第 394-401 行），不匹配则清会话返回 null。注释标记 V-01 |
| BUG-008 | 密码强度校验缺失 | P2 | **已修复** | auth.js `validatePassword()`（第 205-217 行）增加复杂度校验：`if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) return { ok: false, msg: '密码须同时包含字母和数字' }`。注释标记 BUG-008 |
| BUG-009 | 密码 maxlength 过严 | P3 | **未修复** | index.html 第 44 行密码输入框仍为 `maxlength="20"`。修复建议移除或增大至 128，未改动。auth.js `validatePassword()` 仍校验 `pwd.length > 20` |
| BUG-010 | 查询选择器拼接用户可控值 | P3 | **未修复** | kanban.js `render()`（第 77-78 行）仍使用 `'.col[data-status="' + task.status + '"] .task-list'` 拼接选择器。修复建议为渲染前做 status 白名单校验，未改动 |
| BUG-011 | 用户名 autocomplete 值不规范 | P3 | **未修复** | index.html 第 30 行用户名输入框仍为 `autocomplete="new-password"`。修复建议改为 `autocomplete="username"`，未改动 |
| BUG-012 | 注册接口可做账号枚举 | P2 | **未修复** | auth.js `register()`（第 238 行）仍返回 `{ ok: false, msg: '用户名已被注册' }`。修复建议为注册成功自动登录或统一返回"注册失败"，未改动。安全审查 V-07 同样未修复 |
| BUG-013 | 内联编辑 blur 与 Enter 双触发 | P3 | **未修复** | kanban.js `_startEdit()`（第 397-421 行）仍使用 `done` 布尔标志防重复，未按修复建议在 save/cancel 中先移除事件监听器再操作。代码注释自评"逻辑正确但脆弱"，实现未变 |

**修复统计：13 项中 7 项已修复，6 项未修复。**

| 级别 | 总数 | 已修复 | 未修复 |
| --- | --- | --- | --- |
| P1（高） | 2 | 2 | 0 |
| P2（中） | 5 | 4 | 1（BUG-012 注册枚举） |
| P3（低） | 6 | 1 | 5（BUG-005/009/010/011/013） |
| **合计** | **13** | **7** | **6** |

---

### 二、安全审查 3 个严重漏洞（V-01/V-02/V-03）修复验证

| 漏洞 # | 描述 | 严重度 | 修复状态 | 核对依据 |
| --- | --- | --- | --- | --- |
| V-01 | 认证绕过/会话伪造：checkSession 不校验 token | 严重 | **已修复** | **三处改动联动**：(1) auth.js 新增 `_hashToken()`（第 144-150 行）对 token 做 SHA-256 哈希；(2) `login()` 成功时调 `_hashToken(token)` 生成 token 哈希，通过 `_secureUpdateUser` 存入用户表 `sessionTokenHash` 字段（第 327-330 行）；(3) `checkSession()` 取 session.token 后调 `_hashToken()` 重新哈希，用 `_timingSafeEqual` 与用户表 `sessionTokenHash` 比对（第 394-401 行），不匹配则清会话返回 null。攻击者伪造 `{username, token:'fake'}` 无法通过校验。**攻击推演 1 已被阻断** |
| V-02 | 越权写/账户接管：Storage.updateUser 无权限校验 | 严重 | **已修复** | **写保护机制**：(1) storage.js 定义 `SENSITIVE_FIELDS` 集合（salt/passwordHash/sessionTokenHash/failCount/lockUntil，第 20-26 行）；(2) `updateUser()` 未授权时检查 patch 是否含敏感字段，有则直接返回 false（第 143-149 行）；(3) 新增 `_setAuthorized(v)` 授权开关（第 130-132 行）；(4) auth.js 新增 `_secureUpdateUser()` 包装方法（第 170-175 行）：调用前 `_setAuthorized(true)`，调用后立即 `_setAuthorized(false)`。控制台直接调 `Storage.updateUser('xxx', {passwordHash:'...'})` 将被拒绝。**攻击推演 2 已被阻断**。注：纯前端无法完全阻止控制台绕过（可手动调 `_setAuthorized(true)`），但已大幅提高门槛 |
| V-03 | 密码学强度不足：单次 SHA-256 无迭代 | 严重 | **已修复** | auth.js `_hashPassword()`（第 90-114 行）已从单次 `crypto.subtle.digest('SHA-256', data)` 替换为 PBKDF2：通过 `crypto.subtle.importKey('raw', pwd, {name:'PBKDF2'}, false, ['deriveBits'])` 导入密码，再 `crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, key, 256)` 派生 256 位密钥。`PBKDF2_ITERATIONS = 100000`（第 28 行）。离线暴力破解成本提高 10 万倍。**攻击推演 6 已被缓解** |

**严重漏洞修复统计：3/3 全部修复。**

---

### 三、其他安全审查漏洞修复情况（补充核对）

| 漏洞 # | 描述 | 严重度 | 修复状态 | 备注 |
| --- | --- | --- | --- | --- |
| V-04 | 暴力破解锁定绕过 | 高 | **已缓解** | 纯前端无法完全防 localStorage 篡改，但 V-03（PBKDF2）修复后即使绕过锁定，离线破解成本也极高 |
| V-05 | IDOR/越权操作 | 高 | **已修复** | kanban.js `deleteTask()`（第 208-218 行）和 `updateTaskTitle()`（第 247-258 行）均增加 owner 归属校验：先 `Storage.getTasks(user)` 取当前用户任务，校验 id 属于当前用户后再操作 |
| V-06 | 登出未清失败计数 | 高 | **已修复** | 同 BUG-001，logout() 通过 \_secureUpdateUser 重置 failCount/lockUntil |
| V-07 | 注册接口账号枚举 | 中 | **未修复** | 同 BUG-012，register() 仍返回"用户名已被注册" |
| V-08 | 锁定计时侧信道 | 中 | **已修复** | 同 BUG-006，锁定路径执行假哈希 |
| V-09 | 密码强度校验缺失 | 中 | **已修复** | 同 BUG-008，validatePassword 增加复杂度校验 |
| V-10 | timingSafeEqual 长度泄露 | 中 | **已修复** | auth.js `_timingSafeEqual()`（第 124-135 行）改为取 `Math.min(ba.length, bb.length)` 遍历，长度差异 `ba.length ^ bb.length` 纳入 diff 结果 |
| V-11 | CSP 缺少 frame-ancestors | 中 | **已修复** | index.html 第 7 行 CSP 增加 `frame-ancestors 'none'` |
| V-12 | 任务 ID 碰撞风险 | 中 | **已修复** | 同 BUG-002，\_genId 改用 crypto.getRandomValues |
| V-13 | Math.random 非密码学安全 | 低 | **已修复** | 同 BUG-002 |
| V-14 | 密码 maxlength 过严 | 低 | **未修复** | 同 BUG-009 |
| V-15 | autocomplete 不规范 | 低 | **未修复** | 同 BUG-011 |
| V-16 | 查询选择器拼接 | 低 | **未修复** | 同 BUG-010 |

**安全审查总计：16 项中 12 项已修复/缓解，4 项未修复（V-07/V-14/V-15/V-16，均为中/低级别）。**

其中安全审查"必须修复项"（P0/P1）7 项全部完成：V-01/V-02/V-03/V-05（P0 必修）、V-04/V-06/V-11（P1 必修）。

---

### 四、代码语法检查

| 文件 | node --check 结果 |
| --- | --- |
| js/storage.js | **通过**（无语法错误） |
| js/auth.js | **通过**（无语法错误） |
| js/kanban.js | **通过**（无语法错误） |
| js/app.js | **通过**（无语法错误） |

### 五、架构纪律核查

| 检查项 | 结果 |
| --- | --- |
| innerHTML 调用 | **零调用**（全项目仅注释中提及"不用 innerHTML"） |
| 直接 localStorage 访问（auth/kanban/app 三模块） | **零调用**（全部通过 Storage 模块访问） |
| console 输出 | **零调用**（无敏感信息泄露） |
| 脚本加载顺序 | storage → auth → kanban → app（正确，保证依赖就绪） |

---

## 门禁结论

### 结论：不予放行

> 想蒙混过关？没门！不达标？打回去！

### 驳回理由

门禁 8 项检查中，3 项通过、3 项有条件通过、2 项不通过。核心安全要求（3 个严重漏洞 + P0/P1 必修项）已全部修复，代码语法正确，架构纪律良好。但以下问题构成放行阻断条件：

**阻断项 1：文档与代码不一致（门禁第 4 项不通过）**

spec.md 第 60 行和 README.md 第 229 行均声明密码哈希采用"SHA-256 + 盐"，但 auth.js 实际已升级为 PBKDF2-HMAC-SHA256（100,000 次迭代）。代码改了，文档没跟着改。这不是小问题——开发者照着 spec 写代码会写出与现有系统不兼容的实现，测试人员照着 test.md SEC-007 执行测试会得到"不通过"的假阴性结果。文档是质量基线，文档与代码脱节就是不合格。

**阻断项 2：缺少回退/降级方案（门禁第 8 项不通过）**

无系统性的降级策略文档。Web Crypto API 不可用（如 Firefox file:// 协议）时如何降级？localStorage 配额满时用户如何获知？数据结构升级时旧数据如何迁移？这些场景未在任何文档中说明。代码有零散的 try-catch 兜底，但不成体系。

**阻断项 3：设计审查"严重"问题未修复**

设计审查报告（design-review.md）问题 #1（moveTask N+1 全量读写，严重级别）未修复。kanban.js `moveTask()` 仍对列内每个任务循环调用 `Storage.updateTask(id, patch)`，每次全量读写 tasks 数组。拖拽含 50 个任务的列时产生 50 次全量序列化/反序列化。设计审查明确将此项列为"严重"且为"必须在本轮完成的"第 1 优先修复项。

**阻断项 4：6 项 Bug 修复未完成**

13 项 Bug 中 6 项未修复，包括 1 项 P2 安全问题（BUG-012 注册接口账号枚举，与安全审查 V-07 同源）和 5 项 P3 问题。虽 P3 不单独构成阻断，但 BUG-012（P2）和安全审查 V-07 均指向同一安全问题：注册接口暴露用户存在性，与登录防枚举设计不一致。

**阻断项 5：测试报告用例过时**

test.md 中 SEC-007（"密码哈希使用 SHA-256"）和 SEC-017（"token 不校验有效性-已知缺陷"）预期结果与当前代码矛盾。SEC-007 预期"passwordHash 与 SHA-256(salt||password) 一致"，但代码已改用 PBKDF2，该测试会失败。SEC-017 预期"伪造会话可进入看板"并标注为"已知缺陷"，但 V-01 已修复 token 校验，伪造会话现在会被拒绝。测试报告需同步更新。

### 放行前置条件

修复以下 5 项后方可放行交付：

| 优先级 | 修复项 | 对应阻断项 |
| --- | --- | --- |
| P0 必修 | 更新 spec.md 和 README.md 密码哈希描述：将"SHA-256 + 盐"改为"PBKDF2-HMAC-SHA256（100,000 次迭代）+ 盐"，同步更新关键代码骨架和流程描述 | 阻断项 1 |
| P0 必修 | 更新 test.md：SEC-007 预期改为"passwordHash 与 PBKDF2(salt, password, 100000) 一致"；SEC-017 预期改为"伪造会话被拒绝，checkSession 校验 token 哈希" | 阻断项 5 |
| P1 必修 | 编写回退/降级方案：Web Crypto API 不可用时的降级策略、localStorage 配额满时的用户提示、数据结构版本号与迁移预案；补入 spec.md 或 README.md | 阻断项 2 |
| P1 必修 | 修复 BUG-012/V-07：注册接口防枚举——注册成功后自动登录，或统一返回"注册失败"不区分原因 | 阻断项 4 |
| P2 建议 | 修复设计审查问题 #1：Storage 新增 `updateTasksBatch(updates)` 批量更新方法，moveTask 改为先在内存算好所有 patch 再一次性提交，消除 N+1 读写 | 阻断项 3 |

### 已通过项确认

以下核心要求已达标，确认通过：

- 3 个严重安全漏洞（V-01/V-02/V-03）全部修复，攻击链已阻断
- 安全审查 P0/P1 必修项 7 项全部完成
- 2 个 P1 Bug（BUG-001/BUG-007）全部修复
- 代码语法全部通过（4 个 JS 文件 node --check 无错误）
- 架构纪律良好（零 innerHTML、零 console 输出、三模块不越权碰 localStorage）
- 需求覆盖完整（登录/注册/三列/拖拽/删除/存储 6 项需求全部实现）
- 交付物清单齐全（14 个文件全部到位）
- 模块间接口对接正确（加载顺序、全局对象暴露、调用链均无误）

---

> 萝卜头的安全修复做得不错——3 个严重漏洞全堵住了，P1 Bug 也修了，架构纪律严丝合缝。但是！文档跟代码对不上、回退方案没有、设计审查的严重性能问题没修、注册枚举还在漏——想蒙混过关？没门！回去把这 5 条焊死再来见小狸。
>
> 不达标？打回去！
>
> —— 小狸，2026-08-19
