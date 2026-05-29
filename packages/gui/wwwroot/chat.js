'use strict';
// W-20 重建：CodePanion 工作流控制台前端。监听式（会话流 / 来源 / 接力 / 收件箱）逻辑已整体移除。
// 数据全部来自 daemon 的工作流控制台 API（board / run 详情 / artifacts / delivery / gate）+ 实时 WS run 事件。
// 与宿主（WebView2）通过 postMessage 双向通信；宿主再代理 daemon HTTP / WS。

const state = {
    connected: false,
    workspace: '',              // 当前 workspace 绝对路径，空 = daemon 全局 fallback
    recentWorkspaces: [],       // 最近用过的 workspace（localStorage 持久化）
    board: null,                // 最近一次 /workflow/board 结果 { workflows, runs, gates }
    boardError: '',
    selectedRunId: '',          // 中栏时间线当前展示的 run
    runs: new Map(),            // runId -> run 详情（steps 含 output）；实时事件就地更新
    expandedSteps: new Set(),   // 展开了 output 的 step（按 runId:stepId）
    selectedGate: null,         // { runId, stepId, workflowName, role } 选中待决策的人工门
    deliveryRunId: '',
};

const WORKSPACE_RECENTS_KEY = 'codepanion.recentWorkspaces';
const MAX_RECENTS = 8;

// ── 宿主通信 ──
function sendToHost(message) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
    }
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// J-09：拦截助手内容里的外链，交给宿主用系统浏览器打开；应用内锚点放行。
function shouldInterceptAnchor(anchor) {
    if (!anchor) return false;
    const href = anchor.getAttribute('href');
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
        return true;
    }
    try {
        const url = new URL(trimmed, document.baseURI);
        if (url.protocol === 'https:' && url.host === 'codepanion.local') return false;
        if (url.href === 'about:blank') return false;
    } catch {
        return true;
    }
    return true;
}

// ── 连接状态 ──
function updateConnectionStatus(connected) {
    state.connected = Boolean(connected);
    const shell = document.getElementById('app-shell');
    if (shell) shell.classList.toggle('connected', state.connected);
    const text = document.querySelector('.status-text');
    if (text) text.textContent = state.connected ? '已连接' : '未连接';
}

function setBoardStatus(text) {
    const el = document.getElementById('board-status');
    if (el) el.textContent = text;
}

// ── workspace ──
function loadRecentWorkspaces() {
    try {
        const raw = window.localStorage ? window.localStorage.getItem(WORKSPACE_RECENTS_KEY) : null;
        state.recentWorkspaces = raw ? JSON.parse(raw).filter((x) => typeof x === 'string') : [];
    } catch {
        state.recentWorkspaces = [];
    }
    renderWorkspaceRecents();
}

function rememberWorkspace(ws) {
    if (!ws) return;
    state.recentWorkspaces = [ws, ...state.recentWorkspaces.filter((x) => x !== ws)].slice(0, MAX_RECENTS);
    try {
        if (window.localStorage) window.localStorage.setItem(WORKSPACE_RECENTS_KEY, JSON.stringify(state.recentWorkspaces));
    } catch { /* localStorage 不可用时忽略，仅内存保留 */ }
    renderWorkspaceRecents();
}

function renderWorkspaceRecents() {
    const list = document.getElementById('workspace-recents');
    if (!list) return;
    list.innerHTML = '';
    for (const ws of state.recentWorkspaces) {
        const opt = document.createElement('option');
        opt.value = ws;
        list.appendChild(opt);
    }
}

function applyWorkspace(ws) {
    state.workspace = (ws || '').trim();
    if (state.workspace) rememberWorkspace(state.workspace);
    sendToHost({ type: 'set-workspace', workspace: state.workspace });
    // 切 workspace 后清掉与旧 workspace 绑定的选中态，重拉 board。
    state.selectedRunId = '';
    state.selectedGate = null;
    state.runs.clear();
    renderTimeline();
    renderGatePanel();
    renderDeliveryControls();
    requestBoard();
}

