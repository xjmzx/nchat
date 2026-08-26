# nchat — private direct messages

> Part of the **n-suite**. Shared conventions, the Nostr wire contract, the
> design language, and the roadmap live in the hub doc:
> **[ndisc/SUITE.md](https://github.com/xjmzx/ndisc/blob/main/SUITE.md)**
> (locally: `../ndisc/SUITE.md`). This file covers **nchat** specifically.

`nchat` is the suite's **messenger**: a small, whitelist-only client for
NIP-17 gift-wrapped direct messages. It is deliberately *not* a social client —
no feed, no global timeline, no follow graph.

It exists because of a concrete failure. The suite's cert- and domain-expiry
bots fired daily for weeks with nobody logged in anywhere to read them; alerts
that nothing receives are not alerts. `nchat` is the receiving end.

## What it does
- **NIP-17 private direct messages** — rumor (14) → seal (13) → wrap (1059),
  so the sender and the true send time stay off the wire, not just the body.
- **Multi-identity.** Several keypairs share one relay set and whitelist; each
  message is signed by, and decrypted for, the selected identity only.
- **Whitelist-only inbox.** Messages from keys that are not contacts are
  counted and dropped unread. Sending is whitelist-bound too, so a mistyped key
  cannot quietly become a message to a stranger.
- **Per-relay delivery confirmation** on every send. A relay that accepts the
  connection, advertises no restriction and then silently discards the write is
  a real and observed failure mode; `nchat` shows it rather than reporting a
  cheerful "sent".
- **Polls for new mail** — once at launch, then every 30s / 1m / 5m, or manual
  only. Tones on send and receive, muteable.
- Reads **legacy NIP-04** (never writes it) so correspondents that have not
  migrated — the expiry bots among them — keep working.

## Tech stack & build
Tauri 2 · React + Vite + TypeScript · Rust backend. `nostr-sdk` 0.45 for the
protocol, `keyring` 4 for the credential store, `tungstenite`/`ureq` for
`nping`'s relay probe. rustls throughout, so there is no system OpenSSL
dependency. **No database of any kind.**

`make dev` / `make check` / `make test`. Installing differs by platform, and
the difference is not cosmetic: `make install` is the Linux layout (bare binary
plus a `.desktop` entry), while macOS needs `./install.sh` to build a real
`.app` — the Keychain keys its ACLs off code identity, and an unbundled binary
has no bundle identifier.

## Suite integration
- **Receives** what the suite's bots emit. That is the whole integration; it
  neither reads nor writes the catalogue contract.
- **Does not use the shared suite directory.** `published.json` / `catalogue.json`
  / `bpm.json` are for apps that share a library view; `nchat` shares nothing.
  Its own config is `nchat.json` in the app config dir, holding public keys,
  petnames and relays — never a secret.
- Borrows `nping`'s connect / subscribe / NIP-11 probe, which is also where the
  shell was scaffolded from.

## Nostr surface
Kinds **1059 / 13 / 14** (NIP-17, read and write) and **4** (NIP-04, read
only). These sit **outside the catalogue spine** — `nchat` publishes no
`31237` / `31238` / `31239` and reads none, so a contract wave never touches it.

Three consequences of gift wrap that any reader of this code needs:

- **Sort by the inner rumor's `created_at`.** The wrap's own timestamp is
  randomised backwards by up to two days on purpose; ordering by it scrambles
  every conversation. Relays and explorers will therefore report an event as up
  to 48h older than it is, which is the design working, not a bug.
- **Gift wraps cannot be filtered by sender.** You fetch every 1059 addressed
  to you and trial-decrypt.
- **There is no relay-authoritative time.** The only timestamp a relay sees is
  the fake one, so ordering rests on the senders' own clocks and skew between
  machines reorders a conversation directly.

**Signing.** Local `nsec` in the OS keychain, like `ndisc` / `ntree` / `nsmpl`.
`nchat` is the deliberate exception to the suite's *one key per person* rule —
see SUITE.md for why multiple identities are the point here rather than a
lapse.

**Keys never enter the webview.** Secrets are read only inside Rust, for the
moment it takes to sign an event or open a wrap; no IPC command returns a
secret key, and adding one would defeat the design. Strict CSP; message bodies
are rendered as React children, never as markup.

## Styling notes
Shared design language (fizx palette by default, upleb via the title toggle;
squared boxes). Three panes: whitelist, conversation, relay panel.

## Backlog & direction
- **Real push.** Messages arrive on a poll, not a subscription — a long-lived
  relay subscription would replace it and remove the latency floor.
- **`limit(500)` vs jittered timestamps.** The relay applies that limit against
  the *tweaked* wrap timestamp, so "the 500 most recent wraps" is not the same
  set as your 500 most recent messages. Harmless now; it will surface as
  quietly missing messages once an inbox is busy.
- OS notifications; NIP-46 remote signers; contact petname publishing; message
  search.
