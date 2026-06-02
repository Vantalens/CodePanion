// G-06: Provider 与模型配置功能模块
// ========================================

// ── Provider 数据管理 ──
function requestProviders() {
    sendToHost({ type: 'request-providers' });
}

function applyProviders(providers) {
    state.providers = Array.isArray(providers) ? providers : [];
    renderProviderList();
}

function requestModels() {
    sendToHost({ type: 'request-models' });
}

function applyModels(models) {
    state.models = Array.isArray(models) ? models : [];
    renderModelConfiguration();
}

// ── Provider 管理对话框 ──
function openSettingsDialog() {
    const dialog = document.getElementById('settings-dialog');
    if (!dialog) return;

    // 默认打开 Providers 标签
    switchSettingsTab('providers');
    requestProviders();
    dialog.hidden = false;
}

function closeSettingsDialog() {
    const dialog = document.getElementById('settings-dialog');
    if (dialog) dialog.hidden = true;
}

function switchSettingsTab(tab) {
    // 切换标签按钮状态
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容面板
    document.querySelectorAll('.settings-content').forEach(panel => {
        panel.hidden = panel.id !== `settings-${tab}`;
    });

    // 加载对应数据
    if (tab === 'providers') {
        requestProviders();
    } else if (tab === 'models') {
        requestModels();
    }
}

function renderProviderList() {
    const list = document.getElementById('provider-list');
    if (!list) return;

    list.innerHTML = '';

    if (state.providers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'board-empty';
        empty.textContent = '还没有 provider，点击"+ 添加 Provider"创建';
        list.appendChild(empty);
        return;
    }

    state.providers.forEach(provider => {
        const item = document.createElement('div');
        item.className = 'provider-item';
        if (provider.id === state.activeProviderId) {
            item.classList.add('active');
        }

        const info = document.createElement('div');
        info.className = 'provider-info';

        const header = document.createElement('div');
        header.className = 'provider-header';

        const name = document.createElement('div');
        name.className = 'provider-name';
        name.textContent = provider.name || 'Unnamed';
        header.appendChild(name);

        const statusBadge = document.createElement('span');
        statusBadge.className = `provider-status ${provider.status || 'unknown'}`;
        statusBadge.textContent = provider.status === 'active' ? '✓ 激活' : '未激活';
        header.appendChild(statusBadge);

        info.appendChild(header);

        const type = document.createElement('div');
        type.className = 'provider-meta';
        type.textContent = `类型：${provider.type || 'unknown'} | API: ${provider.apiBase || 'N/A'}`;
        info.appendChild(type);

        if (provider.lastUsedAt) {
            const lastUsed = document.createElement('div');
            lastUsed.className = 'provider-meta';
            lastUsed.textContent = `最后使用：${new Date(provider.lastUsedAt).toLocaleString('zh-CN')}`;
            info.appendChild(lastUsed);
        }

        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'provider-actions';

        if (provider.status !== 'active') {
            const activateBtn = document.createElement('button');
            activateBtn.className = 'btn primary';
            activateBtn.textContent = '激活';
            activateBtn.type = 'button';
            activateBtn.addEventListener('click', () => activateProvider(provider.id));
            actions.appendChild(activateBtn);
        }

        const testBtn = document.createElement('button');
        testBtn.className = 'btn';
        testBtn.textContent = '测试连接';
        testBtn.type = 'button';
        testBtn.addEventListener('click', () => testProvider(provider.id));
        actions.appendChild(testBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn';
        editBtn.textContent = '编辑';
        editBtn.type = 'button';
        editBtn.addEventListener('click', () => openProviderForm(provider));
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn danger';
        deleteBtn.textContent = '删除';
        deleteBtn.type = 'button';
        deleteBtn.addEventListener('click', () => deleteProvider(provider));
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
        list.appendChild(item);
    });
}

// ── Provider 表单对话框 ──
function openProviderForm(provider = null) {
    const dialog = document.getElementById('provider-form-dialog');
    const title = document.getElementById('provider-form-title');
    const form = document.getElementById('provider-form');
    const idInput = document.getElementById('provider-form-id');
    const nameInput = document.getElementById('provider-form-name');
    const typeInput = document.getElementById('provider-form-type');
    const apiKeyInput = document.getElementById('provider-form-apikey');
    const apiBaseInput = document.getElementById('provider-form-apibase');

    if (!dialog || !form) return;

    if (provider) {
        title.textContent = '编辑 Provider';
        idInput.value = provider.id || '';
        nameInput.value = provider.name || '';
        typeInput.value = provider.type || 'openai';
        apiKeyInput.value = provider.apiKey || '';
        apiBaseInput.value = provider.apiBase || '';
    } else {
        title.textContent = '添加 Provider';
        idInput.value = '';
        nameInput.value = '';
        typeInput.value = 'openai';
        apiKeyInput.value = '';
        apiBaseInput.value = 'https://api.openai.com/v1';
    }

    dialog.hidden = false;
}

function closeProviderForm() {
    const dialog = document.getElementById('provider-form-dialog');
    if (dialog) dialog.hidden = true;
}

function submitProviderForm(event) {
    event.preventDefault();

    const idInput = document.getElementById('provider-form-id');
    const nameInput = document.getElementById('provider-form-name');
    const typeInput = document.getElementById('provider-form-type');
    const apiKeyInput = document.getElementById('provider-form-apikey');
    const apiBaseInput = document.getElementById('provider-form-apibase');

    const id = idInput.value.trim();
    const name = nameInput.value.trim();
    const type = typeInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const apiBase = apiBaseInput.value.trim();

    if (!name || !type || !apiKey) {
        alert('Provider 名称、类型和 API Key 为必填项');
        return;
    }

    if (id) {
        // 更新 provider
        sendToHost({
            type: 'update-provider',
            providerId: id,
            name,
            providerType: type,
            apiKey,
            apiBase,
        });
    } else {
        // 创建 provider
        sendToHost({
            type: 'create-provider',
            name,
            providerType: type,
            apiKey,
            apiBase,
        });
    }

    closeProviderForm();
}

function deleteProvider(provider) {
    if (!confirm(`确定要删除 provider "${provider.name}"吗？`)) {
        return;
    }

    sendToHost({ type: 'delete-provider', providerId: provider.id });
}

function testProvider(providerId) {
    sendToHost({ type: 'test-provider', providerId });
}

function activateProvider(providerId) {
    sendToHost({ type: 'activate-provider', providerId });
}

function applyProviderTestResult(providerId, success, message) {
    alert(success ? `测试成功：${message}` : `测试失败：${message}`);
}

// ── 模型配置 ──
function renderModelConfiguration() {
    const container = document.getElementById('model-config-container');
    if (!container) return;

    container.innerHTML = '';

    // 默认模型选择
    const defaultModelSection = document.createElement('div');
    defaultModelSection.className = 'model-config-section';

    const defaultModelLabel = document.createElement('label');
    defaultModelLabel.textContent = '默认模型';
    defaultModelLabel.className = 'model-config-label';
    defaultModelSection.appendChild(defaultModelLabel);

    const defaultModelSelect = document.createElement('select');
    defaultModelSelect.id = 'default-model-select';
    defaultModelSelect.className = 'model-config-select';

    // 填充模型选项
    state.models.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = `${model.name} (${model.provider})`;
        if (model.id === state.defaultModel) {
            opt.selected = true;
        }
        defaultModelSelect.appendChild(opt);
    });

    defaultModelSelect.addEventListener('change', (e) => {
        sendToHost({ type: 'set-default-model', modelId: e.target.value });
    });

    defaultModelSection.appendChild(defaultModelSelect);
    container.appendChild(defaultModelSection);

    // 角色绑定
    const roleBindingsSection = document.createElement('div');
    roleBindingsSection.className = 'model-config-section';

    const roleBindingsTitle = document.createElement('h4');
    roleBindingsTitle.textContent = '角色绑定';
    roleBindingsSection.appendChild(roleBindingsTitle);

    const roles = ['architect', 'coder', 'reviewer', 'tester'];
    roles.forEach(role => {
        const roleRow = document.createElement('div');
        roleRow.className = 'role-binding-row';

        const roleLabel = document.createElement('label');
        roleLabel.textContent = role;
        roleLabel.className = 'role-binding-label';
        roleRow.appendChild(roleLabel);

        const roleSelect = document.createElement('select');
        roleSelect.className = 'model-config-select';
        roleSelect.dataset.role = role;

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '使用默认模型';
        roleSelect.appendChild(defaultOpt);

        state.models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model.id;
            opt.textContent = `${model.name} (${model.provider})`;
            if (state.roleBindings && state.roleBindings[role] === model.id) {
                opt.selected = true;
            }
            roleSelect.appendChild(opt);
        });

        roleSelect.addEventListener('change', (e) => {
            sendToHost({
                type: 'set-role-binding',
                role: e.target.dataset.role,
                modelId: e.target.value
            });
        });

        roleRow.appendChild(roleSelect);
        roleBindingsSection.appendChild(roleRow);
    });

    container.appendChild(roleBindingsSection);
}

