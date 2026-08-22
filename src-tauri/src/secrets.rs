// Secret-key storage.
//
// The whole point of this module is a boundary: an identity's nsec is written
// to the OS credential store and read back only inside Rust, at the moment an
// event is signed or a gift wrap is opened. It is never returned over the
// Tauri IPC bridge and never reaches the webview. Gossip makes the case
// plainly — clients have leaked private keys through browser tech — and since
// nchat *is* built on a webview, the key simply must not live there.
//
// Platform store (keyring `v1`): Keychain on macOS, Credential Manager on
// Windows, Secret Service on Linux.

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "uk.fizx.nchat";

fn entry(identity_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, identity_id).map_err(|e| match e {
        KeyringError::NoDefaultStore => {
            "no OS credential store available (on Linux, is a Secret Service \
             provider such as gnome-keyring running?)"
                .to_string()
        }
        other => format!("keychain unavailable: {other}"),
    })
}

/// Store an identity's secret key. Overwrites any existing entry.
pub fn put(identity_id: &str, nsec: &str) -> Result<(), String> {
    entry(identity_id)?
        .set_password(nsec)
        .map_err(|e| format!("could not write key to the keychain: {e}"))
}

/// Read an identity's secret key back out.
pub fn get(identity_id: &str) -> Result<String, String> {
    match entry(identity_id)?.get_password() {
        Ok(v) => Ok(v),
        Err(KeyringError::NoEntry) => Err(
            "no key in the keychain for this identity — it may have been removed outside nchat"
                .to_string(),
        ),
        Err(e) => Err(format!("could not read key from the keychain: {e}")),
    }
}

/// Remove an identity's secret key. Missing is not an error — removing an
/// identity should succeed even if its key is already gone.
pub fn delete(identity_id: &str) -> Result<(), String> {
    match entry(identity_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not delete key from the keychain: {e}")),
    }
}

/// Whether the OS credential store came up at all. Surfaced in the UI so a
/// broken keychain is a visible condition rather than a mystery on first save.
pub fn store_available() -> Result<(), String> {
    match Entry::store_status() {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("{e}")),
    }
}
