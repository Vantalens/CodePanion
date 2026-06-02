# Codex GUI 最终设计 - 多项目同时显示

## 设计理念

**类似 Cursor Codex 的左侧栏设计**：在侧边栏同时显示多个项目和会话，支持快速切换，适合多项目并行开发的场景。

## 最终界面布局

```
┌──────────┬─────────────────────────────┐
│CodePanion│                             │
│    [+]   │                             │
├──────────┤                             │
│ ▶ 项目  +│                             │
│  📁 项目A │                             │
│  📁 项目B │        主聊天区域              │
│  📁 项目C │                             │
├──────────┤                             │
│ ▼ 对话  3│                             │
│  会话 1  │                             │
│  会话 2  │                             │
│  会话 3  │                             │
├──────────┤                             │
│ 工作流   │                             │
│ 设置     │                             │
│ ● 已连接 │                             │
└──────────┴─────────────────────────────┘
```

## 核心特性

### 1. 可折叠的项目列表
- **位置**：侧边栏上部
- **显示**：所有项目同时可见（类似 VS Code 的工作区列表）
- **交互**：
  - 点击项目名切换当前项目
  - 当前激活项目高亮显示（蓝色边框）
  - 点击 `+` 按钮添加新项目
  - 点击 `▶ 项目` 折叠/展开列表

### 2. 可折叠的会话列表
- **位置**：侧边栏中部（占据剩余空间）
- **显示**：所有活跃会话
- **交互**：
  - 点击会话切换到该对话
  - 显示会话数量徽章
  - 点击 `▼ 对话` 折叠/展开列表
  - 默认展开状态

### 3. 底部菜单
- **工作流** - 切换到工作流控制台（chat.html）
- **设置** - 打开设置对话框（Provider 和模型配置）
- **连接状态** - 显示 daemon 连接状态

## 用户场景

### 场景 1：多项目并行开发
```
用户正在同时开发 3 个项目：
1. 前端项目（React）
2. 后端项目（Node.js）
3. 移动端项目（React Native）

操作流程：
1. 左侧栏显示全部 3 个项目
2. 点击"前端项目"，切换上下文
3. 在聊天区询问："如何优化组件渲染"
4. 点击"后端项目"，切换上下文
5. 在聊天区询问："如何设计 API 接口"
6. 无需关闭或切换窗口，所有项目随时可见
```

### 场景 2：项目内多个会话
```
在同一个项目内，用户可能有多个并行的对话：
1. 会话 A：讨论架构设计
2. 会话 B：debug 问题
3. 会话 C：代码 review

操作流程：
1. 所有会话在左侧栏同时显示
2. 点击不同会话快速切换上下文
3. 会话状态清晰可见（进行中/等待/已结束）
```

## 与之前设计的对比

### 之前设计 1（顶栏项目选择器）
```
优点：
- 项目选择器在顶部显眼

缺点：
❌ 一次只能看到一个项目名
❌ 需要点开下拉框才能看到其他项目
❌ 不适合多项目快速切换
```

### 之前设计 2（设置中的项目管理）
```
优点：
- 设置集中管理

缺点：
❌ 项目切换需要打开设置对话框
❌ 项目管理和项目切换混在一起
❌ 操作路径过长
```

### 最终设计（侧边栏项目列表）
```
优点：
✅ 所有项目同时可见
✅ 一键切换项目
✅ 当前项目状态清晰
✅ 类似 VS Code 的工作区体验
✅ 适合多项目并行开发

潜在改进：
- 可添加项目右键菜单（编辑/删除）
- 可添加项目收藏功能
- 可添加项目搜索/过滤
```

## HTML 结构

```html
<aside id="sidebar">
  <!-- 顶部：标题 + 新建按钮 -->
  <div class="sidebar-header">
    <h1>CodePanion</h1>
    <button id="new-chat-btn">+</button>
  </div>

  <!-- 项目区域（可折叠） -->
  <div class="projects-section">
    <div class="section-header">
      <button class="section-toggle">▶ 项目</button>
      <button id="projects-add-btn">+</button>
    </div>
    <div id="projects-list">
      <!-- 动态渲染项目列表 -->
    </div>
  </div>

  <!-- 会话区域（可折叠） -->
  <div class="sessions-section">
    <div class="section-header">
      <button class="section-toggle active">▼ 对话</button>
      <span class="count-badge">3</span>
    </div>
    <div id="sessions-list">
      <!-- 动态渲染会话列表 -->
    </div>
  </div>

  <!-- 底部菜单 -->
  <div class="sidebar-footer">
    <button id="workflow-btn">工作流</button>
    <button id="settings-btn">设置</button>
    <div class="connection-status">
      <span class="status-dot"></span>
      <span>已连接</span>
    </div>
  </div>
</aside>
```

## CSS 关键样式

### 可折叠区域
```css
.projects-list {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-out;
}

.projects-section.expanded .projects-list {
  max-height: 400px;
  overflow-y: auto;
}
```

### 项目项
```css
.project-item {
  padding: 8px 16px;
  cursor: pointer;
  border-left: 2px solid transparent;
}

.project-item.active {
  background: var(--bg-active);
  border-left-color: var(--accent-blue);
}
```

### 会话区域自适应
```css
.sessions-section {
  flex: 1;           /* 占据剩余空间 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sessions-list {
  flex: 1;           /* 占据剩余空间 */
  overflow-y: auto;  /* 自动滚动 */
}
```

## JavaScript 逻辑

### 项目渲染
```javascript
function handleProjects(projects) {
  elements.projectsList.innerHTML = '';
  
  projects.forEach(project => {
    const item = document.createElement('div');
    item.className = 'project-item';
    if (project.active) {
      item.classList.add('active');
    }
    
    item.innerHTML = `
      <div class="project-icon">📁</div>
      <div class="project-info">
        <div class="project-name">${project.name}</div>
        <div class="project-path">${project.path}</div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      sendToHost({ type: 'activate-project', projectId: project.id });
    });
    
    elements.projectsList.appendChild(item);
  });
}
```

### 折叠切换
```javascript
document.querySelectorAll('.section-toggle').forEach(toggle => {
  toggle.addEventListener('click', (e) => {
    const button = e.currentTarget;
    const section = button.dataset.section;
    const sectionEl = button.closest(`.${section}-section`);
    
    button.classList.toggle('active');
    sectionEl.classList.toggle('expanded');
  });
});
```

## 设置对话框

**不再包含项目管理**，只保留：
- **Providers** - Provider 配置
- **模型配置** - 模型和角色绑定

**项目管理完全在侧边栏进行**：
- 查看项目：侧边栏项目列表
- 切换项目：点击项目项
- 添加项目：点击 `+` 按钮（打开项目表单对话框）
- 编辑/删除项目：后续可添加右键菜单

## 优化建议

### 短期优化
1. 添加项目右键菜单（编辑/删除/设为默认）
2. 添加项目搜索框（当项目很多时）
3. 添加项目拖拽排序
4. 记住折叠状态（localStorage）

### 长期优化
1. 添加项目分组功能
2. 添加项目标签/颜色标记
3. 添加最近使用项目列表
4. 支持项目收藏/置顶

## 总结

这个设计完美解决了你提出的问题：

> "项目管理和 Codex 用一样的方式，这个不合适"

**现在的设计**：
- ✅ 所有项目同时可见（不是下拉框）
- ✅ 一键切换项目（不需要打开设置）
- ✅ 适合多项目并行开发（类似 IDE 的工作区）
- ✅ 界面清晰简洁（可折叠设计）
- ✅ 类似 Cursor Codex 的体验

这才是真正适合 AI IDE 的项目管理方式！
