# Changelog

## Unreleased

- **Messages arrive without pressing Sync.** The inbox is fetched once as soon
  as an identity is available, and then on a timer — 30s / 1m / 5m, or manual
  only, cycled from the header and remembered. A background tick will not stack
  a second fetch on one already in flight.
- **Unread means unread.** The per-contact badge counts messages that arrived
  since you last had that conversation open, per identity, rather than every
  message the other party has ever sent; a total sits in the footer. Read state
  is keyed by identity because the same peer under a different key is a
  different conversation.
- **Tones on send and receive**, mutable from the header. Still synthesised
  rather than shipped as audio files — a WAV is assembled in memory at first
  use — but played through an **HTMLMediaElement**, not Web Audio, which is
  broken on WebKit2GTK: the audio thread emits frames that never reach the
  sound card, silently. `nsmpl` and `ntree` both hit it and both landed here,
  and SUITE.md records it as a suite convention. The CSP gains `media-src
  'self' blob:` and nothing else. The first sync after launch is deliberately
  silent: it would otherwise announce the entire backlog. The send tone fires
  only once at least one relay has confirmed, so it means "it went", not "you
  pressed the button".
- **Releases build for macOS too.** `release.yml` gains an arm64 macOS job
  producing a `.dmg` alongside the existing Linux `.deb`/`.AppImage`, both
  publishing to the same tag. Two jobs because a Tauri app cannot be
  cross-compiled between the two — each needs its own platform's WebKit. Still
  unsigned, so Gatekeeper refuses the first launch until the app is opened from
  the context menu.
- **Copy your npub from the identity picker.** It is the one thing you must
  hand a correspondent before anything works, and the selector shows only a
  truncation — reading it previously meant opening `nchat.json`. Public key
  only; the no-secrets-in-the-webview boundary is unchanged.
- **Readable identity list on Linux.** The popup a `<select>` opens is drawn by
  the platform and never sees the classes on the element, so under a light GTK
  theme the keys rendered near-white on near-white. `color-scheme: dark` tells
  the engine what the page is; explicit `<option>` colours cover builds that
  ignore it.

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