// ── board ──
function requestBoard() {
    setBoardStatus('加载中…');
    sendToHost({ type: 'request-workflow-board', workspace: state.workspace || undefined });
}

function applyWorkflowBoard(board, error) {
    state.board = board || null;
    state.boardError = error || '';
    renderBoard();
}

function renderBoard() {
    const defs = document.getElementById('def-list');
    const runs = document.getElementById('runs-list');
    const gates = document.getElementById('gates-list');
    if (!defs || !runs || !gates) return;
    defs.innerHTML = '';
    runs.innerHTML = '';
    gates.innerHTML = '';

    if (state.boardError) {
        setBoardStatus(`加载失败：${state.boardError}`);
        defs.appendChild(emptyHint('无法加载 board。'));
        return;
    }
    if (!state.board) {
        setBoardStatus('daemon 未返回数据。');
        return;
    }
    const workflows = Array.isArray(state.board.workflows) ? state.board.workflows : [];
    const runEntries = Array.isArray(state.board.runs) ? state.board.runs : [];
    const gateEntries = Array.isArray(state.board.gates) ? state.board.gates : [];
    setBoardStatus(`workspace=${state.workspace || '<全局>'} · workflows=${workflows.length} · runs=${runEntries.length} · gates=${gateEntries.length}`);

    workflows.forEach((w) => defs.appendChild(renderWorkflowDefinitionCard(w)));
    runEntries.forEach((r) => runs.appendChild(renderWorkflowRunCard(r)));
    gateEntries.forEach((g) => gates.appendChild(renderWorkflowGateCard(g)));
    if (workflows.length === 0) defs.appendChild(emptyHint('当前 workspace 没有可执行 workflow（用 CLI 写 workflows.json）。'));
    if (runEntries.length === 0) runs.appendChild(emptyHint('近期没有运行记录。'));
    if (gateEntries.length === 0) gates.appendChild(emptyHint('没有等待人工审核的门。'));
}

function emptyHint(text) {
    const div = document.createElement('div');
    div.className = 'board-empty';
    div.textContent = text;
    return div;
}

function renderWorkflowDefinitionCard(workflow) {
    const card = document.createElement('div');
    card.className = 'board-card';
    const title = document.createElement('strong');
    title.textContent = workflow.name || 'unknown';
    card.appendChild(title);
    if (workflow.description) {
        const desc = document.createElement('p');
        desc.className = 'board-card-desc';
        desc.textContent = workflow.description;
        card.appendChild(desc);
    }
    const meta = document.createElement('p');
    meta.className = 'board-card-meta';
    meta.textContent = `${typeof workflow.stepCount === 'number' ? workflow.stepCount : 0} 步`;
    card.appendChild(meta);
    if (workflow.name) {
        const actions = document.createElement('div');
        actions.className = 'board-card-actions';
        const launch = document.createElement('button');
        launch.type = 'button';
        launch.className = 'btn primary board-action';
        launch.textContent = '启动';
        launch.addEventListener('click', () => {
            setBoardStatus(`启动 ${workflow.name} 中…`);
            sendToHost({ type: 'request-workflow-launch', workflow: workflow.name, workspace: state.workspace || undefined });
        });
        actions.appendChild(launch);
        card.appendChild(actions);
    }
    return card;
}

function renderWorkflowRunCard(run) {
    const card = document.createElement('div');
    card.className = 'board-card selectable';
    card.dataset.status = run.status || 'unknown';
    if (run.id && run.id === state.selectedRunId) card.classList.add('selected');
    const title = document.createElement('strong');
    title.textContent = run.workflowName || run.id || 'unknown run';
    card.appendChild(title);
    const meta = document.createElement('p');
    meta.className = 'board-card-meta';
    meta.textContent = `${run.status || 'unknown'} · ${typeof run.stepCount === 'number' ? run.stepCount : 0} steps · ${run.id || ''}`;
    card.appendChild(meta);
    if (run.currentStepId) {
        const cur = document.createElement('p');
        cur.className = 'board-card-detail';
        cur.textContent = `current: ${run.currentStepId}${run.currentStepStatus ? ` (${run.currentStepStatus})` : ''}`;
        card.appendChild(cur);
    }
    if (run.id) card.addEventListener('click', () => selectRun(run.id));
    return card;
}

