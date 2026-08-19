/**
 * storage.js — 存储层（最底层）
 *
 * 唯一有权碰 localStorage / sessionStorage 的模块。
 * 别的模块想读写数据，必须调它的 API，不许直接摸存储。
 * 所有 key 统一 sc: 前缀，命名空间隔离。
 *
 * 依赖：无（谁也不依赖，纯存储）
 * 暴露：全局对象 Storage
 */
(function (global) {
  'use strict';

  var PREFIX = 'sc:';

  // V-02 防护：敏感字段写保护。
  // salt / passwordHash / sessionTokenHash / failCount / lockUntil 为安全关键字段，
  // 只有 Auth 模块通过 _setAuthorized(true) 授权后才能通过 updateUser 修改。
  // 纯前端无法完全阻止控制台绕过，但可提高门槛、阻断常规攻击向量。
  var SENSITIVE_FIELDS = {
    salt: true,
    passwordHash: true,
    sessionTokenHash: true,
    failCount: true,
    lockUntil: true
  };
  var _authorized = false;

  // 存储 key 常量集中管理，避免散落
  var KEY = {
    USERS: PREFIX + 'users',
    TASKS: PREFIX + 'tasks',
    SESSION: PREFIX + 'session',           // sessionStorage 专用
    SESSION_REMEMBER: PREFIX + 'session_remember' // localStorage 记住我
  };

  var Storage = {
    // ========== 通用读写 ==========

    /**
     * 读 localStorage key，JSON 反序列化。
     * @param {string} key - 不含前缀的 key（内部自动补 sc:）
     * @returns {*} 反序列化后的值；不存在或解析失败返回 null
     */
    get: function (key) {
      try {
        var raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return null;
        return JSON.parse(raw);
      } catch (e) {
        // 解析失败兜底，返回 null，不抛异常给上层
        return null;
      }
    },

    /**
     * 写 localStorage key，JSON 序列化。
     * @param {string} key - 不含前缀的 key
     * @param {*} value - 任意可序列化值
     * @returns {boolean} 成功返回 true，失败返回 false
     */
    set: function (key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        // 配额满或隐私模式禁用 localStorage，兜底返回 false
        return false;
      }
    },

    /**
     * 删 localStorage key。
     * @param {string} key - 不含前缀的 key
     */
    remove: function (key) {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch (e) {
        // 静默失败，删除不存在的 key 不报错
      }
    },

    // ========== 用户表 ==========

    /**
     * 取全量用户表。
     * @returns {Array} 用户数组；无数据返回空数组
     */
    getUsers: function () {
      var users = this.get('users');
      return Array.isArray(users) ? users : [];
    },

    /**
     * 新增用户。username 已存在则拒绝。
     * @param {Object} user - 用户对象 {username, salt, passwordHash, createdAt, failCount, lockUntil}
     * @returns {boolean} 成功返回 true；用户名已存在返回 false
     */
    saveUser: function (user) {
      var users = this.getUsers();
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === user.username) {
          return false; // 用户名已存在
        }
      }
      users.push(user);
      return this.set('users', users);
    },

    /**
     * 按 username 查用户。
     * @param {string} username
     * @returns {Object|null} 用户对象；无则返回 null
     */
    findUser: function (username) {
      var users = this.getUsers();
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) {
          return users[i];
        }
      }
      return null;
    },

    /**
     * 设置授权标志。仅 Auth 模块在修改敏感字段前调用。
     * @param {boolean} v
     */
    _setAuthorized: function (v) {
      _authorized = v;
    },

    /**
     * 按 username 局部更新字段（合并 patch）。
     * V-02 防护：未授权时拒绝修改敏感字段（salt/passwordHash/sessionTokenHash/failCount/lockUntil）。
     * @param {string} username
     * @param {Object} patch - 要覆盖的字段
     * @returns {boolean} 成功返回 true；用户不存在或敏感字段未授权返回 false
     */
    updateUser: function (username, patch) {
      // 敏感字段写保护：未授权时拒绝
      if (!_authorized) {
        for (var sf in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, sf) && SENSITIVE_FIELDS[sf]) {
            return false;
          }
        }
      }
      var users = this.getUsers();
      var found = false;
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) {
          // 浅合并 patch 到现有用户对象
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) {
              users[i][k] = patch[k];
            }
          }
          found = true;
          break;
        }
      }
      if (!found) return false;
      return this.set('users', users);
    },

    // ========== 任务表 ==========

    /**
     * 取某 owner 的全部任务，按 status 分组、order 升序排序。
     * @param {string} owner - 用户名
     * @returns {Array} 任务数组；无数据返回空数组
     */
    getTasks: function (owner) {
      var tasks = this.get('tasks');
      if (!Array.isArray(tasks)) return [];
      // 按归属用户过滤
      var owned = [];
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].owner === owner) {
          owned.push(tasks[i]);
        }
      }
      // 按 order 升序排序，保证列内顺序连续
      owned.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      return owned;
    },

    /**
     * 新增任务（追加到任务表末尾）。
     * @param {Object} task - 任务对象
     * @returns {boolean} 成功返回 true
     */
    saveTask: function (task) {
      var tasks = this.get('tasks');
      if (!Array.isArray(tasks)) tasks = [];
      tasks.push(task);
      return this.set('tasks', tasks);
    },

    /**
     * 按 id 局部更新任务字段（合并 patch）。
     * @param {string} id - 任务 id
     * @param {Object} patch - 要覆盖的字段（status/order/title/updatedAt）
     * @returns {boolean} 成功返回 true；任务不存在返回 false
     */
    updateTask: function (id, patch) {
      var tasks = this.get('tasks');
      if (!Array.isArray(tasks)) return false;
      var found = false;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) {
              tasks[i][k] = patch[k];
            }
          }
          found = true;
          break;
        }
      }
      if (!found) return false;
      return this.set('tasks', tasks);
    },

    /**
     * 按 id 删除任务。
     * @param {string} id - 任务 id
     * @returns {boolean} 成功返回 true；任务不存在返回 false
     */
    deleteTask: function (id) {
      var tasks = this.get('tasks');
      if (!Array.isArray(tasks)) return false;
      var filtered = [];
      var found = false;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          found = true;
        } else {
          filtered.push(tasks[i]);
        }
      }
      if (!found) return false;
      return this.set('tasks', filtered);
    },

    // ========== 会话 ==========

    /**
     * 取当前会话。优先 sessionStorage（默认），再查 localStorage 记住我。
     * @returns {Object|null} 会话对象；无则返回 null
     */
    getSession: function () {
      // 先查 sessionStorage（关页即清的临时会话）
      var session = null;
      try {
        var raw = sessionStorage.getItem(KEY.SESSION);
        if (raw !== null) {
          session = JSON.parse(raw);
        }
      } catch (e) {
        session = null;
      }
      if (session) return session;

      // 再查 localStorage 记住我会话
      session = this.get('session_remember');
      return session;
    },

    /**
     * 写会话。remember=true 落 localStorage，否则落 sessionStorage。
     * @param {Object} session - 会话对象 {username, token, loginAt, expiresAt?}
     * @param {boolean} remember - 是否记住我（持久化到 localStorage）
     */
    setSession: function (session, remember) {
      // 无论哪种模式，先清掉另一处，避免双份残留
      this.clearSession();
      if (remember) {
        // 记住我：落 localStorage，带过期时间
        this.set('session_remember', session);
      } else {
        // 默认：落 sessionStorage，关页即清
        try {
          sessionStorage.setItem(KEY.SESSION, JSON.stringify(session));
        } catch (e) {
          // sessionStorage 不可用时兜底落 localStorage（不带过期）
          this.set('session_remember', session);
        }
      }
    },

    /**
     * 清两处会话（sessionStorage + localStorage 记住我）。
     */
    clearSession: function () {
      try {
        sessionStorage.removeItem(KEY.SESSION);
      } catch (e) { /* 静默 */ }
      this.remove('session_remember');
    }
  };

  // 暴露全局对象
  global.Storage = Storage;
})(window);
