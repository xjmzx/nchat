// On-disk configuration: identities (public halves only), the contact
// whitelist, and the relay set.
//
// Secrets are deliberately absent — this file is plain JSON and is expected to
// be readable. An Identity here carries the npub and hex pubkey; the matching
// nsec lives in the OS keychain under the identity's id (see secrets.rs).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// One local identity. `id` is a stable opaque handle used as the keychain
/// account name, so relabelling an identity never orphans its key.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub label: String,
    pub npub: String,
    /// Hex public key — the form filters and tags use.
    pub pubkey: String,
}

/// A whitelisted correspondent. nchat only renders messages from keys on this
/// list; everything else is counted and dropped unread. That is the whole
/// trust model, and it is deliberately manual — a small, known set of people
/// and bots rather than an open inbox.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub pubkey: String,
    pub npub: String,
    pub petname: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub identities: Vec<Identity>,
    #[serde(default)]
    pub contacts: Vec<Contact>,
    #[serde(default = "default_relays")]
    pub relays: Vec<String>,
    #[serde(default)]
    pub active_identity: Option<String>,
}

fn default_relays() -> Vec<String> {
    vec![
        "wss://relay.damus.io".to_string(),
        "wss://nos.lol".to_string(),
        "wss://relay.primal.net".to_string(),
    ]
}

impl Default for Config {
    fn default() -> Self {
        Self {
            identities: Vec::new(),
            contacts: Vec::new(),
            relays: default_relays(),
            active_identity: None,
        }
    }
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join("nchat.json")
}

/// Read the config, falling back to defaults when absent. A malformed file is
/// an error rather than a silent reset — quietly discarding someone's contact
/// whitelist would be worse than refusing to start.
pub fn load(dir: &Path) -> Result<Config, String> {
    let path = config_path(dir);
    if !path.exists() {
        return Ok(Config::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{} is malformed: {e}", path.display()))
}

pub fn save(dir: &Path, cfg: &Config) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = config_path(dir);
    let body = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("could not serialise config: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("could not write {}: {e}", path.display()))
}