function renderWorkflowGateCard(gate) {
    const card = document.createElement('div');
    card.className = 'board-card board-gate selectable';
    if (state.selectedGate && state.selectedGate.runId === gate.runId && state.selectedGate.stepId === gate.stepId) {
        card.classList.add('selected');
    }
    const title = document.createElement('strong');
    title.textContent = `${gate.workflowName || 'workflow'} / ${gate.stepId || 'step'}`;
    card.appendChild(title);
    const meta = document.createElement('p');
    meta.className = 'board-card-meta';
    meta.textContent = `runId=${gate.runId || ''} · role=${gate.role || 'n/a'}`;
    card.appendChild(meta);
    if (gate.message) {
        const detail = document.createElement('p');
        detail.className = 'board-card-detail';
        detail.textContent = gate.message;
        card.appendChild(detail);
    }
    card.addEventListener('click', () => selectGate(gate));
    return card;
}

// ── run 选中 + 时间线 ──
function selectRun(runId) {
    state.selectedRunId = runId;
    state.deliveryRunId = '';
    // 选 run 时清掉与其它 run 绑定的 gate 焦点。
    if (state.selectedGate && state.selectedGate.runId !== runId) state.selectedGate = null;
    renderBoard();         // 刷新 selected 高亮
    renderGatePanel();
    renderDeliveryControls();
    if (!state.runs.has(runId)) {
        sendToHost({ type: 'request-workflow-run', runId, workspace: state.workspace || undefined });
    }
    renderTimeline();
    // 选中后拉一次 delivery 摘要。
    sendToHost({ type: 'request-delivery', runId, format: 'markdown', workspace: state.workspace || undefined });
}

function applyRunDetail(runId, run) {
    if (!run) return;
    state.runs.set(runId, run);
    if (state.selectedRunId === runId) renderTimeline();
}

function renderTimeline() {
    const empty = document.getElementById('timeline-empty');
    const steps = document.getElementById('timeline-steps');
    const title = document.getElementById('center-title');
    const chip = document.getElementById('center-status');
    const cancel = document.getElementById('run-cancel');
    if (!steps || !empty) return;

    const run = state.selectedRunId ? state.runs.get(state.selectedRunId) : null;
    if (!state.selectedRunId || !run) {
        empty.hidden = false;
        steps.hidden = true;
        steps.innerHTML = '';
        if (title) title.textContent = '工作流控制台';
        if (chip) { chip.textContent = ''; chip.removeAttribute('data-status'); }
        if (cancel) cancel.hidden = true;
        return;
    }

    empty.hidden = true;
    steps.hidden = false;
    if (title) title.textContent = run.workflowName || state.selectedRunId;
    if (chip) { chip.textContent = run.status || ''; chip.dataset.status = run.status || 'unknown'; }
    if (cancel) cancel.hidden = run.status !== 'running';

    steps.innerHTML = '';
    const list = Array.isArray(run.steps) ? run.steps : [];
    list.forEach((step) => steps.appendChild(renderStepRow(run, step)));
    if (list.length === 0) steps.appendChild(emptyHint('该运行暂无步骤记录。'));
}

