/**
 * app.js — 入口层
 *
 * 页面生命周期管理、视图切换、表单事件绑定。
 * DOMContentLoaded 触发后调 Auth.checkSession() 判断登没登录，
 * 有会话 → 看板视图 + Kanban.init()；无会话 → 登录视图。
 *
 * 依赖：Storage / Auth / Kanban（按序已加载就绪）
 * 暴露：全局对象 App
 */
(function (global) {
  'use strict';

  // 当前表单模式：'login' 或 'register'
  var _mode = 'login';

  // 防重复提交标志
  var _submitting = false;

  var App = {
    /**
     * 入口：DOMContentLoaded 触发后调用。
     * V-01：checkSession 已改为异步（需异步计算 token 哈希校验），init 用 then 接收结果。
     */
    init: function () {
      var self = this;
      Auth.checkSession().then(function (user) {
        if (user) {
          self.showView('kanban');
          Kanban.init();
        } else {
          self.showView('login');
        }
        self.bindEvents();
      });
    },

    /**
     * 切换视图：login / kanban。
     * @param {string} name - 'login' 或 'kanban'
     */
    showView: function (name) {
      var isKanban = name === 'kanban';
      var kanbanView = document.getElementById('kanban-view');
      var loginView = document.getElementById('login-view');
      var logoutBtn = document.getElementById('logout-btn');

      if (kanbanView) kanbanView.hidden = !isKanban;
      if (loginView) loginView.hidden = isKanban;
      if (logoutBtn) logoutBtn.hidden = !isKanban;
    },

    /**
     * 绑定全局事件：表单提交、模式切换、登出。
     */
    bindEvents: function () {
      var self = this;

      // 认证表单提交（登录 / 注册）
      var authForm = document.getElementById('auth-form');
      if (authForm) {
        authForm.addEventListener('submit', function (e) {
          e.preventDefault();
          self._handleAuth();
        });
      }

      // 模式切换
      var toggleBtn = document.getElementById('toggle-mode');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          self._setMode(_mode === 'login' ? 'register' : 'login');
        });
      }

      // 登出
      var logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          Auth.logout();
          self._setMode('login');
          self._clearAuthForm();
          self.showView('login');
          // 清空看板 DOM
          Kanban.render();
        });
      }

      // 用户名输入实时清空消息
      var usernameInput = document.getElementById('username');
      if (usernameInput) {
        usernameInput.addEventListener('input', function () {
          self._setAuthMsg('');
        });
      }
    },

    /**
     * 处理认证表单提交：根据 _mode 调 login 或 register。
     */
    _handleAuth: function () {
      // 防抖：提交中直接拒绝
      if (_submitting) return;

      var username = (document.getElementById('username') || {}).value || '';
      var password = (document.getElementById('password') || {}).value || '';
      var remember = !!(document.getElementById('remember') || {}).checked;

      var self = this;
      var submitBtn = document.getElementById('auth-submit');

      // 设置 loading 态
      _submitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = _mode === 'login' ? '登录中…' : '注册中…';
      }

      // 根据模式调用对应方法
      var promise;
      if (_mode === 'login') {
        promise = Auth.login(username, password, remember);
      } else {
        promise = Auth.register(username, password);
      }

      promise.then(function (result) {
        if (result.ok) {
          if (_mode === 'login') {
            // 登录成功 → 切看板
            self._setAuthMsg('');
            self.showView('kanban');
            Kanban.init();
            // 清空表单
            self._clearAuthForm();
          } else {
            // 注册成功 — BUG-012 修复：如果已自动登录，直接跳看板
            if (Auth.currentUser()) {
              self._setAuthMsg('');
              self.showView('kanban');
              Kanban.init();
            } else {
              self._setAuthMsg(result.msg || '注册成功，请登录');
              self._setMode('login');
            }
            self._clearAuthForm();
          }
        } else {
          self._setAuthMsg(result.msg || '操作失败');
        }
      }).catch(function () {
        self._setAuthMsg('系统异常，请重试');
      }).then(function () {
        // 恢复按钮态
        _submitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = _mode === 'login' ? '登录' : '注册';
        }
      });
    },

    /**
     * 切换表单模式（登录 / 注册）。
     * @param {string} mode - 'login' 或 'register'
     */
    _setMode: function (mode) {
      _mode = mode;
      var title = document.getElementById('form-title');
      var submit = document.getElementById('auth-submit');
      var toggle = document.getElementById('toggle-mode');
      var rememberGroup = document.getElementById('remember-group');

      if (mode === 'register') {
        if (title) title.textContent = '注册';
        if (submit) submit.textContent = '注册';
        if (toggle) toggle.textContent = '已有账号？登录';
        if (rememberGroup) rememberGroup.hidden = true;
      } else {
        if (title) title.textContent = '登录';
        if (submit) submit.textContent = '登录';
        if (toggle) toggle.textContent = '还没有账号？注册';
        if (rememberGroup) rememberGroup.hidden = false;
      }

      this._setAuthMsg('');
    },

    /**
     * 清空认证表单。
     */
    _clearAuthForm: function () {
      var username = document.getElementById('username');
      var password = document.getElementById('password');
      var remember = document.getElementById('remember');
      if (username) username.value = '';
      if (password) password.value = '';
      if (remember) remember.checked = false;
      this._setAuthMsg('');
    },

    /**
     * 显示认证消息（用 textContent，不用 innerHTML）。
     */
    _setAuthMsg: function (msg) {
      var el = document.getElementById('auth-msg');
      if (!el) return;
      el.textContent = msg || '';
      if (msg) {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        el.addEventListener('animationend', function handler() {
          el.classList.remove('shake');
          el.removeEventListener('animationend', handler);
        });
      }
    }
  };

  // 暴露全局对象
  global.App = App;

  // DOMContentLoaded 入口
  document.addEventListener('DOMContentLoaded', function () {
    App.init();
  });
})(window);
