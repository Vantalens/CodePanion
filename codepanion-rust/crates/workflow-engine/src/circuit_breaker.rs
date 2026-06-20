use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Circuit breaker prevents infinite error loops by tracking repeated failures
/// within a time window. After N identical errors within the window, it trips
/// and signals the agent to stop.
///
/// Features:
/// - Time-windowed error tracking (errors older than window are discarded)
/// - Automatic recovery when errors stop occurring
/// - Per-error-type tracking
pub struct CircuitBreaker {
    /// Maps error signature to timestamps of recent occurrences
    error_timestamps: HashMap<String, VecDeque<Instant>>,
    /// Number of identical errors within time_window before tripping
    threshold: usize,
    /// Time window for error tracking (default: 60 seconds)
    time_window: Duration,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with specified threshold and time window.
    ///
    /// # Arguments
    /// * `threshold` - Number of identical errors within time_window before tripping (default: 3)
    /// * `time_window` - Duration of the sliding time window (default: 60 seconds)
    pub fn new(threshold: usize) -> Self {
        Self::with_time_window(threshold, Duration::from_secs(60))
    }

    /// Create a circuit breaker with custom time window.
    pub fn with_time_window(threshold: usize, time_window: Duration) -> Self {
        Self {
            error_timestamps: HashMap::new(),
            threshold,
            time_window,
        }
    }

    /// Record an error and check if circuit should trip.
    ///
    /// # Arguments
    /// * `error_signature` - A string representing the error type/message
    ///
    /// # Returns
    /// * `true` if circuit has tripped (should stop execution)
    /// * `false` if execution can continue
    pub fn record_error(&mut self, error_signature: String) -> bool {
        let now = Instant::now();
        let timestamps = self
            .error_timestamps
            .entry(error_signature)
            .or_insert_with(VecDeque::new);

        // Remove errors outside the time window
        while let Some(&oldest) = timestamps.front() {
            if now.duration_since(oldest) > self.time_window {
                timestamps.pop_front();
            } else {
                break;
            }
        }

        // Record new error
        timestamps.push_back(now);

        // Check if threshold exceeded
        timestamps.len() >= self.threshold
    }

    /// Reset the circuit breaker (clear all error counts).
    pub fn reset(&mut self) {
        self.error_timestamps.clear();
    }

    /// Get current error count for a specific signature within the time window.
    pub fn get_count(&self, error_signature: &str) -> usize {
        self.error_timestamps
            .get(error_signature)
            .map(|ts| ts.len())
            .unwrap_or(0)
    }

    /// Check if circuit would trip for the next error of this type (without recording).
    pub fn would_trip(&self, error_signature: &str) -> bool {
        self.get_count(error_signature) >= self.threshold - 1
    }