// ── 初始化 Provider 管理 UI ──
function initProviderManagement() {
    // 设置按钮
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsDialog);
    }

    // 设置对话框关闭
    const dialogClose = document.getElementById('settings-dialog-close');
    if (dialogClose) {
        dialogClose.addEventListener('click', closeSettingsDialog);
    }

    // 标签切换
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
    });

    // 添加 Provider 按钮
    const addBtn = document.getElementById('provider-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => openProviderForm());
    }

    // Provider 表单关闭
    const formClose = document.getElementById('provider-form-close');
    if (formClose) {
        formClose.addEventListener('click', closeProviderForm);
    }

    // Provider 表单取消
    const formCancel = document.getElementById('provider-form-cancel');
    if (formCancel) {
        formCancel.addEventListener('click', closeProviderForm);
    }

    // Provider 表单提交
    const form = document.getElementById('provider-form');
    if (form) {
        form.addEventListener('submit', submitProviderForm);
    }

    // 对话框背景点击关闭
    const settingsDialog = document.getElementById('settings-dialog');
    if (settingsDialog) {
        settingsDialog.addEventListener('click', (e) => {
            if (e.target === settingsDialog) closeSettingsDialog();
        });
    }

    const formDialog = document.getElementById('provider-form-dialog');
    if (formDialog) {
        formDialog.addEventListener('click', (e) => {
            if (e.target === formDialog) closeProviderForm();
        });
    }
}

// 导出给宿主调用的函数
window.applyProviders = applyProviders;
window.applyModels = applyModels;
window.applyProviderTestResult = applyProviderTestResult;
window.providerOperationResult = function(success, message) {
    if (success) {
        requestProviders();
    } else {
        alert(`操作失败：${message}`);
    }
};