function renderStepRow(run, step) {
    const row = document.createElement('div');
    row.className = 'step-row';
    row.dataset.status = step.status || 'pending';
    const head = document.createElement('div');
    head.className = 'step-head';
    const badge = document.createElement('span');
    badge.className = 'step-badge';
    head.appendChild(badge);
    const id = document.createElement('span');
    id.className = 'step-id';
    id.textContent = step.id || 'step';
    head.appendChild(id);
    const meta = document.createElement('span');
    meta.className = 'step-meta';
    const bits = [step.status || 'pending'];
    if (step.provider && step.provider !== 'local') bits.push(step.provider);
    if (step.role) bits.push(step.role);
    if (typeof step.exitCode === 'number') bits.push(`exit ${step.exitCode}`);
    meta.textContent = bits.join(' · ');
    head.appendChild(meta);
    row.appendChild(head);

    const key = `${run.id}:${step.id}`;
    const out = document.createElement('pre');
    out.className = 'step-output';
    out.hidden = !state.expandedSteps.has(key);
    renderStepOutputInto(out, step);
    row.appendChild(out);

    head.addEventListener('click', () => {
        if (state.expandedSteps.has(key)) state.expandedSteps.delete(key);
        else state.expandedSteps.add(key);
        out.hidden = !state.expandedSteps.has(key);
        renderStepOutputDetail(step);
    });
    return row;
}

function renderStepOutputInto(pre, step) {
    pre.innerHTML = '';
    const output = step.output || {};
    const stdout = output.stdout || '';
    const stderr = output.stderr || '';
    if (!stdout && !stderr) {
        pre.textContent = step.message || '（无输出）';
        return;
    }
    if (stdout) {
        const o = document.createElement('span');
        o.textContent = stdout;
        pre.appendChild(o);
    }
    if (stderr) {
        const e = document.createElement('span');
        e.className = 'stderr';
        e.textContent = (stdout ? '\n' : '') + stderr;
        pre.appendChild(e);
    }
    if (output.truncated) {
        const t = document.createElement('span');
        t.className = 'stderr';
        t.textContent = '\n（输出被截断）';
        pre.appendChild(t);
    }
}

function renderStepOutputDetail(step) {
    const pre = document.getElementById('step-output-detail');
    if (!pre) return;
    renderStepOutputInto(pre, step);
}

// ── 实时 run 事件 ──
// daemon 推 { action, runId, ... }；就地更新 state.runs 里对应 run 的 step 状态/输出。
function applyRunEvent(event) {
    if (!event || !event.runId) return;
    const runId = event.runId;
    let run = state.runs.get(runId);
    if (!run) {
        run = { id: runId, workflowName: event.workflowName || runId, status: 'running', steps: [] };
        state.runs.set(runId, run);
    }
    switch (event.action) {
        case 'run-start':
            run.status = 'running';
            if (event.workflowName) run.workflowName = event.workflowName;
            break;
        case 'step-start': {
            let step = run.steps.find((s) => s.id === event.stepId);
            if (!step) {
                step = { id: event.stepId, status: event.status || 'running', output: { stdout: '', stderr: '', truncated: false } };
                run.steps.push(step);
            } else {
                step.status = event.status || 'running';
            }
            if (event.tool) step.tool = event.tool;
            if (event.role) step.role = event.role;
            break;
        }
        case 'step-output': {
            const step = run.steps.find((s) => s.id === event.stepId);
            if (step) {
                if (!step.output) step.output = { stdout: '', stderr: '', truncated: false };
                const stream = event.stream === 'stderr' ? 'stderr' : 'stdout';
                step.output[stream] = (step.output[stream] || '') + (event.chunk || '');
                if (event.truncated) step.output.truncated = true;
            }
            break;
        }
        case 'step-finish': {
            const step = run.steps.find((s) => s.id === event.stepId);
            if (step) {
                step.status = event.status || step.status;
                if (typeof event.exitCode === 'number') step.exitCode = event.exitCode;
                if (event.message) step.message = event.message;
            }
            break;
        }
        case 'run-finish':
            run.status = event.status || run.status;
            // run 收尾后重拉一次 board，让 runs/gates 列表反映最终状态。
            requestBoard();
            break;
        default:
            break;
    }
    if (state.selectedRunId === runId) renderTimeline();
}

