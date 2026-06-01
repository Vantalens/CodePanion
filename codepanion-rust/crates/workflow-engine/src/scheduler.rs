use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{CodePanionError, Result};

/// Run priority level
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RunPriority {
    Low = 0,
    #[default]
    Normal = 1,
    High = 2,
    Urgent = 3,
}

/// Run status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Scheduled run
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledRun {
    pub run_id: String,
    pub project_id: String,
    pub workflow_id: String,
    pub priority: RunPriority,
    pub status: RunStatus,
    pub queued_at: u64,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
}

/// Scheduler configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    /// Maximum concurrent runs
    pub max_concurrent_runs: usize,
    /// Maximum queued runs (0 = unlimited)
    pub max_queue_size: usize,
    /// Enable priority scheduling
    pub enable_priority: bool,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_concurrent_runs: 3,
            max_queue_size: 100,
            enable_priority: true,
        }
    }
}

/// Global run scheduler
pub struct RunScheduler {
    config: SchedulerConfig,
    queue: Arc<Mutex<VecDeque<ScheduledRun>>>,
    running: Arc<Mutex<HashMap<String, ScheduledRun>>>,
    completed: Arc<Mutex<Vec<ScheduledRun>>>,
}

impl RunScheduler {
    /// Create a new scheduler
    pub fn new(config: SchedulerConfig) -> Self {
        Self {
            config,
            queue: Arc::new(Mutex::new(VecDeque::new())),
            running: Arc::new(Mutex::new(HashMap::new())),
            completed: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Enqueue a new run
    pub fn enqueue(
        &self,
        run_id: String,
        project_id: String,
        workflow_id: String,
        priority: RunPriority,
    ) -> Result<()> {
        let mut queue = self.queue.lock().unwrap();

        // Check queue size limit
        if self.config.max_queue_size > 0 && queue.len() >= self.config.max_queue_size {
            return Err(CodePanionError::InvalidInput(format!(
                "Queue is full (max: {})",
                self.config.max_queue_size
            )));
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let run = ScheduledRun {
            run_id,
            project_id,
            workflow_id,
            priority,
            status: RunStatus::Queued,
            queued_at: now,
            started_at: None,
            completed_at: None,
            error: None,
        };

        // Insert based on priority
        if self.config.enable_priority {
            let insert_pos = queue
                .iter()
                .position(|r| r.priority < priority)
                .unwrap_or(queue.len());
            queue.insert(insert_pos, run);
        } else {
            queue.push_back(run);
        }

        Ok(())
    }

    /// Dequeue the next run to execute
    pub fn dequeue(&self) -> Option<ScheduledRun> {
        let mut queue = self.queue.lock().unwrap();
        let mut running = self.running.lock().unwrap();

        // Check if we can start a new run
        if running.len() >= self.config.max_concurrent_runs {
            return None;
        }

        if let Some(run) = queue.pop_front() {
            // Move to running state
            running.insert(run.run_id.clone(), run.clone());
            Some(run)
        } else {
            None
        }
    }

    /// Mark a run as started
    pub fn start_run(&self, run_id: &str) -> Result<()> {
        let mut running = self.running.lock().unwrap();

        if let Some(run) = running.get_mut(run_id) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            run.status = RunStatus::Running;
            run.started_at = Some(now);
            Ok(())
        } else {
            Err(CodePanionError::NotFound(format!(
                "Run not found: {}",
                run_id
            )))
        }
    }

    /// Mark a run as completed
    pub fn complete_run(&self, run_id: &str, error: Option<String>) -> Result<()> {
        let mut running = self.running.lock().unwrap();
        let mut completed = self.completed.lock().unwrap();

        if let Some(mut run) = running.remove(run_id) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            run.completed_at = Some(now);
            run.status = if error.is_some() {
                RunStatus::Failed
            } else {
                RunStatus::Completed
            };
            run.error = error;

            completed.push(run);
            Ok(())
        } else {
            Err(CodePanionError::NotFound(format!(
                "Run not found: {}",
                run_id
            )))
        }
    }

    /// Cancel a run
    pub fn cancel_run(&self, run_id: &str) -> Result<()> {
        // Try to remove from queue first
        {
            let mut queue = self.queue.lock().unwrap();
            if let Some(pos) = queue.iter().position(|r| r.run_id == run_id) {
                let mut run = queue.remove(pos).unwrap();
                run.status = RunStatus::Cancelled;

                let mut completed = self.completed.lock().unwrap();
                completed.push(run);
                return Ok(());
            }
        }

        // Try to cancel running run
        {
            let mut running = self.running.lock().unwrap();
            if let Some(mut run) = running.remove(run_id) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;

                run.status = RunStatus::Cancelled;
                run.completed_at = Some(now);

                let mut completed = self.completed.lock().unwrap();
                completed.push(run);
                return Ok(());
            }
        }

        Err(CodePanionError::NotFound(format!(
            "Run not found: {}",
            run_id
        )))
    }

