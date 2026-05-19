# CodePanion 文档中心

欢迎来到 CodePanion 文档中心！这里包含了围绕“本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面”所需的文档资源。

当前战略采用《AI IDE 个人本地工作流控制台市场分析与 CodePanion 策略报告》的核心判断：保留现有 Windows Alpha 产品和本地 daemon 架构，不推倒重做；把现有提醒、多源监控和 workflow 模型收束为本地控制平面。旧路线报告已从仓库中清理，当前路线以 [产品路线](PRODUCT_ROADMAP.md)、[架构设计](ARCHITECTURE.md)、[监控源说明](MONITORING_SOURCES.md) 和根目录 [开发任务清单](../DEVELOPMENT_TASKS.md) 为准。

## 📚 文档导航

### 🚀 快速开始

- **[README.md](../README.md)** - 项目概述和快速开始指南
- **[INSTALL.md](../INSTALL.md)** - 详细的安装指南（Windows/macOS/Linux）
- **[用户指南](USER_GUIDE.md)** - 完整的使用教程和最佳实践

### 🏗️ 开发文档

- **[架构设计](ARCHITECTURE.md)** - 系统架构和设计决策
- **[开发指南](DEVELOPMENT.md)** - 开发环境设置和贡献指南
- **[API 文档](API.md)** - HTTP/WebSocket API 参考
- **[监控源说明](MONITORING_SOURCES.md)** - CLI、VS Code 和外部适配器的能力边界
- **[产品路线](PRODUCT_ROADMAP.md)** - 报告策略、现有产品保留决策、Alpha/Beta/GA 演进路线
- **[重新设计文档](REDESIGN.md)** - 架构重构和改进计划

### 📋 战略依据

- **外部研究报告** - `D:\Owen\Documents\OneDrive\桌面\CodePanion_report.md`，作为当前定位、工具优先级、商业化和风险策略的主要依据
- **研究报告 PDF** - `D:\Owen\Documents\OneDrive\桌面\AI IDE 个人本地工作流控制台市场分析与 CodePanion 策略报告.pdf`

### 📦 发布文档

- **[更新日志](../CHANGELOG.md)** - 版本历史和变更记录
- **[开发任务清单](../DEVELOPMENT_TASKS.md)** - 当前阶段验收、质量门禁和验证记录

### 📦 组件文档

- **[GUI 文档](../packages/gui/README.md)** - 图形界面使用说明
- **[GUI 图标说明](../packages/gui/icon-README.md)** - 应用图标设计

---

## 📖 按角色查找文档

### 👤 我是新用户

1. 从 [README.md](../README.md) 开始了解项目
2. 按照 [INSTALL.md](../INSTALL.md) 安装 CodePanion
3. 阅读 [用户指南](USER_GUIDE.md) 学习使用方法

### 👨‍💻 我是开发者

1. 阅读 [架构设计](ARCHITECTURE.md) 了解系统结构
2. 查看 [开发指南](DEVELOPMENT.md) 设置开发环境
3. 参考 [API 文档](API.md) 进行集成开发
4. 阅读 [监控源说明](MONITORING_SOURCES.md) 理解多源事件模型

### 🔧 我想贡献代码

1. 阅读 [开发指南](DEVELOPMENT.md) 了解开发流程
2. 查看 [架构设计](ARCHITECTURE.md) 理解系统设计
3. 按 [开发任务清单](../DEVELOPMENT_TASKS.md) 和 [开发指南](DEVELOPMENT.md#开发工作流) 运行当前质量门禁
4. 提交 Pull Request

### 📊 我想了解项目状态

1. 先看 [产品路线](PRODUCT_ROADMAP.md) 了解当前定位、产品保留决策和方向
2. 再看 [架构设计](ARCHITECTURE.md) 与 [开发指南](DEVELOPMENT.md) 了解当前实现边界
3. 如需了解战略依据，再查看桌面上的 CodePanion 研究报告
4. 阅读 [更新日志](../CHANGELOG.md) 了解版本历史

---

## 🎯 按主题查找文档

### 安装和配置

- [安装指南](../INSTALL.md) - 完整的安装步骤
- [用户指南 - 配置](USER_GUIDE.md#配置) - 配置选项说明
- [故障排查](../INSTALL.md#故障排查) - 常见问题解决

### 使用方法

- [用户指南 - 快速开始](USER_GUIDE.md#快速开始) - 基本使用流程
- [用户指南 - 使用场景](USER_GUIDE.md#使用场景) - 实际应用示例
- [用户指南 - 命令参考](USER_GUIDE.md#命令参考) - CLI 命令详解

### 开发和集成

- [架构设计](ARCHITECTURE.md) - 系统架构说明
- [API 文档](API.md) - API 接口参考
- [开发指南](DEVELOPMENT.md) - 开发环境和流程
- [监控源说明](MONITORING_SOURCES.md) - 多窗口/多来源监控接入

### 测试和质量

- [开发任务清单](../DEVELOPMENT_TASKS.md) - 当前质量缺口、验收标准和验证记录

---

## 🔍 快速链接

### 常见问题

- [如何安装 CodePanion？](../INSTALL.md)
- [命令未找到怎么办？](../README.md#常见问题)
- [GUI 无法连接？](../INSTALL.md#问题-3-gui-无法连接)
- [提示检测不工作？](../INSTALL.md#问题-5-提示检测不工作)

### 核心概念

- [什么是 CodePanion？](USER_GUIDE.md#什么是-codepanion)
- [产品路线](PRODUCT_ROADMAP.md)
- [工作原理](ARCHITECTURE.md#核心组件)
- [控制平面语义](API.md#控制平面语义)
- [监控源能力分层](MONITORING_SOURCES.md#能力分层)
- [提示检测机制](ARCHITECTURE.md#提示检测)
- [会话管理](ARCHITECTURE.md#会话管理)

### API 参考

- [HTTP API](API.md#http-api)
- [WebSocket API](API.md#websocket-api)
- [配置文件格式](USER_GUIDE.md#配置)

---

## 📝 文档贡献

发现文档问题或想要改进？

1. 在 [GitHub Issues](https://github.com/Vantalens/CodePanion/issues) 提交反馈
2. 提交 Pull Request 改进文档
3. 所有文档使用 Markdown 格式
4. 遵循现有的文档结构和风格

---

## 📞 获取帮助

- **GitHub Issues**: https://github.com/Vantalens/CodePanion/issues
- **文档问题**: 在相关文档页面提交 Issue
- **功能建议**: 在 Issues 中标记为 `enhancement`

---

## 📅 文档更新

- **最后更新**: 2026-05-19
- **版本**: v0.2.0
- **维护者**: CodePanion Team

---

**祝你使用愉快！** 🎉

