// G-01: 项目管理功能模块
// ========================================

// ── 项目数据管理 ──
function requestProjects() {
    sendToHost({ type: 'request-projects' });
}

function applyProjects(projects) {
    state.projects = Array.isArray(projects) ? projects : [];
    renderProjectSelector();
}

function renderProjectSelector() {
    const select = document.getElementById('project-select');
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="">全局</option>';

    state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
    });

    // 恢复选中项
    if (current && state.projects.find(p => p.id === current)) {
        select.value = current;
    } else if (state.currentProjectId && state.projects.find(p => p.id === state.currentProjectId)) {
        select.value = state.currentProjectId;
    } else {
        select.value = '';
    }
}

function switchProject(projectId) {
    // 保存当前项目状态
    if (state.currentProjectId) {
        state.projectStates.set(state.currentProjectId, {
            selectedRunId: state.selectedRunId,
            scrollPos: document.getElementById('timeline-steps')?.scrollTop || 0,
        });
    }

    state.currentProjectId = projectId;
    const project = state.projects.find(p => p.id === projectId);
    state.workspace = project ? project.path : '';

    // 恢复新项目状态
    const saved = state.projectStates.get(projectId);
    if (saved) {
        state.selectedRunId = saved.selectedRunId || '';
    } else {
        state.selectedRunId = '';
    }

    // 清空当前数据，重新加载
    state.selectedGate = null;
    state.runs.clear();
    renderTimeline();
    renderGatePanel();
    renderDeliveryControls();
    requestBoard();

    // 激活项目（更新 lastActiveAt）
    if (projectId) {
        sendToHost({ type: 'activate-project', projectId });
    }
}

// ── 项目管理对话框 ──
let projectSearchQuery = '';

function openProjectDialog() {
    const dialog = document.getElementById('project-dialog');
    if (!dialog) return;

    projectSearchQuery = '';
    renderProjectList();
    dialog.hidden = false;
}

function closeProjectDialog() {
    const dialog = document.getElementById('project-dialog');
    if (dialog) dialog.hidden = true;
}