    /// Pause a running run
    pub fn pause_run(&self, run_id: &str) -> Result<()> {
        let mut running = self.running.lock().unwrap();

        if let Some(run) = running.get_mut(run_id) {
            if run.status != RunStatus::Running {
                return Err(CodePanionError::InvalidInput(format!(
                    "Run {} is not running (status: {:?})",
                    run_id, run.status
                )));
            }

            run.status = RunStatus::Paused;
            Ok(())
        } else {
            Err(CodePanionError::NotFound(format!(
                "Run not found: {}",
                run_id
            )))
        }
    }

    /// Resume a paused run
    pub fn resume_run(&self, run_id: &str) -> Result<()> {
        let mut running = self.running.lock().unwrap();

        if let Some(run) = running.get_mut(run_id) {
            if run.status != RunStatus::Paused {
                return Err(CodePanionError::InvalidInput(format!(
                    "Run {} is not paused (status: {:?})",
                    run_id, run.status
                )));
            }

            run.status = RunStatus::Running;
            Ok(())
        } else {
            Err(CodePanionError::NotFound(format!(
                "Run not found: {}",
                run_id
            )))
        }
    }

    /// Get all queued runs
    pub fn list_queued(&self) -> Vec<ScheduledRun> {
        let queue = self.queue.lock().unwrap();
        queue.iter().cloned().collect()
    }

    /// Get all running runs
    pub fn list_running(&self) -> Vec<ScheduledRun> {
        let running = self.running.lock().unwrap();
        running.values().cloned().collect()
    }

    /// Get all completed runs
    pub fn list_completed(&self) -> Vec<ScheduledRun> {
        let completed = self.completed.lock().unwrap();
        completed.clone()
    }

    /// Get all runs (queued + running + completed)
    pub fn list_all(&self) -> Vec<ScheduledRun> {
        let mut all = Vec::new();
        all.extend(self.list_queued());
        all.extend(self.list_running());
        all.extend(self.list_completed());
        all
    }

    /// Get runs by project
    pub fn list_by_project(&self, project_id: &str) -> Vec<ScheduledRun> {
        self.list_all()
            .into_iter()
            .filter(|r| r.project_id == project_id)
            .collect()
    }

    /// Get a specific run
    pub fn get_run(&self, run_id: &str) -> Option<ScheduledRun> {
        // Check queue
        {
            let queue = self.queue.lock().unwrap();
            if let Some(run) = queue.iter().find(|r| r.run_id == run_id) {
                return Some(run.clone());
            }
        }

        // Check running
        {
            let running = self.running.lock().unwrap();
            if let Some(run) = running.get(run_id) {
                return Some(run.clone());
            }
        }

        // Check completed
        {
            let completed = self.completed.lock().unwrap();
            if let Some(run) = completed.iter().find(|r| r.run_id == run_id) {
                return Some(run.clone());
            }
        }

        None
    }

    /// Get scheduler statistics
    pub fn get_stats(&self) -> SchedulerStats {
        let queue = self.queue.lock().unwrap();
        let running = self.running.lock().unwrap();
        let completed = self.completed.lock().unwrap();

        SchedulerStats {
            queued_count: queue.len(),
            running_count: running.len(),
            completed_count: completed.len(),
            max_concurrent_runs: self.config.max_concurrent_runs,
            max_queue_size: self.config.max_queue_size,
        }
    }

    /// Clear completed runs
    pub fn clear_completed(&self) {
        let mut completed = self.completed.lock().unwrap();
        completed.clear();
    }
}

