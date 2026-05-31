import type { WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';

// 监听路线下线后，WorkflowManager 退化为纯 run-event 事件总线：
// daemon 内 runWorkflow 通过 emitRunEvent 把 workflow-run-event 推到订阅者（WS observer / CLI watch）。
// 旧的 session/handoff 派生 snapshot/threads/items + 持久化全部移除。
type WorkflowListener = (event: WsServerEvent) => void;

export class WorkflowManager {
  private listeners = new Set<WorkflowListener>();

  onEvent(listener: WorkflowListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 让 daemon 内部 runWorkflow（启动 / W-32 续跑）把进度推到 listener 总线上，
   * GUI / CLI 通过 onEvent 订阅 workflow-run-event 实时拿到 run 进度，不必 polling 历史文件。
   */
  emitRunEvent(event: Extract<WsServerEvent, { type: 'workflow-run-event' }>['event']): void {
    this.broadcast({ type: 'workflow-run-event', event });
  }

  private broadcast(event: WsServerEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'workflow listener failed');
      }
    }
  }
}
