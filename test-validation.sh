#!/bin/bash

# RemindAI 功能验证测试脚本

echo "=========================================="
echo "RemindAI 功能验证测试"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 测试函数
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

# 1. 检查构建产物
echo ""
echo "1. 检查构建产物"
echo "----------------------------------------"

test_step "检查 daemon 构建产物"
if [ -f "packages/daemon/dist/cli/index.js" ]; then
    test_pass "daemon CLI 已构建"
else
    test_fail "daemon CLI 未找到"
fi

if [ -f "packages/daemon/dist/daemon/server.js" ]; then
    test_pass "daemon server 已构建"
else
    test_fail "daemon server 未找到"
fi

test_step "检查 GUI 构建产物"
if [ -f "packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.dll" ]; then
    test_pass "GUI 已构建"
else
    test_fail "GUI 未找到"
fi

if [ -f "packages/gui/bin/Debug/net8.0-windows/wwwroot/chat.html" ]; then
    test_pass "WebView2 资源已复制"
else
    test_fail "WebView2 资源未找到"
fi

# 2. 检查 daemon 启动
echo ""
echo "2. 测试 daemon 启动"
echo "----------------------------------------"

test_step "启动 daemon"
node packages/daemon/dist/cli/index.js start > /dev/null 2>&1
sleep 2

test_step "检查 daemon 状态"
STATUS_OUTPUT=$(node packages/daemon/dist/cli/index.js status 2>&1)
if echo "$STATUS_OUTPUT" | grep -q "running"; then
    test_pass "daemon 正在运行"
else
    test_fail "daemon 未运行"
    echo "$STATUS_OUTPUT"
fi

# 3. 检查 HTTP API
echo ""
echo "3. 测试 HTTP API"
echo "----------------------------------------"

test_step "测试 GET /sessions"
HTTP_RESPONSE=$(curl -s http://localhost:3721/sessions)
if [ $? -eq 0 ]; then
    test_pass "HTTP API 可访问"
    echo "   响应: $HTTP_RESPONSE"
else
    test_fail "HTTP API 不可访问"
fi

# 4. 检查配置文件
echo ""
echo "4. 检查配置"
echo "----------------------------------------"

test_step "检查 package.json"
if [ -f "packages/daemon/package.json" ]; then
    VERSION=$(node -p "require('./packages/daemon/package.json').version")
    test_pass "daemon 版本: $VERSION"
else
    test_fail "package.json 未找到"
fi

# 5. 停止 daemon
echo ""
echo "5. 清理"
echo "----------------------------------------"

test_step "停止 daemon"
node packages/daemon/dist/cli/index.js stop > /dev/null 2>&1
sleep 1

STATUS_OUTPUT=$(node packages/daemon/dist/cli/index.js status 2>&1)
if echo "$STATUS_OUTPUT" | grep -q "not running"; then
    test_pass "daemon 已停止"
else
    test_fail "daemon 停止失败"
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
    exit 0
else
    echo -e "${RED}✗ 有测试失败${NC}"
    exit 1
fi