// ── 人工门决策 ──
function selectGate(gate) {
    state.selectedGate = gate ? { runId: gate.runId, stepId: gate.stepId, workflowName: gate.workflowName, role: gate.role } : null;
    // 选门时把中栏切到该 run 的时间线。
    if (gate && gate.runId) {
        state.selectedRunId = gate.runId;
        if (!state.runs.has(gate.runId)) {
            sendToHost({ type: 'request-workflow-run', runId: gate.runId, workspace: state.workspace || undefined });
        }
        renderTimeline();
        renderDeliveryControls();
    }
    renderBoard();
    renderGatePanel();
}

function renderGatePanel() {
    const panel = document.getElementById('gate-panel');
    const target = document.getElementById('gate-target');
    if (!panel) return;
    if (!state.selectedGate) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    if (target) {
        const g = state.selectedGate;
        target.textContent = `${g.workflowName || 'workflow'} / ${g.stepId}（runId=${g.runId}${g.role ? `, role=${g.role}` : ''}）`;
    }
}

function submitGateDecision(decision) {
    const g = state.selectedGate;
    if (!g) return;
    const constraintsEl = document.getElementById('gate-constraints');
    const messageEl = document.getElementById('gate-message');
    const constraints = constraintsEl
        ? constraintsEl.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        : [];
    const message = messageEl ? messageEl.value.trim() : '';
    setBoardStatus(`${decision} ${g.workflowName || ''}/${g.stepId} 中…`);
    sendToHost({
        type: 'request-gate-resolve',
        runId: g.runId,
        stepId: g.stepId,
        decision,
        workspace: state.workspace || undefined,
        message: message || undefined,
        constraints: constraints.length > 0 ? constraints : undefined,
    });
    // 提交后清掉门焦点；board 会在宿主完成后自动重拉。
    state.selectedGate = null;
    if (constraintsEl) constraintsEl.value = '';
    if (messageEl) messageEl.value = '';
    renderGatePanel();
}

// ── 交付摘要 ──
function renderDeliveryControls() {
    const md = document.getElementById('delivery-markdown');
    const ho = document.getElementById('delivery-handoff');
    const has = Boolean(state.selectedRunId);
    if (md) md.disabled = !has;
    if (ho) ho.disabled = !has;
}

function applyDelivery(runId, format, delivery) {
    const pre = document.getElementById('delivery-output');
    if (!pre) return;
    if (state.selectedRunId && runId !== state.selectedRunId) return;
    if (!delivery) {
        pre.textContent = '该运行还没有交付摘要（可能尚未跑完）。';
        return;
    }
    state.deliveryRunId = runId;
    pre.textContent = delivery.content || '（空）';
}

function requestDelivery(format) {
    if (!state.selectedRunId) return;
    setBoardStatus(`拉取 ${format} 交付摘要…`);
    sendToHost({ type: 'request-delivery', runId: state.selectedRunId, format, workspace: state.workspace || undefined });
}

// ── artifacts ──
function applyArtifacts(runId, artifacts) {
    const listEl = document.getElementById('artifact-list');
    const countEl = document.getElementById('artifact-count');
    if (!listEl) return;
    if (state.selectedRunId && runId !== state.selectedRunId) return;
    listEl.innerHTML = '';
    const items = Array.isArray(artifacts) ? artifacts : [];
    if (countEl) countEl.textContent = String(items.length);
    if (items.length === 0) {
        listEl.appendChild(emptyHint('暂无产物。'));
        return;
    }
    items.forEach((a) => {
        const card = document.createElement('div');
        card.className = 'board-card';
        const title = document.createElement('strong');
        title.textContent = `${a.type || 'artifact'}`;
        card.appendChild(title);
        const meta = document.createElement('p');
        meta.className = 'board-card-meta';
        meta.textContent = `${a.stepId ? `@${a.stepId}` : '@run'}${a.role ? ` · ${a.role}` : ''}`;
        card.appendChild(meta);
        if (a.title) {
            const detail = document.createElement('p');
            detail.className = 'board-card-detail';
            detail.textContent = a.title;
            card.appendChild(detail);
        }
        listEl.appendChild(card);
    });
}

