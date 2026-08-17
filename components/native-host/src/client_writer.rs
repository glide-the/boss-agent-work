// reconstructed module: client_writer
// evidence:
// - symbols: ClientWriter, ClientWriterRegistry, run_writer, enqueue, broadcast, send_to, remove, evict_if_same
// - strings: client writers mutex poisoned, extension-host-writer-, extension-host-disconnect
// confidence: high

use crate::protocol::ClientId;
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{mpsc, RwLock};

const DEFAULT_QUEUE_CAPACITY: usize = 128;

#[derive(Clone)]
pub struct ClientWriterRegistry {
    writers: Arc<RwLock<HashMap<ClientId, ClientWriterHandle>>>,
}

#[derive(Clone)]
pub struct ClientWriterHandle {
    sender: mpsc::Sender<Value>,
    generation: u64,
}

impl ClientWriterRegistry {
    pub fn new() -> Self { Self { writers: Arc::new(RwLock::new(HashMap::new())) } }

    pub async fn register(&self, client_id: ClientId, generation: u64) -> mpsc::Receiver<Value> {
        let (sender, receiver) = mpsc::channel(DEFAULT_QUEUE_CAPACITY);
        self.writers.write().await.insert(client_id, ClientWriterHandle { sender, generation });
        receiver
    }

    pub async fn enqueue(&self, client_id: &str, message: Value) -> Result<(), ClientWriterError> {
        self.send_to(client_id, message).await
    }

    pub async fn send_to(&self, client_id: &str, message: Value) -> Result<(), ClientWriterError> {
        let sender = self.writers.read().await.get(client_id).map(|h| h.sender.clone());
        match sender {
            Some(tx) => tx.send(message).await.map_err(|_| ClientWriterError::Disconnected(client_id.to_string())),
            None => Err(ClientWriterError::Missing(client_id.to_string())),
        }
    }

    pub async fn broadcast(&self, message: Value) -> usize {
        let writers = self.writers.read().await.clone();
        let mut sent = 0;
        for (_client_id, handle) in writers {
            if handle.sender.send(message.clone()).await.is_ok() { sent += 1; }
        }
        sent
    }

    pub async fn remove(&self, client_id: &str) -> bool {
        self.writers.write().await.remove(client_id).is_some()
    }

    pub async fn evict_if_same(&self, client_id: &str, generation: u64) -> bool {
        let mut writers = self.writers.write().await;
        if writers.get(client_id).map(|h| h.generation) == Some(generation) {
            writers.remove(client_id);
            true
        } else { false }
    }
}

#[derive(Debug)]
pub enum ClientWriterError { Missing(String), Disconnected(String) }

impl std::fmt::Display for ClientWriterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing(id) => write!(f, "client writer not found: {id}"),
            Self::Disconnected(id) => write!(f, "client writer disconnected: {id}"),
        }
    }
}
impl std::error::Error for ClientWriterError {}
