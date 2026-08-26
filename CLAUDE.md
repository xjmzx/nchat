# nchat — notes for Claude

Private, whitelist-only Nostr messenger built on NIP-17 gift wrap. Tauri 2 ·
React. See [`nchat-introduction.md`](nchat-introduction.md) for the fuller
picture.

## Read SUITE.md first

[`../ndisc/SUITE.md`](https://github.com/xjmzx/ndisc/blob/main/SUITE.md) is
authoritative for anything shared across the suite. Read it **before making a
platform-sensitive choice** — it records constraints invisible on the machine
you are working on.

This repo is the cautionary tale. The send/receive tones were written with Web
Audio, worked first time on macOS, and were silent on Linux. SUITE.md already
said Web Audio output is broken on WebKit2GTK. Three more walls sat behind it,
each producing the identical symptom of silence with no error: WebKitGTK grants
only **transient** user activation, so a `play()` seconds after the last gesture
is refused; it **pins media-element volume at ~0.1** and overwrites what the
page sets; and an unlock that fails once used to stay failed for the session.
See the comments in `src/lib/sound.ts` before touching audio.

## Build and verify

```
make dev      # hot reload
make check    # npm run build (tsc + vite) + cargo check
make test     # 9 offline tests — no relay touched, nothing published
make build    # release
```

Installing differs by platform and the difference is **not** cosmetic:
`make install` is the Linux layout (bare binary + `.desktop`), while macOS needs
`./install.sh` to build a real `.app`. The Keychain keys its ACLs off code
identity and a bare binary has no bundle identifier.

## Traps specific to this repo

- **There is no message database.** History lives on the relays and is
  re-decrypted every Sync. A sent message survives a restart *only* because
  every send publishes a second wrap addressed back to the sender. Delete that
  and sent messages vanish on restart.
- **Sort by the inner rumor's `created_at`.** The wrap's own timestamp is
  randomised backwards by up to two days by design; ordering by it scrambles
  every conversation. There is no relay-authoritative time to fall back on.
- **Gift wraps cannot be filtered by sender** — fetch every 1059 addressed to
  you and trial-decrypt.
- **No IPC command returns a secret key**, and adding one defeats the whole
  design. Keys are read only inside Rust at sign/unwrap time.
- **Identity removal is irreversible.** It deletes the only copy of the key
  from the OS credential store, and there is no export path.
- **This is the only app in the suite with a real CSP.** The others ship
  `"csp": null`, so a media or asset pattern proven in `ntree`/`nsmpl` may still
  need a CSP line here — `media-src 'self' blob:` exists for exactly that.
- **Debug builds are split** from the installed app: `nchat.dev.json` and the
  `uk.fizx.nchat-dev` keyring service. Two tests guard the split; deleting it
  would point `tauri dev` at the installed app's keys, where a removed identity
  is unrecoverable.

## Not here

Machine-local paths, server addresses, alert keys and per-box ops belong in a
machine-local `CLAUDE.md`, never in this file. **This repo is public.**
