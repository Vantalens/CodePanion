# CodePanion 文档中心

[English](README.md) | [简体中文](README.zh-CN.md)

CodePanion 当前路线是：**本地优先、供应商中立、面向个人开发者的 AI 开发工作台**。

本文档入口聚焦当前本地 AI 工作流主线：任务拆分、角色协作、显式 executor、人工审核门和产品产出归档。旧的监听、被动监控、source 接入、审计日志和历史设计草案不再是主要文档路径。

## 当前入口

- [项目概述](../README.zh-CN.md)
- [产品定位契约](POSITIONING.md)
- [本地 AI 工作流设计](LOCAL_AI_WORKFLOW.md)
- [产品路线](PRODUCT_ROADMAP.md)
- [架构设计](ARCHITECTURE.md)
- [开发指南](DEVELOPMENT.md)
- [API 文档](API.md)
- [安装与构建](INSTALL.md)
- [当前开发任务](../DEVELOPMENT_TASKS.md)

## 阅读顺序

1. 先读 [产品定位契约](POSITIONING.md)，确认 CodePanion 不再走监听/监控路线。
2. 再读 [本地 AI 工作流设计](LOCAL_AI_WORKFLOW.md)，理解 workspace、role、workflow、human gate、artifact 和 executor。
3. 接着读 [产品路线](PRODUCT_ROADMAP.md)，确认 Alpha / Beta / GA 的优先级。
4. 开发前读 [架构设计](ARCHITECTURE.md)、[开发指南](DEVELOPMENT.md) 和 [当前开发任务](../DEVELOPMENT_TASKS.md)。

## 保留边界

- `source`、旧适配器和历史接入代码可以作为兼容层存在，但不再是新产品路线的设计中心。
- 新能力优先围绕 workflow executor、角色权限、人工审核门和 artifact loop 建模。
- 后续文档若重新引入监听、被动状态采集或进程识别，必须先更新 [产品定位契约](POSITIONING.md)。

## 文档状态

- 最后更新：2026-06-02
- 当前阶段：Rust-first 本地 AI 工作流和多 Agent 开发工作台
