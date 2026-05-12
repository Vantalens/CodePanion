#!/bin/bash

# RemindAI 端到端自动化测试

echo "=========================================="
echo "RemindAI 端到端测试"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
TOKEN="0e10e3e76bef55837e0a272f8be14a14"

test_step() {
    echo -e "${YELLOW}[测试]${NC} $1"
}

test_pass() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}[✗]${NC} $1"
    ((FAILED++))
}

# 1. 验证 daemon 运行
echo "1. 验证 Daemon 状态"
echo "----------------------------------------"

test_step "检查 daemon 是否运行"
STATUS=$(node packages/daemon/dist/index.js status 2>&1)
if echo "$STATUS" | grep -q "running"; then
    test_pass "Daemon 正在运行"
    PID=$(echo "$STATUS" | grep -oP 'pid=\K[0-9]+')
    PORT=$(echo "$STATUS" | grep -oP 'port=\K[0-9]+')
    echo "   PID: $PID, Port: $PORT"
else
    test_fail "Daemon 未运行"
    exit 1
fi

# 2. 测试 HTTP API
echo ""
echo "2. 测试 HTTP API"
echo "----------------------------------------"

test_step "GET /sessions"
SESSIONS=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:$PORT/sessions)
if [ $? -eq 0 ]; then
    test_pass "API 可访问"
    echo "   当前会话数: $(echo $SESSIONS | jq '. | length' 2>/dev/null || echo '0')"
else
    test_fail "API 不可访问"
fi

# 3. 测试 WebSocket 连接（模拟）
echo ""
echo "3. 测试 WebSocket 端点"
echo "----------------------------------------"

test_step "检查 WebSocket 端点"
# 尝试连接 WebSocket（简单检查端口是否监听）
if nc -z localhost $PORT 2>/dev/null; then
    test_pass "WebSocket 端口可访问"
else
    test_fail "WebSocket 端口不可访问"
fi

# 4. 测试命令执行（后台）
echo ""
echo "4. 测试命令执行"
echo "----------------------------------------"

test_step "运行简单命令"
OUTPUT=$(node packages/daemon/dist/index.js run -- echo "Hello RemindAI" 2>&1)
if [ $? -eq 0 ]; then
    test_pass "命令执行成功"
    echo "   输出: $(echo $OUTPUT | head -1)"
else
    test_fail "命令执行失败"
fi

# 5. 检查会话创建
echo ""
echo "5. 检查会话管理"
echo "----------------------------------------"

test_step "等待会话注册"
sleep 1

test_step "查询会话列表"
SESSIONS=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:$PORT/sessions)
SESSION_COUNT=$(echo $SESSIONS | jq '. | length' 2>/dev/null || echo '0')

if [ "$SESSION_COUNT" -gt 0 ]; then
    test_pass "会话已创建 (数量: $SESSION_COUNT)"

    # 获取第一个会话的详情
    SESSION_ID=$(echo $SESSIONS | jq -r '.[0].id' 2>/dev/null)
    if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ]; then
        echo "   会话 ID: $SESSION_ID"

        # 获取会话输出
        test_step "获取会话输出"
        OUTPUT=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:$PORT/sessions/$SESSION_ID/output)
        if [ $? -eq 0 ]; then
            test_pass "会话输出可访问"
            echo "   输出长度: $(echo $OUTPUT | wc -c) 字节"
        else
            test_fail "会话输出不可访问"
        fi
    fi
else
    test_fail "未检测到会话"
fi

# 6. 测试配置加载
echo ""
echo "6. 测试配置系统"
echo "----------------------------------------"

test_step "检查配置文件"
if [ -f ~/.remindai/config.json ]; then
    test_pass "配置文件存在"

    CONFIG_PORT=$(cat ~/.remindai/config.json | jq -r '.port' 2>/dev/null)
    CONFIG_TOKEN=$(cat ~/.remindai/config.json | jq -r '.token' 2>/dev/null)

    echo "   配置端口: $CONFIG_PORT"
    echo "   Token: ${CONFIG_TOKEN:0:8}..."

    if [ "$CONFIG_PORT" == "$PORT" ]; then
        test_pass "端口配置匹配"
    else
        test_fail "端口配置不匹配"
    fi
else
    test_fail "配置文件不存在"
fi

# 7. 测试 GUI 构建产物
echo ""
echo "7. 测试 GUI 构建"
echo "----------------------------------------"

test_step "检查 GUI 可执行文件"
if [ -f "packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.dll" ]; then
    test_pass "GUI 已构建"
else
    test_fail "GUI 未构建"
fi

test_step "检查 WebView2 资源"
if [ -f "packages/gui/bin/Debug/net8.0-windows/wwwroot/chat.html" ]; then
    test_pass "WebView2 资源已复制"
else
    test_fail "WebView2 资源未复制"
fi

test_step "检查声音资源目录"
if [ -d "packages/gui/bin/Debug/net8.0-windows/Assets" ]; then
    test_pass "Assets 目录已创建"
else
    test_fail "Assets 目录未创建"
fi

# 总结
echo ""
echo "=========================================="
echo "测试总结"
echo "=========================================="
echo -e "${GREEN}通过: $PASSED${NC}"
echo -e "${RED}失败: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ 所有测试通过！${NC}"
    echo ""
    echo "下一步："
    echo "1. 手动启动 GUI: packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe"
    echo "2. 验证 WebView2 加载"
    echo "3. 测试交互式命令"
    exit 0
else
    echo -e "${RED}✗ 有测试失败${NC}"
    exit 1
fi