    /// Clean up old timestamps across all error types.
    /// This is called automatically during record_error, but can be called
    /// manually for periodic cleanup.
    pub fn cleanup_old_errors(&mut self) {
        let now = Instant::now();
        let time_window = self.time_window;

        self.error_timestamps.retain(|_, timestamps| {
            // Remove old timestamps
            while let Some(&oldest) = timestamps.front() {
                if now.duration_since(oldest) > time_window {
                    timestamps.pop_front();
                } else {
                    break;
                }
            }
            // Keep entry if there are still recent errors
            !timestamps.is_empty()
        });
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(3)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn test_circuit_breaker_trips_after_threshold() {
        let mut breaker = CircuitBreaker::new(3);
        let error = "Connection timeout".to_string();

        assert!(!breaker.record_error(error.clone())); // Count: 1
        assert!(!breaker.record_error(error.clone())); // Count: 2
        assert!(breaker.record_error(error.clone()));  // Count: 3, trip!
    }

    #[test]
    fn test_different_errors_tracked_separately() {
        let mut breaker = CircuitBreaker::new(3);
        let error1 = "Connection timeout".to_string();
        let error2 = "File not found".to_string();

        breaker.record_error(error1.clone());
        breaker.record_error(error1.clone());
        breaker.record_error(error2.clone());
        breaker.record_error(error2.clone());

        // Neither should trip yet (each only at 2)
        assert_eq!(breaker.get_count(&error1), 2);
        assert_eq!(breaker.get_count(&error2), 2);

        // error1 trips on third occurrence
        assert!(breaker.record_error(error1.clone())); // error1 trips now
    }

    #[test]
    fn test_reset_clears_counts() {
        let mut breaker = CircuitBreaker::new(3);
        let error = "Connection timeout".to_string();

        breaker.record_error(error.clone());
        breaker.record_error(error.clone());
        assert_eq!(breaker.get_count(&error), 2);

        breaker.reset();
        assert_eq!(breaker.get_count(&error), 0);
        assert!(!breaker.record_error(error.clone())); // Should not trip
    }

    #[test]
    fn test_get_count() {
        let mut breaker = CircuitBreaker::new(5);
        let error = "Test error".to_string();

        assert_eq!(breaker.get_count(&error), 0);
        breaker.record_error(error.clone());
        assert_eq!(breaker.get_count(&error), 1);
        breaker.record_error(error.clone());
        assert_eq!(breaker.get_count(&error), 2);
    }

    #[test]
    fn test_would_trip() {
        let mut breaker = CircuitBreaker::new(3);
        let error = "Test error".to_string();

        assert!(!breaker.would_trip(&error)); // Count: 0
        breaker.record_error(error.clone());
        assert!(!breaker.would_trip(&error)); // Count: 1
        breaker.record_error(error.clone());
        assert!(breaker.would_trip(&error));  // Count: 2, next would trip
    }

    #[test]
    fn test_threshold_one() {
        let mut breaker = CircuitBreaker::new(1);
        let error = "Immediate fail".to_string();

        assert!(breaker.record_error(error.clone())); // Trips immediately
    }

    #[test]
    fn test_time_window_expiry() {
        let mut breaker = CircuitBreaker::with_time_window(3, Duration::from_millis(100));
        let error = "Test error".to_string();

        // Record 2 errors
        breaker.record_error(error.clone());
        breaker.record_error(error.clone());
        assert_eq!(breaker.get_count(&error), 2);

        // Wait for time window to expire
        sleep(Duration::from_millis(150));

        // Old errors should be cleaned up on next record
        breaker.record_error(error.clone());
        assert_eq!(breaker.get_count(&error), 1); // Only the new one
    }

    #[test]
    fn test_time_window_sliding() {
        let mut breaker = CircuitBreaker::with_time_window(3, Duration::from_millis(200));
        let error = "Test error".to_string();

        breaker.record_error(error.clone()); // t=0
        sleep(Duration::from_millis(100));
        breaker.record_error(error.clone()); // t=100
        sleep(Duration::from_millis(100));
        breaker.record_error(error.clone()); // t=200

        // At t=200, first error (t=0) should be outside window
        assert_eq!(breaker.get_count(&error), 2); // t=100 and t=200
    }

    #[test]
    fn test_cleanup_removes_old_errors() {
        let mut breaker = CircuitBreaker::with_time_window(3, Duration::from_millis(50));
        let error = "Test error".to_string();

        breaker.record_error(error.clone());
        assert_eq!(breaker.error_timestamps.len(), 1);

        sleep(Duration::from_millis(100));
        breaker.cleanup_old_errors();

        // Old error type should be removed entirely
        assert_eq!(breaker.error_timestamps.len(), 0);
    }

    #[test]
    fn test_multiple_errors_with_time_window() {
        let mut breaker = CircuitBreaker::with_time_window(2, Duration::from_millis(100));
        let error1 = "Error A".to_string();
        let error2 = "Error B".to_string();

        breaker.record_error(error1.clone());
        breaker.record_error(error2.clone());

        sleep(Duration::from_millis(150));

        // Both should expire - cleanup happens on next record_error
        breaker.record_error(error1.clone());
        assert_eq!(breaker.get_count(&error1), 1); // Only the new one after expiry

        // error2 was not refreshed, but get_count doesn't auto-cleanup
        // It only returns the raw count; cleanup happens in record_error
        breaker.cleanup_old_errors();
        assert_eq!(breaker.get_count(&error2), 0); // Now cleaned up
    }
}