/// Scheduler statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStats {
    pub queued_count: usize,
    pub running_count: usize,
    pub completed_count: usize,
    pub max_concurrent_runs: usize,
    pub max_queue_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enqueue_dequeue() {
        let scheduler = RunScheduler::new(SchedulerConfig::default());

        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        let run = scheduler.dequeue().unwrap();
        assert_eq!(run.run_id, "run-1");
        assert_eq!(run.status, RunStatus::Queued);
    }

    #[test]
    fn test_priority_scheduling() {
        let scheduler = RunScheduler::new(SchedulerConfig::default());

        // Enqueue with different priorities
        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Low,
            )
            .unwrap();

        scheduler
            .enqueue(
                "run-2".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::High,
            )
            .unwrap();

        scheduler
            .enqueue(
                "run-3".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        // High priority should be dequeued first
        let run1 = scheduler.dequeue().unwrap();
        assert_eq!(run1.run_id, "run-2");
        assert_eq!(run1.priority, RunPriority::High);

        // Normal priority next
        let run2 = scheduler.dequeue().unwrap();
        assert_eq!(run2.run_id, "run-3");
        assert_eq!(run2.priority, RunPriority::Normal);

        // Low priority last
        let run3 = scheduler.dequeue().unwrap();
        assert_eq!(run3.run_id, "run-1");
        assert_eq!(run3.priority, RunPriority::Low);
    }

    #[test]
    fn test_max_concurrent_runs() {
        let config = SchedulerConfig {
            max_concurrent_runs: 2,
            ..Default::default()
        };
        let scheduler = RunScheduler::new(config);

        // Enqueue 3 runs
        for i in 1..=3 {
            scheduler
                .enqueue(
                    format!("run-{}", i),
                    "project-1".to_string(),
                    "workflow-1".to_string(),
                    RunPriority::Normal,
                )
                .unwrap();
        }

        // Can dequeue 2 runs
        assert!(scheduler.dequeue().is_some());
        assert!(scheduler.dequeue().is_some());

        // Third run should wait
        assert!(scheduler.dequeue().is_none());

        let stats = scheduler.get_stats();
        assert_eq!(stats.queued_count, 1);
    }

    #[test]
    fn test_cancel_queued_run() {
        let scheduler = RunScheduler::new(SchedulerConfig::default());

        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        scheduler.cancel_run("run-1").unwrap();

        let completed = scheduler.list_completed();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].status, RunStatus::Cancelled);
    }

    #[test]
    fn test_pause_resume() {
        let scheduler = RunScheduler::new(SchedulerConfig::default());

        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        let run = scheduler.dequeue().unwrap();
        scheduler.running.lock().unwrap().insert(run.run_id.clone(), run);

        scheduler.start_run("run-1").unwrap();
        scheduler.pause_run("run-1").unwrap();

        let running = scheduler.list_running();
        assert_eq!(running[0].status, RunStatus::Paused);

        scheduler.resume_run("run-1").unwrap();

        let running = scheduler.list_running();
        assert_eq!(running[0].status, RunStatus::Running);
    }

    #[test]
    fn test_list_by_project() {
        let scheduler = RunScheduler::new(SchedulerConfig::default());

        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        scheduler
            .enqueue(
                "run-2".to_string(),
                "project-2".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        let project1_runs = scheduler.list_by_project("project-1");
        assert_eq!(project1_runs.len(), 1);
        assert_eq!(project1_runs[0].run_id, "run-1");
    }

    #[test]
    fn test_queue_size_limit() {
        let config = SchedulerConfig {
            max_queue_size: 2,
            ..Default::default()
        };
        let scheduler = RunScheduler::new(config);

        scheduler
            .enqueue(
                "run-1".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        scheduler
            .enqueue(
                "run-2".to_string(),
                "project-1".to_string(),
                "workflow-1".to_string(),
                RunPriority::Normal,
            )
            .unwrap();

        // Third enqueue should fail
        let result = scheduler.enqueue(
            "run-3".to_string(),
            "project-1".to_string(),
            "workflow-1".to_string(),
            RunPriority::Normal,
        );

        assert!(result.is_err());
    }
}
