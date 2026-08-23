# Changelog

## Unreleased

- **macOS install path.** `./install.sh` (or `npm run install:app`) builds the
  `.app` bundle and installs it to `/Applications`, quitting and relaunching a
  running copy. `make install` is the Linux layout — a bare binary plus a
  `.desktop` entry, matching `make build`'s `--no-bundle` — and now refuses on
  macOS with a pointer rather than installing something subtly wrong. The
  difference is not cosmetic: an unbundled binary has no bundle identifier, and
  the Keychain decides who may read an entry by code identity.
- **Keychain commands no longer block the UI.** `add_identity` and
  `remove_identity` are `async`, so they run on the async runtime rather than
  the main thread. A Tauri command that is not `async` runs on the thread
  driving the webview, and the credential store may put a modal in front of any
  call to it — on macOS, routinely, because an unsigned app is re-signed on each
  rebuild and is no longer the caller the entry's ACL trusts. Blocked there, the
  dialog takes the whole UI down with it. The reads (`fetch_inbox`,
  `send_message`) were already async and are unchanged.

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

- Offline test suite (`make test`) covering the gift-wrap round trip: the
  recipient recovers the true sender, the wrap is signed by a throwaway key,
  a third party cannot open it, the self-copy stays readable, and the rumor
  carries the true send time while the wrap's is jittered.

Tauri 2 + React + Vite + Tailwind; `nostr-sdk` 0.45, `keyring` 4, rustls.
