// reconstructed module: rollout_tracker
// evidence:
// - symbols: RolloutTracker::new/watch_loop/watch_path/process_rollouts/find_rollout_path/discover_rollout_path/observe_request_payload/drain_rollout_file
// - strings: rollout watcher error, native-turn-ended, turnEnded, session_id, turn_id
// confidence: high

use crate::protocol::{TurnEndedEvent, EVENT_NATIVE_TURN_ENDED};
use serde_json::Value;
use std::{collections::HashMap, fs, path::{Path, PathBuf}, time::{Duration, SystemTime}};
use tokio::sync::mpsc;

pub struct RolloutTracker {
    watched: HashMap<String, PathBuf>,
    events: mpsc::Sender<TurnEndedEvent>,
}

impl RolloutTracker {
    pub fn new(events: mpsc::Sender<TurnEndedEvent>) -> Self { Self { watched: HashMap::new(), events } }

    pub fn observe_request_payload(&mut self, payload: &Value) {
        let session_id = payload.get("session_id").or_else(|| payload.get("sessionId")).and_then(Value::as_str);
        if let Some(session_id) = session_id {
            if let Some(path) = self.find_rollout_path(payload) { self.watched.insert(session_id.to_string(), path); }
        }
    }

    pub async fn watch_loop(&mut self) {
        loop {
            let paths: Vec<(String, PathBuf)> = self.watched.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            for (session_id, path) in paths {
                if let Ok(Some(event)) = self.process_rollouts(&session_id, &path).await { let _ = self.events.send(event).await; }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    async fn process_rollouts(&self, session_id: &str, path: &Path) -> std::io::Result<Option<TurnEndedEvent>> {
        let Some(text) = drain_rollout_file(path)? else { return Ok(None); };
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        let turn_id = value.get("turn_id").or_else(|| value.get("turnId")).and_then(Value::as_str).unwrap_or("unknown-turn").to_string();
        Ok(Some(TurnEndedEvent { session_id: session_id.to_string(), turn_id, runtime_session_id: None, metadata: Default::default() }))
    }

    fn find_rollout_path(&self, payload: &Value) -> Option<PathBuf> {
        payload.get("rolloutPath").or_else(|| payload.pointer("/runtimeConfig/rolloutPath")).and_then(Value::as_str).map(PathBuf::from)
    }
}

pub fn drain_rollout_file(path: &Path) -> std::io::Result<Option<String>> {
    if !path.exists() { return Ok(None); }
    let meta = fs::metadata(path)?;
    if meta.modified().unwrap_or(SystemTime::UNIX_EPOCH) == SystemTime::UNIX_EPOCH { return Ok(None); }
    let text = fs::read_to_string(path)?;
    if text.trim().is_empty() { Ok(None) } else { Ok(Some(text)) }
}

pub fn turn_ended_notification(event: &TurnEndedEvent) -> Value {
    serde_json::json!({ "method": EVENT_NATIVE_TURN_ENDED, "params": event })
}
