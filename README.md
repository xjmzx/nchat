# nchat

A small, private Nostr messenger — part of the **ndisc** suite. Multi-identity,
whitelist-only, built on NIP-17 gift wrap.

It is deliberately *not* a social client. There is no feed, no global timeline
and no follow graph. It talks to a short list of keys you name yourself, which
is what keeps both the trust model and the code small.

## Why gift wrap

A NIP-04 direct message hides the body and nothing else. The sender, the
recipient and the true timestamp are all public, and because the ciphertext is
unpadded even its *length* is informative — a daily alert from a server can be
read as "one problem" or "two problems" without ever decrypting it.

NIP-17 fixes that by nesting three events:

| layer | kind | what it does |
|---|---|---|
| rumor | 14 | the message. Never signed, never published on its own |
| seal | 13 | rumor, NIP-44 encrypted to the receiver, signed by the real sender |
| wrap | 1059 | seal, encrypted again and signed by a **throwaway** key, timestamp randomised by up to 2 days |

An observer sees an unknown one-time key publishing something for a recipient,
at a time that is not the real one.

Two consequences worth knowing:

- **Sort by the inner rumor's `created_at`.** The wrap's timestamp is jittered
  on purpose; ordering by it scrambles every conversation.
- **Gift wraps cannot be filtered by sender.** You fetch every 1059 addressed
  to you and trial-decrypt.

Legacy NIP-04 is still **read** (never written), so existing correspondents —
including the suite's cert/domain expiry bots — keep working while they migrate.

## Keys

nchat is built on a webview, and Gossip is right that this is a real attack
surface for a client that holds private keys. The answer here is a hard
boundary rather than a promise:

- Secret keys go to the **OS credential store** (Keychain / Credential Manager
  / Secret Service) and are read only inside Rust, for the moment it takes to
  sign an event or open a wrap.
- **No IPC command returns a secret key.** The webview only ever handles public
  keys and plaintext.
- Message bodies are rendered as text, never as markup, under a strict CSP.

Identities are separate keypairs with a shared relay set and whitelist. Each
message is signed by, and decrypted for, exactly the selected identity.

## The whitelist

nchat renders messages from keys on the contact list and no others. Anything
else is counted and dropped unread — the footer shows how many. Sending is
whitelist-bound too, so a mistyped key cannot quietly become a message to a
stranger.

## Relay diagnostics

The connect / subscribe / NIP-11 probe from [nping](../nping) is built in, and
every send reports **per-relay delivery confirmation**. A relay that accepts
the connection, advertises no restriction and then silently discards the write
is a real and observed failure mode; nchat shows it rather than reporting a
cheerful "sent".

## Stack

Tauri 2 + React + Vite + Tailwind (the suite stack), `nostr-sdk` 0.45 for the
protocol, `keyring` for the credential store. TLS is rustls throughout, so
there is no system OpenSSL dependency.

## Develop

```sh
make deps     # npm install + cargo fetch
make dev      # tauri dev (hot reload)
make icons    # regenerate the bundle icon set from icon.svg
make build    # release binary
make install  # install binary + .desktop under ~/.local
make check    # typecheck + cargo check
```

On Linux, the credential store needs a Secret Service provider (gnome-keyring
or similar) running; nchat surfaces a banner when it cannot reach one.

## Status

v0.1.0-beta.1 — first cut. Identities, whitelist, NIP-17 send/receive with
legacy NIP-04 read, relay health, per-relay delivery confirmation.

Not yet: background sync (messages arrive on **Sync**, not push), NIP-46
remote signers, contact petname publishing, message search.
