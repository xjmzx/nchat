// nchat — a private, multi-identity Nostr messenger for the ndisc suite.
//
// Design in one paragraph: the webview is treated as untrusted. Every secret
// key lives in the OS keychain and is read only inside Rust, for the moment it
// takes to sign an event or open a gift wrap. The IPC surface below deals in
// public keys and plaintext only — there is no command that returns an nsec,
// and adding one would defeat the point. Messages are rendered only from keys
// on an explicit whitelist; anything else is counted and dropped unread.

mod chat;
mod probe;
mod secrets;
mod store;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use store::{Config, Contact, Identity};

/// Where nchat.json lives. Secrets never go here — see secrets.rs.
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("no config directory available: {e}"))
}

fn read_config(app: &AppHandle) -> Result<Config, String> {
    store::load(&config_dir(app)?)
}

fn write_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    store::save(&config_dir(app)?, cfg)
}

/// Everything the UI needs to draw itself, in one round trip.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    identities: Vec<Identity>,
    contacts: Vec<Contact>,
    relays: Vec<String>,
    active_identity: Option<String>,
    /// `null` when the OS credential store is healthy, else why it is not.
    keychain_error: Option<String>,
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<AppState, String> {
    let cfg = read_config(&app)?;
    Ok(AppState {
        identities: cfg.identities,
        contacts: cfg.contacts,
        relays: cfg.relays,
        active_identity: cfg.active_identity,
        keychain_error: secrets::store_available().err(),
    })
}

// ---------------------------------------------------------------- identities

/// Add an identity. With `nsec` empty a fresh keypair is generated; the secret
/// goes straight to the keychain and is never returned to the caller.
#[tauri::command]
fn add_identity(app: AppHandle, label: String, nsec: String) -> Result<Identity, String> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err("give the identity a label".into());
    }

    let (secret, npub, pubkey) = if nsec.trim().is_empty() {
        chat::generate_keypair()?
    } else {
        let (npub, pubkey) = chat::public_from_secret(&nsec)?;
        (nsec.trim().to_string(), npub, pubkey)
    };

    let mut cfg = read_config(&app)?;
    if cfg.identities.iter().any(|i| i.pubkey == pubkey) {
        return Err("that key is already loaded as an identity".into());
    }

    // A random handle, not the pubkey: relabelling or re-importing the same
    // key should never collide with a stale keychain entry.
    let id = format!("id-{}", uuid_like());
    secrets::put(&id, &secret)?;

    let identity = Identity {
        id: id.clone(),
        label,
        npub,
        pubkey,
    };
    cfg.identities.push(identity.clone());
    if cfg.active_identity.is_none() {
        cfg.active_identity = Some(id);
    }
    write_config(&app, &cfg)?;
    Ok(identity)
}

#[tauri::command]
fn remove_identity(app: AppHandle, id: String) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.identities.retain(|i| i.id != id);
    if cfg.active_identity.as_deref() == Some(id.as_str()) {
        cfg.active_identity = cfg.identities.first().map(|i| i.id.clone());
    }
    write_config(&app, &cfg)?;
    // Config first: an orphaned keychain entry is harmless, an identity whose
    // key vanished while it still shows in the list is not.
    secrets::delete(&id)
}

#[tauri::command]
fn set_active_identity(app: AppHandle, id: String) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    if !cfg.identities.iter().any(|i| i.id == id) {
        return Err("no such identity".into());
    }
    cfg.active_identity = Some(id);
    write_config(&app, &cfg)
}

// ------------------------------------------------------------------ contacts

#[tauri::command]
fn add_contact(app: AppHandle, key: String, petname: String) -> Result<Contact, String> {
    let petname = petname.trim().to_string();
    if petname.is_empty() {
        return Err("give the contact a petname".into());
    }
    let (npub, pubkey) = chat::normalise_pubkey(&key)?;

    let mut cfg = read_config(&app)?;
    if cfg.contacts.iter().any(|c| c.pubkey == pubkey) {
        return Err("that key is already a contact".into());
    }
    let contact = Contact {
        pubkey,
        npub,
        petname,
        note: None,
    };
    cfg.contacts.push(contact.clone());
    write_config(&app, &cfg)?;
    Ok(contact)
}

#[tauri::command]
fn remove_contact(app: AppHandle, pubkey: String) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.contacts.retain(|c| c.pubkey != pubkey);
    write_config(&app, &cfg)
}

// -------------------------------------------------------------------- relays

#[tauri::command]
fn set_relays(app: AppHandle, relays: Vec<String>) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.relays = relays
        .into_iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    write_config(&app, &cfg)
}

// ------------------------------------------------------------------ messages

#[tauri::command]
async fn fetch_inbox(app: AppHandle, identity_id: String) -> Result<chat::InboxPage, String> {
    let cfg = read_config(&app)?;
    let whitelist: Vec<String> = cfg.contacts.iter().map(|c| c.pubkey.clone()).collect();
    let nsec = secrets::get(&identity_id)?;
    chat::fetch_inbox(&cfg.relays, &nsec, &whitelist, 500).await
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    identity_id: String,
    recipient: String,
    text: String,
) -> Result<chat::SendReport, String> {
    if text.trim().is_empty() {
        return Err("nothing to send".into());
    }
    let cfg = read_config(&app)?;
    // Sending is whitelist-bound too, so a mistyped key cannot quietly become
    // a message to a stranger.
    if !cfg.contacts.iter().any(|c| c.pubkey == recipient) {
        return Err("recipient is not a contact — add them to the whitelist first".into());
    }
    let nsec = secrets::get(&identity_id)?;
    chat::send_dm(&cfg.relays, &nsec, &recipient, &text).await
}

/// Small random handle for identity ids. Not a real UUID and does not need to
/// be — it only has to be unique within one config file.
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_state,
            add_identity,
            remove_identity,
            set_active_identity,
            add_contact,
            remove_contact,
            set_relays,
            fetch_inbox,
            send_message,
            probe::probe_relay,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