function renderProjectList() {
    const list = document.getElementById('project-list');
    const searchInput = document.getElementById('project-search');
    if (!list) return;

    const query = (searchInput?.value || '').toLowerCase();
    const filtered = state.projects.filter(p => {
        if (!query) return true;
        return (p.name || '').toLowerCase().includes(query) ||
               (p.path || '').toLowerCase().includes(query);
    });

    list.innerHTML = '';

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'board-empty';
        empty.textContent = query ? '没有匹配的项目' : '还没有项目，点击上方"+ 添加项目"创建';
        list.appendChild(empty);
        return;
    }

    filtered.forEach(project => {
        const item = document.createElement('div');
        item.className = 'project-item';
        if (project.id === state.currentProjectId) {
            item.classList.add('active');
        }

        const info = document.createElement('div');
        info.className = 'project-info';

        const name = document.createElement('div');
        name.className = 'project-name';
        name.textContent = project.name || 'Unnamed';
        info.appendChild(name);

        const path = document.createElement('div');
        path.className = 'project-path';
        path.textContent = project.path || '';
        info.appendChild(path);

        if (project.description) {
            const desc = document.createElement('div');
            desc.className = 'project-path';
            desc.textContent = project.description;
            info.appendChild(desc);
        }

        const meta = document.createElement('div');
        meta.className = 'project-meta';
        const created = project.createdAt ? new Date(project.createdAt).toLocaleString('zh-CN') : '';
        meta.textContent = `创建于：${created}`;
        info.appendChild(meta);

        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'project-actions';

        if (project.id !== state.currentProjectId) {
            const switchBtn = document.createElement('button');
            switchBtn.className = 'btn primary';
            switchBtn.textContent = '切换';
            switchBtn.type = 'button';
            switchBtn.addEventListener('click', () => {
                const select = document.getElementById('project-select');
                if (select) select.value = project.id;
                switchProject(project.id);
                closeProjectDialog();
            });
            actions.appendChild(switchBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'btn';
        editBtn.textContent = '编辑';
        editBtn.type = 'button';
        editBtn.addEventListener('click', () => openProjectForm(project));
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn danger';
        deleteBtn.textContent = '删除';
        deleteBtn.type = 'button';
        deleteBtn.addEventListener('click', () => deleteProject(project));
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
        list.appendChild(item);
    });
}

// ── 项目表单对话框 ──
function openProjectForm(project = null) {
    const dialog = document.getElementById('project-form-dialog');
    const title = document.getElementById('project-form-title');
    const form = document.getElementById('project-form');
    const idInput = document.getElementById('project-form-id');
    const nameInput = document.getElementById('project-form-name');
    const pathInput = document.getElementById('project-form-path');
    const descInput = document.getElementById('project-form-description');

    if (!dialog || !form) return;

    if (project) {
        title.textContent = '编辑项目';
        idInput.value = project.id || '';
        nameInput.value = project.name || '';
        pathInput.value = project.path || '';
        descInput.value = project.description || '';
    } else {
        title.textContent = '添加项目';
        idInput.value = '';
        nameInput.value = '';
        pathInput.value = '';
        descInput.value = '';
    }

    dialog.hidden = false;
}

function closeProjectForm() {
    const dialog = document.getElementById('project-form-dialog');
    if (dialog) dialog.hidden = true;
}

function submitProjectForm(event) {
    event.preventDefault();

    const idInput = document.getElementById('project-form-id');
    const nameInput = document.getElementById('project-form-name');
    const pathInput = document.getElementById('project-form-path');
    const descInput = document.getElementById('project-form-description');

    const id = idInput.value.trim();
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    const description = descInput.value.trim();

    if (!name || !path) {
        alert('项目名称和路径为必填项');
        return;
    }

    if (id) {
        // 更新项目
        sendToHost({
            type: 'update-project',
            projectId: id,
            name,
            path,
            description,
        });
    } else {
        // 创建项目
        sendToHost({
            type: 'create-project',
            name,
            path,
            description,
        });
    }

    closeProjectForm();
}

function deleteProject(project) {
    if (!confirm(`确定要删除项目"${project.name}"吗？\n\n这不会删除磁盘上的文件，只会从项目列表中移除。`)) {
        return;
    }

    sendToHost({ type: 'delete-project', projectId: project.id });

    // 如果删除的是当前项目，切换到全局
    if (project.id === state.currentProjectId) {
        const select = document.getElementById('project-select');
        if (select) select.value = '';
        switchProject('');
    }
}

// ── 初始化项目管理 UI ──
function initProjectManagement() {
    // 项目选择器
    const projectSelect = document.getElementById('project-select');
    if (projectSelect) {
        projectSelect.addEventListener('change', (e) => {
            switchProject(e.target.value);
        });
    }

    // 管理按钮
    const manageBtn = document.getElementById('project-manage');
    if (manageBtn) {
        manageBtn.addEventListener('click', openProjectDialog);
    }

    // 刷新按钮
    const refreshBtn = document.getElementById('project-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', requestProjects);
    }

    // 项目对话框关闭
    const dialogClose = document.getElementById('project-dialog-close');
    if (dialogClose) {
        dialogClose.addEventListener('click', closeProjectDialog);
    }

    // 搜索输入
    const searchInput = document.getElementById('project-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderProjectList();
        });
    }

    // 添加项目按钮
    const addBtn = document.getElementById('project-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => openProjectForm());
    }

    // 项目表单关闭
    const formClose = document.getElementById('project-form-close');
    if (formClose) {
        formClose.addEventListener('click', closeProjectForm');
    }

    // 项目表单取消
    const formCancel = document.getElementById('project-form-cancel');
    if (formCancel) {
        formCancel.addEventListener('click', closeProjectForm);
    }

    // 项目表单提交
    const form = document.getElementById('project-form');
    if (form) {
        form.addEventListener('submit', submitProjectForm);
    }

    // 对话框背景点击关闭
    const projectDialog = document.getElementById('project-dialog');
    if (projectDialog) {
        projectDialog.addEventListener('click', (e) => {
            if (e.target === projectDialog) closeProjectDialog();
        });
    }

    const formDialog = document.getElementById('project-form-dialog');
    if (formDialog) {
        formDialog.addEventListener('click', (e) => {
            if (e.target === formDialog) closeProjectForm();
        });
    }

    // 初始加载项目列表
    requestProjects();
}

// 导出给宿主调用的函数（通过 window）
window.applyProjects = applyProjects;
window.projectOperationResult = function(success, message) {
    if (success) {
        // 操作成功，刷新项目列表
        requestProjects();
        renderProjectList();
    } else {
        alert(`操作失败：${message}`);
    }
};
