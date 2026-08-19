/**
 * kanban.js — 业务层
 *
 * 看板三列（待办 / 进行中 / 完成）的渲染、任务增删改、HTML5 原生拖拽全在这层。
 * 依赖 storage.js 读写任务数据，依赖 auth.js 拿当前登录用户名（任务按用户隔离）。
 * 所有写操作前先确认 Auth.currentUser() 非空。
 *
 * 依赖：Storage（存储层）、Auth（认证层）
 * 暴露：全局对象 Kanban
 *
 * 安全要点：
 * - 全项目禁用 innerHTML 渲染用户输入，任务标题一律 textContent
 * - 任务卡片用 document.createElement 手搓，不拼 HTML 字符串
 * - 任务标题提交前做长度校验与空白裁剪
 */
(function (global) {
  'use strict';

  // 三列状态枚举
  var STATUS_LIST = ['todo', 'doing', 'done'];

  // 当前拖拽中的任务 id（dragstart 记录，drop 消费）
  var _dragTaskId = null;

  // 防止 init() 重复绑定事件
  var _initDone = false;

  var Kanban = {
    // ========== 公开 API ==========

    /**
     * 初始化：绑定拖拽事件、首次渲染、绑定新增/删除按钮。
     * 由 App.showView('kanban') 调用。
     */
    init: function () {
      // 绑定新增表单
      this._bindAddForm();

      // 绑定列拖拽事件（只绑一次）
      if (!_initDone) {
        this._bindColumnDnD();
        _initDone = true;
      }

      // 首次渲染
      this.render();
    },

    /**
     * 全量重渲染三列（按当前用户过滤任务）。
     * 无登录用户时渲染空列表。
     */
    render: function () {
      var user = Auth.currentUser();

      // 三列各自的 task-list
      for (var i = 0; i < STATUS_LIST.length; i++) {
        var list = document.querySelector(
          '.col[data-status="' + STATUS_LIST[i] + '"] .task-list'
        );
        if (list) {
          // 清空现有内容（用 removeChild 逐个删，不用 innerHTML）
          while (list.firstChild) {
            list.removeChild(list.firstChild);
          }
        }
      }

      // 无用户 → 渲染空列表即可
      if (!user) return;

      // 取当前用户全部任务（已按 order 排序）
      var tasks = Storage.getTasks(user);
      for (var j = 0; j < tasks.length; j++) {
        var task = tasks[j];
        var card = this._createTaskElement(task);
        var targetList = document.querySelector(
          '.col[data-status="' + task.status + '"] .task-list'
        );
        if (targetList) {
          targetList.appendChild(card);
        }
      }
    },

    /**
     * 新增任务到 todo 列。
     * @param {string} title - 任务标题
     * @returns {Result}
     */
    addTask: function (title) {
      var user = Auth.currentUser();
      if (!user) {
        return { ok: false, msg: '请先登录' };
      }

      var check = this._validateTitle(title);
      if (!check.ok) return check;

      title = title.trim();

      // 计算 order：取 todo 列当前最大 order + 1
      var tasks = Storage.getTasks(user);
      var maxOrder = -1;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].status === 'todo' && tasks[i].order > maxOrder) {
          maxOrder = tasks[i].order;
        }
      }

      var now = Date.now();
      var task = {
        id: this._genId(),
        title: title,
        status: 'todo',
        owner: user,
        order: maxOrder + 1,
        createdAt: now,
        updatedAt: now
      };

      var saved = Storage.saveTask(task);
      if (!saved) {
        return { ok: false, msg: '新增失败，请重试' };
      }

      this.render();
      return { ok: true, msg: '新增成功' };
    },

    /**
     * 拖拽后移动：更新 status 与 order，并重排列内顺序。
     * @param {string} id - 任务 id
     * @param {string} newStatus - 新状态（todo/doing/done）
     * @param {number} insertIndex - 在新列中的插入位置
     * @returns {Result}
     */
    moveTask: function (id, newStatus, insertIndex) {
      var user = Auth.currentUser();
      if (!user) {
        return { ok: false, msg: '请先登录' };
      }

      // 状态合法性
      if (STATUS_LIST.indexOf(newStatus) === -1) {
        return { ok: false, msg: '无效的目标列' };
      }

      var tasks = Storage.getTasks(user);

      // 找到被拖拽的任务
      var movedTask = null;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          movedTask = tasks[i];
          break;
        }
      }
      if (!movedTask) {
        return { ok: false, msg: '任务不存在' };
      }

      // 收集目标列的现有任务（排除被拖拽的），保持 order 升序
      var colTasks = [];
      for (var j = 0; j < tasks.length; j++) {
        if (tasks[j].status === newStatus && tasks[j].id !== id) {
          colTasks.push(tasks[j]);
        }
      }

      // 在 colTasks 中插入 movedTask 到 insertIndex 位置
      if (insertIndex < 0) insertIndex = 0;
      if (insertIndex > colTasks.length) insertIndex = colTasks.length;
      colTasks.splice(insertIndex, 0, movedTask);

      // 重新分配 order（0, 1, 2, ...），保证顺序连续
      var now = Date.now();
      for (var k = 0; k < colTasks.length; k++) {
        var patch = { order: k, updatedAt: now };
        // 被拖拽的任务还要更新 status
        if (colTasks[k].id === id) {
          patch.status = newStatus;
        }
        Storage.updateTask(colTasks[k].id, patch);
      }

      // 如果是从其他列拖来的，且原列还有任务，原列的 order 可能需要重排
      // 但由于 order 是列内独立的，其他列的 order 不受影响
      // 只需确保目标列的 order 正确即可

      this.render();
      return { ok: true, msg: '移动成功' };
    },

    /**
     * 删除任务。
     * V-05 修复：校验 task.owner === currentUser，防止 IDOR 跨用户删除。
     * @param {string} id - 任务 id
     * @returns {Result}
     */
    deleteTask: function (id) {
      var user = Auth.currentUser();
      if (!user) {
        return { ok: false, msg: '请先登录' };
      }

      // V-05：验证任务归属当前用户，防止 IDOR
      var tasks = Storage.getTasks(user);
      var owned = false;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          owned = true;
          break;
        }
      }
      if (!owned) {
        return { ok: false, msg: '删除失败，任务不存在' };
      }

      var ok = Storage.deleteTask(id);
      if (!ok) {
        return { ok: false, msg: '删除失败，任务不存在' };
      }

      this.render();
      return { ok: true, msg: '删除成功' };
    },

    /**
     * 内联编辑任务标题。
     * V-05 修复：校验 task.owner === currentUser，防止 IDOR 跨用户篡改。
     * @param {string} id - 任务 id
     * @param {string} title - 新标题
     * @returns {Result}
     */
    updateTaskTitle: function (id, title) {
      var user = Auth.currentUser();
      if (!user) {
        return { ok: false, msg: '请先登录' };
      }

      var check = this._validateTitle(title);
      if (!check.ok) return check;

      title = title.trim();

      // V-05：验证任务归属当前用户，防止 IDOR
      var tasks = Storage.getTasks(user);
      var owned = false;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          owned = true;
          break;
        }
      }
      if (!owned) {
        return { ok: false, msg: '更新失败，任务不存在' };
      }

      var ok = Storage.updateTask(id, {
        title: title,
        updatedAt: Date.now()
      });
      if (!ok) {
        return { ok: false, msg: '更新失败，任务不存在' };
      }

      this.render();
      return { ok: true, msg: '更新成功' };
    },

    // ========== 内部方法 ==========

    /**
     * 校验任务标题长度与空白。
     * @param {string} title
     * @returns {Result}
     */
    _validateTitle: function (title) {
      if (!title || typeof title !== 'string') {
        return { ok: false, msg: '任务标题不能为空' };
      }
      var trimmed = title.trim();
      if (trimmed.length === 0) {
        return { ok: false, msg: '任务标题不能为空' };
      }
      if (trimmed.length > 100) {
        return { ok: false, msg: '任务标题不超过 100 字符' };
      }
      return { ok: true };
    },

    /**
     * 生成任务 id：task_ + 时间戳 + 8 位 hex 随机后缀。
     * BUG-002 修复：改用 crypto.getRandomValues（4 字节 = 42 亿种可能），
     * 替代 Math.random 的 65536 种可能，与密码盐生成方式统一。
     * @returns {string}
     */
    _genId: function () {
      var ts = Date.now();
      var arr = new Uint8Array(4);
      crypto.getRandomValues(arr);
      var rand = '';
      for (var i = 0; i < arr.length; i++) {
        var hex = arr[i].toString(16);
        rand += hex.length < 2 ? '0' + hex : hex;
      }
      return 'task_' + ts + '_' + rand;
    },

    /**
     * 用 createElement + textContent 构建单个任务卡片 DOM。
     * 全程不拼 HTML 字符串，防 XSS。
     * @param {Object} task - 任务对象
     * @returns {HTMLElement}
     */
    _createTaskElement: function (task) {
      // <li class="task-card" draggable="true" data-id="...">
      var li = document.createElement('li');
      li.className = 'task-card';
      li.setAttribute('draggable', 'true');
      li.setAttribute('data-id', task.id);

      // 标题区：<span class="task-title">标题</span>
      var titleSpan = document.createElement('span');
      titleSpan.className = 'task-title';
      titleSpan.textContent = task.title; // textContent 防 XSS
      li.appendChild(titleSpan);

      // 操作区：<div class="task-actions">...</div>
      var actions = document.createElement('div');
      actions.className = 'task-actions';

      // 编辑按钮
      var editBtn = document.createElement('button');
      editBtn.className = 'btn-edit';
      editBtn.type = 'button';
      editBtn.textContent = '编辑';
      var self = this;
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self._startEdit(li, task.id, titleSpan);
      });
      actions.appendChild(editBtn);

      // 删除按钮
      var delBtn = document.createElement('button');
      delBtn.className = 'btn-delete';
      delBtn.type = 'button';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.deleteTask(task.id);
      });
      actions.appendChild(delBtn);

      li.appendChild(actions);

      // 拖拽事件
      li.addEventListener('dragstart', function (e) {
        _dragTaskId = task.id;
        e.dataTransfer.effectAllowed = 'move';
        // 空数据，仅用于触发 drop（部分浏览器需要 setData）
        try { e.dataTransfer.setData('text/plain', task.id); } catch (err) {}
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', function () {
        _dragTaskId = null;
        li.classList.remove('dragging');
      });

      return li;
    },

    /**
     * 内联编辑：把标题 span 替换为 input，Enter/blur 保存。
     * @param {HTMLElement} li - 卡片 li
     * @param {string} id - 任务 id
     * @param {HTMLElement} titleSpan - 标题 span
     */
    _startEdit: function (li, id, titleSpan) {
      // 已经在编辑中，跳过
      if (li.querySelector('.task-edit-input')) return;

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'task-edit-input';
      input.value = titleSpan.textContent;
      input.maxLength = 100;

      // 替换 span 为 input
      li.replaceChild(input, titleSpan);
      input.focus();
      input.select();

      var self = this;
      var done = false;

      var save = function () {
        if (done) return;
        done = true;
        var newTitle = input.value;
        self.updateTaskTitle(id, newTitle);
      };

      var cancel = function () {
        if (done) return;
        done = true;
        self.render(); // 还原
      };

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', save);
    },

    /**
     * 绑定新增表单。
     */
    _bindAddForm: function () {
      var self = this;
      var form = document.getElementById('add-form');
      var input = document.getElementById('task-title');
      if (!form || !input) return;

      // 先解绑旧 handler 再绑新的（防止 init 多次重复绑定）
      form.onsubmit = function (e) {
        e.preventDefault();
        var title = input.value;
        var result = self.addTask(title);
        if (result.ok) {
          input.value = '';
        } else {
          self._showMsg(result.msg || '操作失败');
        }
      };
    },

    /**
     * 绑定三列的 dragover / drop 事件。
     */
    _bindColumnDnD: function () {
      var self = this;
      var cols = document.querySelectorAll('.col[data-status]');
      for (var i = 0; i < cols.length; i++) {
        (function (col) {
          var status = col.getAttribute('data-status');

          // dragover：preventDefault 允许放置
          col.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.classList.add('drag-over');
          });

          // dragleave：移除高亮
          col.addEventListener('dragleave', function (e) {
            // 仅当离开整个列时移除（避免子元素间跳动触发）
            if (e.target === col) {
              col.classList.remove('drag-over');
            }
          });

          // drop：取出 id，计算插入位置，调 moveTask
          col.addEventListener('drop', function (e) {
            e.preventDefault();
            col.classList.remove('drag-over');

            var taskId = _dragTaskId;
            if (!taskId) {
              // 尝试从 dataTransfer 取（部分浏览器在 drop 时仍可读）
              try { taskId = e.dataTransfer.getData('text/plain'); } catch (err) {}
            }
            if (!taskId) return;

            // 计算插入位置：遍历目标列现有卡片（排除被拖拽的），
            // 找到第一个中心点在鼠标下方的卡片，插入其前面
            var list = col.querySelector('.task-list');
            if (!list) return;

            var cards = list.querySelectorAll('.task-card:not(.dragging)');
            var insertIndex = cards.length; // 默认插到最后

            for (var j = 0; j < cards.length; j++) {
              var rect = cards[j].getBoundingClientRect();
              var midY = rect.top + rect.height / 2;
              if (e.clientY < midY) {
                insertIndex = j;
                break;
              }
            }

            self.moveTask(taskId, status, insertIndex);
          });
        })(cols[i]);
      }
    },

    /**
     * 显示消息提示（用 textContent，不用 innerHTML）。
     * 复用页面上的 #kanban-msg 元素。
     */
    _showMsg: function (msg) {
      var el = document.getElementById('kanban-msg');
      if (el) {
        el.textContent = msg;
        // 3 秒后自动清除
        setTimeout(function () {
          el.textContent = '';
        }, 3000);
      }
    }
  };

  // 暴露全局对象
  global.Kanban = Kanban;
})(window);