// ── 动作结果 ──
function applyWorkflowActionResult(message) {
    const ok = message.ok === true;
    const action = message.action || 'action';
    if (!ok) {
        const err = message.body ? `：${typeof message.body === 'string' ? message.body : JSON.stringify(message.body)}` : '';
        setBoardStatus(`${action} 失败${err}`);
        return;
    }
    if (action === 'launch') setBoardStatus(`已启动 ${message.workflow || 'workflow'}（board 已刷新）`);
    else if (action === 'gate-resolve') setBoardStatus(`已 ${message.decision || 'resolve'} ${message.stepId || 'step'}（board 已刷新）`);
    else if (action === 'cancel') setBoardStatus(`已请求取消 ${message.runId || ''}`);
    else setBoardStatus(`${action} 完成`);
}

// ── 消息分发 ──
function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
        case 'connection-status':
            updateConnectionStatus(message.connected);
            break;
        case 'workflow-board':
            applyWorkflowBoard(message.board, message.error);
            break;
        case 'workflow-run':
            applyRunDetail(message.runId, message.run);
            break;
        case 'workflow-run-event':
            applyRunEvent(message.event || message);
            break;
        case 'workflow-delivery':
            applyDelivery(message.runId, message.format, message.delivery);
            break;
        case 'workflow-artifacts':
            applyArtifacts(message.runId, message.artifacts);
            break;
        case 'workflow-action-result':
            applyWorkflowActionResult(message);
            break;
        default:
            // 重建后控制台不再处理监听态消息；未知类型静默忽略。
            break;
    }
}

// ── 绑定 ──
function bindControls() {
    const apply = document.getElementById('workspace-apply');
    const clear = document.getElementById('workspace-clear');
    const input = document.getElementById('workspace-input');
    if (apply && input) apply.addEventListener('click', () => applyWorkspace(input.value));
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyWorkspace(input.value); });
    if (clear && input) clear.addEventListener('click', () => { input.value = ''; applyWorkspace(''); });

    const cancel = document.getElementById('run-cancel');
    if (cancel) cancel.addEventListener('click', () => {
        if (state.selectedRunId) sendToHost({ type: 'request-run-cancel', runId: state.selectedRunId });
    });

    const approve = document.getElementById('gate-approve');
    const retry = document.getElementById('gate-retry');
    const reject = document.getElementById('gate-reject');
    if (approve) approve.addEventListener('click', () => submitGateDecision('approve'));
    if (retry) retry.addEventListener('click', () => submitGateDecision('retry'));
    if (reject) reject.addEventListener('click', () => submitGateDecision('reject'));

    const md = document.getElementById('delivery-markdown');
    const ho = document.getElementById('delivery-handoff');
    if (md) md.addEventListener('click', () => requestDelivery('markdown'));
    if (ho) ho.addEventListener('click', () => requestDelivery('handoff'));
}

function initApp() {
    loadRecentWorkspaces();
    bindControls();
    updateConnectionStatus(false);
    renderTimeline();
    renderGatePanel();
    renderDeliveryControls();
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest('a[href]');
        if (anchor && shouldInterceptAnchor(anchor)) {
            event.preventDefault();
            sendToHost({ type: 'open-external', href: anchor.getAttribute('href') });
        }
    });
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener('message', (event) => handleMessage(event.data));
    }
    sendToHost({ type: 'ready' });
    requestBoard();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// 测试钩子：jsdom 下暴露内部函数与 state，供 chatWorkflowConsole.test.mjs 断言。
const api = { updateConnectionStatus, handleMessage };
if (typeof window !== 'undefined' && window.CODEPANION_TEST === true) {
    api.__test = {
        state,
        applyWorkflowBoard,
        renderBoard,
        selectRun,
        applyRunDetail,
        renderTimeline,
        applyRunEvent,
        selectGate,
        submitGateDecision,
        applyDelivery,
        applyArtifacts,
        applyWorkspace,
        applyWorkflowActionResult,
        handleMessage,
        generateId,
        shouldInterceptAnchor,
    };
}
if (typeof window !== 'undefined') {
    window.CODEPANION = api;
}
