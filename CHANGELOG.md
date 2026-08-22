# Changelog

## v0.1.0-beta.1

First release. A private, multi-identity Nostr messenger for the ndisc suite.

- **NIP-17 gift-wrapped direct messages** (rumor → seal → wrap), so the sender
  and the true send time stay off the wire. Legacy NIP-04 is read but never
  written, keeping existing correspondents working during migration.
- **Multi-identity.** Several keypairs share one relay set and whitelist; each
  message is signed by and decrypted for the selected identity only.
- **Whitelist-only inbox.** Messages from keys that are not contacts are
  counted and dropped unread. Sending is whitelist-bound too.
- **Keys never enter the webview.** Secrets live in the OS credential store
  (Keychain / Credential Manager / Secret Service) and are read only inside
  Rust at sign/unwrap time. No IPC command returns a secret key. Strict CSP,
  message bodies rendered as text and never as markup.
- **Per-relay delivery confirmation** on every send, plus nping's
  connect/subscribe/NIP-11 probe built in.
- Conversations sort by the **inner rumor timestamp** — the gift wrap's own
  `created_at` is randomised by design and would scramble the order.

Tauri 2 + React + Vite + Tailwind; `nostr-sdk` 0.45, `keyring` 4, rustls.
