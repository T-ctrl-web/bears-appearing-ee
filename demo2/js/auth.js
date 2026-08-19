/**
 * auth.js — 认证层
 *
 * 登录、注册、登出、会话判断全归它。
 * 调用 storage.js 读写用户表与会话，调用浏览器 Web Crypto API 做密码加盐哈希与比对。
 * 所有"现在是谁、登没登录"的判断都从这儿出。
 *
 * 依赖：Storage（存储层）
 * 暴露：全局对象 Auth
 *
 * 安全要点：
 * - 密码绝不明文落盘，注册即 SHA-256(salt || password)，只存 salt 与 passwordHash
 * - 每用户独立 16 字节随机盐，防彩虹表预计算
 * - 哈希比对用常量时间比较，防计时侧信道
 * - 登录失败统一回"用户名或密码错误"，防账号枚举
 * - 同用户名失败 5 次锁 60 秒
 * - 会话只存随机 token + 用户名指针，不存密码/哈希
 */
(function (global) {
  'use strict';

  // 防暴力破解参数
  var MAX_FAIL = 5;           // 连续失败 5 次
  var LOCK_DURATION = 60 * 1000; // 锁定 60 秒
  // 记住我会话 7 天过期
  var REMEMBER_DURATION = 7 * 24 * 60 * 60 * 1000;
  // V-03：PBKDF2 迭代次数（>=100,000），大幅提高离线暴力破解成本
  var PBKDF2_ITERATIONS = 100000;

  // ========== Base64 辅助 ==========

  /**
   * Uint8Array → Base64 字符串
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function toBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Base64 字符串 → Uint8Array
   * @param {string} b64
   * @returns {Uint8Array}
   */
  function fromBase64(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // ========== 统一返回结构 ==========

  /**
   * @typedef {Object} Result
   * @property {boolean} ok
     * @property {string} [msg]
   */

  var Auth = {
    // ========== 密码哈希（内部方法）==========

    /**
     * 生成 16 字节随机盐，Base64 编码。
     * 用 crypto.getRandomValues（密码学安全随机数）。
     * @param {number} [len=16] - 盐字节数
     * @returns {string} Base64 编码的盐
     */
    _generateSalt: function (len) {
      len = len || 16;
      var arr = new Uint8Array(len);
      crypto.getRandomValues(arr);
      return toBase64(arr);
    },

    /**
     * V-03：PBKDF2-HMAC-SHA256(password, salt, iterations)，Base64 编码。
     * 替代原单次 SHA-256，迭代 100,000 次使离线暴力破解成本提高 10 万倍。
     * @param {string} password - 原始密码
     * @param {string} saltB64 - Base64 编码的盐
     * @returns {Promise<string>} Base64 编码的派生密钥（256 bit = 32 字节）
     */
    _hashPassword: function (password, saltB64) {
      var salt = fromBase64(saltB64);
      var enc = new TextEncoder();
      var pwd = enc.encode(password);
      // 用密码作为主密钥素材，导入 PBKDF2 密钥对象
      return crypto.subtle.importKey(
        'raw',
        pwd,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      ).then(function (key) {
        return crypto.subtle.deriveBits(
          {
            name: 'PBKDF2',
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
          },
          key,
          256 // 输出 256 位 = 32 字节
        );
      }).then(function (bits) {
        return toBase64(new Uint8Array(bits));
      });
    },

    /**
     * 常量时间比对两个字符串，防计时侧信道。
     * V-10 修复：长度不同时也执行异或循环（对较短串遍历），避免长度差异泄露信息。
     * @param {string} a
     * @param {string} b
     * @returns {boolean}
     */
    _timingSafeEqual: function (a, b) {
      var enc = new TextEncoder();
      var ba = enc.encode(a);
      var bb = enc.encode(b);
      // 取较短长度遍历，保证一定执行循环（非常量但避免提前返回的时间差）
      var minLen = Math.min(ba.length, bb.length);
      var diff = ba.length ^ bb.length; // 长度差异也纳入结果
      for (var i = 0; i < minLen; i++) {
        diff |= ba[i] ^ bb[i];
      }
      return diff === 0;
    },

    /**
     * V-01：对会话 token 做 SHA-256 哈希，存入用户表用于校验。
     * token 本身已是 32 字节密码学安全随机数，再哈希存储使攻击者
     * 即使读取 localStorage 也无法还原原始 token 伪造会话。
     * @param {string} token - 原始 token（Base64）
     * @returns {Promise<string>} Base64 编码的 token 哈希
     */
    _hashToken: function (token) {
      var enc = new TextEncoder();
      var data = enc.encode(token);
      return crypto.subtle.digest('SHA-256', data).then(function (digest) {
        return toBase64(new Uint8Array(digest));
      });
    },

    /**
     * 生成随机会话 token（32 字节，Base64）。
     * 无业务含义，仅用于会话有效性反查。
     * @returns {string}
     */
    _generateToken: function () {
      var arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      return toBase64(arr);
    },

    /**
     * V-02 防护：以授权方式调用 Storage.updateUser 修改敏感字段。
     * 调用前设置授权标志，调用后立即清除，确保只有 Auth 模块能改密码哈希等字段。
     * @param {string} username
     * @param {Object} patch
     * @returns {boolean}
     */
    _secureUpdateUser: function (username, patch) {
      Storage._setAuthorized(true);
      var result = Storage.updateUser(username, patch);
      Storage._setAuthorized(false);
      return result;
    },

    // ========== 输入校验 ==========

    /**
     * 用户名校验：只许字母数字下划线、3-20 位。
     * 把 < > & " ' 这类危险字符挡在门外。
     * @param {string} name
     * @returns {Result}
     */
    validateUsername: function (name) {
      if (!name || typeof name !== 'string') {
        return { ok: false, msg: '用户名不能为空' };
      }
      var trimmed = name.trim();
      if (trimmed.length < 3 || trimmed.length > 20) {
        return { ok: false, msg: '用户名长度 3-20 位' };
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
        return { ok: false, msg: '用户名只允许字母、数字、下划线' };
      }
      return { ok: true };
    },

    /**
     * 密码强度校验：长度 6-20 位，必须同时包含字母和数字。
     * BUG-008 修复：从仅校验长度升级为强制复杂度校验。
     * @param {string} pwd
     * @returns {Result}
     */
    validatePassword: function (pwd) {
      if (!pwd || typeof pwd !== 'string') {
        return { ok: false, msg: '密码不能为空' };
      }
      if (pwd.length < 6 || pwd.length > 20) {
        return { ok: false, msg: '密码长度 6-20 位' };
      }
      // 必须同时包含字母和数字
      if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
        return { ok: false, msg: '密码须同时包含字母和数字' };
      }
      return { ok: true };
    },

    // ========== 认证流程 ==========

    /**
     * 注册：生成盐+哈希，写用户表。
     * @param {string} username
     * @param {string} password
     * @returns {Promise<Result>} 成功返回 {ok:true}；失败返回 {ok:false,msg}
     */
    register: function (username, password) {
      // 输入校验（提交前二次校验，兜底）
      var uCheck = this.validateUsername(username);
      if (!uCheck.ok) return Promise.resolve(uCheck);
      var pCheck = this.validatePassword(password);
      if (!pCheck.ok) return Promise.resolve(pCheck);

      username = username.trim();

      // 用户名已存在
      if (Storage.findUser(username)) {
        return Promise.resolve({ ok: false, msg: '用户名已被注册' });
      }

      var self = this;
      var salt = self._generateSalt();
      return self._hashPassword(password, salt).then(function (hash) {
        var user = {
          username: username,
          salt: salt,
          passwordHash: hash,
          createdAt: Date.now(),
          failCount: 0,
          lockUntil: 0
        };
        var saved = Storage.saveUser(user);
        if (!saved) {
          // BUG-004 修复：saveUser 返回 false 时再次检查是否因用户名重复
          if (Storage.findUser(username)) {
            return { ok: false, msg: '用户名已被注册' };
          }
          return { ok: false, msg: '注册失败，请重试' };
        }
        return { ok: true, msg: '注册成功，请登录' };
      });
    },

    /**
     * 登录：取盐重算哈希比对，通过则建会话。
     * 失败统一返回"用户名或密码错误"，并累加 failCount。
     * V-04：锁定检查在哈希比对之前，任何数据修改之前。
     * BUG-006：所有拒绝路径（用户不存在、已锁定、密码错误）均执行等耗时 PBKDF2 哈希。
     * V-01：登录成功时将 token 哈希存入用户表，供 checkSession 校验。
     * @param {string} username
     * @param {string} password
     * @param {boolean} remember - 是否记住我
     * @returns {Promise<Result>}
     */
    login: function (username, password, remember) {
      username = username ? username.trim() : '';

      // 查用户
      var user = Storage.findUser(username);
      var self = this;

      // 用户不存在 → 做一次假哈希消耗时间，再统一返回错误（防计时枚举）
      if (!user) {
        var dummySalt = self._generateSalt();
        return self._hashPassword(password, dummySalt).then(function () {
          return { ok: false, msg: '用户名或密码错误' };
        });
      }

      // V-04：检查锁定状态 — 必须在哈希比对和任何数据修改之前
      var now = Date.now();
      if (user.lockUntil && user.lockUntil > now) {
        var remain = Math.ceil((user.lockUntil - now) / 1000);
        // BUG-006 修复：锁定路径也执行 PBKDF2 假哈希，消除计时侧信道
        return self._hashPassword(password, user.salt).then(function () {
          return { ok: false, msg: '登录失败次数过多，请 ' + remain + ' 秒后再试' };
        });
      }

      // BUG-003：锁定已过期则清理残留
      if (user.lockUntil && user.lockUntil <= now) {
        self._secureUpdateUser(username, { lockUntil: 0, failCount: 0 });
        user.lockUntil = 0;
        user.failCount = 0;
      }

      return self._hashPassword(password, user.salt).then(function (hash) {
        // 常量时间比对
        if (!self._timingSafeEqual(hash, user.passwordHash)) {
          // 密码错误：累加失败计数
          var failCount = (user.failCount || 0) + 1;
          var patch = { failCount: failCount };
          // 达到 5 次 → 锁定 60 秒
          if (failCount >= MAX_FAIL) {
            patch.lockUntil = Date.now() + LOCK_DURATION;
            patch.failCount = 0; // 锁定后清零，下一轮重新计数
          }
          // V-02：通过授权通道更新敏感字段
          self._secureUpdateUser(username, patch);
          return { ok: false, msg: '用户名或密码错误' };
        }

        // 登录成功：清失败计数（V-02：授权通道）
        self._secureUpdateUser(username, { failCount: 0, lockUntil: 0 });

        // V-01：生成 token 并计算哈希存入用户表
        var token = self._generateToken();
        return self._hashToken(token).then(function (tokenHash) {
          // 存 token 哈希到用户表（V-02：授权通道）
          self._secureUpdateUser(username, { sessionTokenHash: tokenHash });

          // 建会话（只存 token + 用户名指针，不存密码/哈希）
          var session = {
            username: username,
            token: token,
            loginAt: now
          };
          if (remember) {
            session.expiresAt = now + REMEMBER_DURATION;
          }
          Storage.setSession(session, !!remember);

          return { ok: true, msg: '登录成功' };
        });
      });
    },

    /**
     * 登出：清会话、清失败计数。
     * V-06/BUG-001 修复：登出必须重置当前用户的 failCount 和 lockUntil。
     */
    logout: function () {
      // V-06/BUG-001：重置失败计数和锁定时间
      var user = this.currentUser();
      if (user) {
        this._secureUpdateUser(user, { failCount: 0, lockUntil: 0 });
      }
      Storage.clearSession();
    },

    // ========== 会话 ==========

    /**
     * 校验会话有效性（token 反查用户存在 + token 哈希比对 + 未过期），返回 username 或 null。
     * V-01 修复：checkSession 校验 session.token 的哈希与用户表中存储的 sessionTokenHash 匹配，
     * 防止伪造会话冒充任意用户。
     * @returns {Promise<string|null>}
     */
    checkSession: function () {
      var self = this;
      var session = Storage.getSession();
      if (!session || !session.username || !session.token) {
        return Promise.resolve(null);
      }

      // token 反查用户是否存在
      var user = Storage.findUser(session.username);
      if (!user) {
        // 用户已被删除，会话失效
        Storage.clearSession();
        return Promise.resolve(null);
      }

      // 记住我会话检查过期
      if (session.expiresAt) {
        if (Date.now() > session.expiresAt) {
          // 过期自动清除
          Storage.clearSession();
          return Promise.resolve(null);
        }
      }

      // V-01：校验 token 哈希与用户表中存储的 sessionTokenHash 匹配
      return self._hashToken(session.token).then(function (tokenHash) {
        if (!self._timingSafeEqual(tokenHash, user.sessionTokenHash || '')) {
          // token 不匹配，会话无效（可能已被其他设备登出或伪造）
          Storage.clearSession();
          return null;
        }
        return session.username;
      });
    },

    /**
     * 取当前登录用户名（不校验过期，轻量）。
     * @returns {string|null}
     */
    currentUser: function () {
      var session = Storage.getSession();
      if (!session || !session.username) {
        return null;
      }
      return session.username;
    }
  };

  // 暴露全局对象
  global.Auth = Auth;
})(window);
