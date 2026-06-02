# CodePanion Documentation

[English](README.md) | [简体中文](README.zh-CN.md)

CodePanion's current product line is a **local-first, vendor-neutral AI development workspace for individual developers**.

This documentation entry focuses on the current local AI workflow direction: task decomposition, role collaboration, explicit executors, human review gates, and product artifact delivery. Older listener, passive monitoring, source-ingestion, audit-log, and historical design drafts are no longer the primary documentation path.

## Main Entries

- [Project Overview](../README.md)
- [Product Positioning Contract](POSITIONING.md)
- [Local AI Workflow Design](LOCAL_AI_WORKFLOW.md)
- [Product Roadmap](PRODUCT_ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
- [API Documentation](API.md)
- [Installation and Build](INSTALL.md)
- [Current Development Tasks](../DEVELOPMENT_TASKS.md)

## Recommended Reading Order

1. Start with [Product Positioning Contract](POSITIONING.md) to understand why CodePanion no longer follows the listener/monitoring route.
2. Read [Local AI Workflow Design](LOCAL_AI_WORKFLOW.md) to understand workspaces, roles, workflows, human gates, artifacts, and executors.
3. Read [Product Roadmap](PRODUCT_ROADMAP.md) for Alpha / Beta / GA priorities.
4. Before development, read [Architecture](ARCHITECTURE.md), [Development Guide](DEVELOPMENT.md), and [Current Development Tasks](../DEVELOPMENT_TASKS.md).

## Boundaries

- `source`, legacy adapters, and historical integration code may remain as compatibility layers, but they are no longer the design center of the product.
- New capabilities should prioritize workflow executors, role permissions, human gates, and the artifact loop.
- If future documentation reintroduces listener, passive state collection, or process-identification behavior, [Product Positioning Contract](POSITIONING.md) must be updated first.

## Documentation Status

- Last updated: 2026-06-02
- Current phase: Rust-first local AI workflow and multi-agent development workspace
