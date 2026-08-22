// Messaging over Nostr.
//
// Sending uses NIP-17 private direct messages, which is the whole reason this
// app exists. The shape matters, so it is worth stating plainly:
//
//   rumor  (kind 14)   the actual message. Never signed, never published.
//   seal   (kind 13)   the rumor, NIP-44 encrypted to the receiver and signed
//                      by the real sender. Proves authorship without exposing it.
//   wrap   (kind 1059) the seal, encrypted again and signed by a THROWAWAY key,
//                      with a timestamp randomised by up to two days.
//
// What an observer sees is therefore: an unknown one-time key published
// something for this recipient, at a time that is not the real one. Compare
// NIP-04, where the sender, the recipient and the true timestamp are all
// public and only the body is hidden — and where the ciphertext is unpadded,
// so even its LENGTH leaks how much you said.
//
// Legacy NIP-04 is still read (never written) so existing correspondents —
// notably the suite's cert/domain expiry bots — keep working during migration.
//
// The signer never leaves this module: callers pass an nsec string straight
// from the keychain, and only plaintext comes back.

use std::collections::HashSet;
use std::time::Duration;

use nostr_sdk::prelude::*;
use serde::Serialize;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelayFailure {
    pub relay: String,
    pub error: String,
}

/// Per-relay outcome of a send. nchat reports this rather than a bare
/// "sent", because a relay that accepts the connection and then silently
/// drops the write is a real and observed failure mode.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SendReport {
    pub event_id: String,
    pub success: Vec<String>,
    pub failed: Vec<RelayFailure>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    /// Hex pubkey of whoever wrote it.
    pub author: String,
    /// Hex pubkey of the other party in the conversation.
    pub peer: String,
    pub text: String,
    /// Seconds since the epoch. For NIP-17 this is the INNER rumor's time —
    /// the gift wrap's own timestamp is deliberately randomised and sorting
    /// by it would scramble every conversation.
    pub created_at: u64,
    pub mine: bool,
    /// "nip17" or "nip04".
    pub transport: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InboxPage {
    pub messages: Vec<Message>,
    /// Messages that decrypted fine but came from a key that is not on the
    /// whitelist. Counted, never rendered.
    pub blocked: u32,
    /// Wraps we could not open at all (not ours, or malformed).
    pub undecryptable: u32,
}

async fn connected_client(relays: &[String]) -> Result<Client, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let client = Client::new();
    let mut added = 0usize;
    for r in relays {
        match client.add_relay(r.as_str()).await {
            Ok(_) => added += 1,
            Err(e) => return Err(format!("bad relay {r}: {e}")),
        }
    }
    if added == 0 {
        return Err("no usable relays".into());
    }
    client.connect().await;
    Ok(client)
}

/// First `p` tag of a rumor/event, i.e. who it was addressed to.
fn first_p_tag(tags: &Tags) -> Option<PublicKey> {
    tags.public_keys().next()
}

/// Send one private message. Two wraps go out: one to the recipient and one
/// addressed back to ourselves, which is what makes our own sent messages
/// survive a restart without nchat keeping a local message database.
pub async fn send_dm(
    relays: &[String],
    nsec: &str,
    recipient_hex: &str,
    text: &str,
) -> Result<SendReport, String> {
    let keys = Keys::parse(nsec).map_err(|e| format!("bad secret key: {e}"))?;
    let recipient =
        PublicKey::from_hex(recipient_hex).map_err(|e| format!("bad recipient key: {e}"))?;
    let me = keys.public_key();

    let rumor: UnsignedEvent = EventBuilder::new(Kind::PrivateDirectMessage, text)
        .tag(Tag::public_key(recipient))
        .finalize_unsigned(me);

    let to_them = GiftWrapBuilder::new(recipient, rumor.clone())
        .finalize(&keys)
        .map_err(|e| format!("could not build gift wrap: {e}"))?;
    let to_self = GiftWrapBuilder::new(me, rumor)
        .finalize(&keys)
        .map_err(|e| format!("could not build self-copy: {e}"))?;

    let client = connected_client(relays).await?;

    let out = client
        .send_event(&to_them)
        .broadcast()
        .await
        .map_err(|e| format!("send failed: {e}"));

    // Best effort — a missing self-copy costs us our own transcript, not the
    // message, so it must not turn a delivered message into a reported failure.
    let _ = client.send_event(&to_self).broadcast().await;
    client.disconnect().await;

    let out = out?;
    Ok(SendReport {
        event_id: out.id().to_hex(),
        success: out.success.keys().map(|u| u.to_string()).collect(),
        failed: out
            .failed
            .iter()
            .map(|(relay, error)| RelayFailure {
                relay: relay.to_string(),
                error: error.clone(),
            })
            .collect(),
    })
}

/// Fetch and decrypt everything addressed to us, keeping only messages from
/// whitelisted keys. `whitelist` is hex pubkeys; our own key is always allowed.
pub async fn fetch_inbox(
    relays: &[String],
    nsec: &str,
    whitelist: &[String],
    limit: usize,
) -> Result<InboxPage, String> {
    let keys = Keys::parse(nsec).map_err(|e| format!("bad secret key: {e}"))?;
    let me = keys.public_key();
    let me_hex = me.to_hex();

    let client = connected_client(relays).await?;

    let wraps = client
        .fetch_events(Filter::new().kind(Kind::GiftWrap).pubkey(me).limit(limit))
        .timeout(FETCH_TIMEOUT)
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    // Legacy NIP-04, both directions, so an in-flight migration still reads
    // as one conversation.
    let legacy_in = client
        .fetch_events(
            Filter::new()
                .kind(Kind::EncryptedDirectMessage)
                .pubkey(me)
                .limit(limit),
        )
        .timeout(FETCH_TIMEOUT)
        .await
        .unwrap_or_default();
    let legacy_out = client
        .fetch_events(
            Filter::new()
                .kind(Kind::EncryptedDirectMessage)
                .author(me)
                .limit(limit),
        )
        .timeout(FETCH_TIMEOUT)
        .await
        .unwrap_or_default();

    client.disconnect().await;

    let allowed = |pk: &str| is_allowed(pk, &me_hex, whitelist);

    let mut messages: Vec<Message> = Vec::new();
    let mut blocked = 0u32;
    let mut undecryptable = 0u32;

    for ev in wraps {
        let unwrapped = match UnwrappedGift::from_gift_wrap(&keys, &ev) {
            Ok(u) => u,
            Err(_) => {
                undecryptable += 1;
                continue;
            }
        };
        let author = unwrapped.sender.to_hex();
        if !allowed(&author) {
            blocked += 1;
            continue;
        }
        let mine = author == me_hex;
        // When we wrote it, the conversation partner is the rumor's `p` tag;
        // otherwise it is the sender.
        let peer = if mine {
            first_p_tag(&unwrapped.rumor.tags)
                .map(|p| p.to_hex())
                .unwrap_or_else(|| me_hex.clone())
        } else {
            author.clone()
        };
        messages.push(Message {
            id: unwrapped
                .rumor
                .id
                .map(|i| i.to_hex())
                .unwrap_or_else(|| ev.id.to_hex()),
            author,
            peer,
            text: unwrapped.rumor.content.clone(),
            created_at: unwrapped.rumor.created_at.as_secs(),
            mine,
            transport: "nip17",
        });
    }

    for (ev, inbound) in legacy_in
        .into_iter()
        .map(|e| (e, true))
        .chain(legacy_out.into_iter().map(|e| (e, false)))
    {
        // Inbound is encrypted between the sender and us; outbound between us
        // and the `p` tag. Either way the counterparty is the decryption key.
        let peer_pk = if inbound {
            ev.pubkey
        } else {
            match first_p_tag(&ev.tags) {
                Some(p) => p,
                None => continue,
            }
        };
        let author = ev.pubkey.to_hex();
        if !allowed(&author) {
            blocked += 1;
            continue;
        }
        let text = match keys.nip04_decrypt(&peer_pk, &ev.content) {
            Ok(t) => t,
            Err(_) => {
                undecryptable += 1;
                continue;
            }
        };
        messages.push(Message {
            id: ev.id.to_hex(),
            mine: author == me_hex,
            author,
            peer: peer_pk.to_hex(),
            text,
            created_at: ev.created_at.as_secs(),
            transport: "nip04",
        });
    }

    // A message addressed to ourselves arrives twice (recipient copy and self
    // copy). Dedup by id explicitly rather than relying on `dedup_by`, which
    // only collapses *adjacent* duplicates and so depends on the sort putting
    // them side by side.
    let mut seen: HashSet<String> = HashSet::with_capacity(messages.len());
    messages.retain(|m| seen.insert(m.id.clone()));
    messages.sort_by_key(|m| m.created_at);

    Ok(InboxPage {
        messages,
        blocked,
        undecryptable,
    })
}

/// Generate a fresh keypair. Returns (nsec, npub, hex pubkey).
pub fn generate_keypair() -> Result<(String, String, String), String> {
    let keys = Keys::generate();
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("could not encode nsec: {e}"))?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("could not encode npub: {e}"))?;
    Ok((nsec, npub, keys.public_key().to_hex()))
}

/// Validate an nsec (bech32 or hex) and return (npub, hex pubkey).
pub fn public_from_secret(nsec: &str) -> Result<(String, String), String> {
    let keys = Keys::parse(nsec.trim()).map_err(|e| format!("not a valid secret key: {e}"))?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("could not encode npub: {e}"))?;
    Ok((npub, keys.public_key().to_hex()))
}

/// Accept an npub or hex pubkey and normalise to (npub, hex).
pub fn normalise_pubkey(input: &str) -> Result<(String, String), String> {
    let pk = PublicKey::parse(input.trim())
        .map_err(|e| format!("not a valid public key (npub or hex): {e}"))?;
    let npub = pk
        .to_bech32()
        .map_err(|e| format!("could not encode npub: {e}"))?;
    Ok((npub, pk.to_hex()))
}

/// Whether a message from `author` should be rendered. Our own key is always
/// allowed so that self-copies and our sent messages come back; everything
/// else must be on the whitelist. Extracted so the rule is directly testable —
/// it is the entire trust model and deserves a test rather than a comment.
fn is_allowed(author: &str, me: &str, whitelist: &[String]) -> bool {
    author == me || whitelist.iter().any(|w| w == author)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the same rumor + wraps that `send_dm` does, without any relay.
    fn wrap_for(
        sender: &Keys,
        recipient: PublicKey,
    ) -> (UnsignedEvent, Event, Event) {
        let rumor: UnsignedEvent = EventBuilder::new(Kind::PrivateDirectMessage, "hello")
            .tag(Tag::public_key(recipient))
            .finalize_unsigned(sender.public_key());
        let to_them = GiftWrapBuilder::new(recipient, rumor.clone())
            .finalize(sender)
            .expect("wrap to recipient");
        let to_self = GiftWrapBuilder::new(sender.public_key(), rumor.clone())
            .finalize(sender)
            .expect("wrap to self");
        (rumor, to_them, to_self)
    }

    #[test]
    fn recipient_can_unwrap_and_sees_the_real_sender() {
        let alice = Keys::generate();
        let bob = Keys::generate();
        let (_, to_bob, _) = wrap_for(&alice, bob.public_key());

        let opened = UnwrappedGift::from_gift_wrap(&bob, &to_bob).expect("bob unwraps");
        assert_eq!(opened.sender, alice.public_key(), "seal proves authorship");
        assert_eq!(opened.rumor.content, "hello");
        assert_eq!(
            first_p_tag(&opened.rumor.tags),
            Some(bob.public_key()),
            "rumor addresses the real recipient"
        );
    }

    #[test]
    fn the_wrap_is_signed_by_a_throwaway_key_not_the_sender() {
        let alice = Keys::generate();
        let bob = Keys::generate();
        let (_, to_bob, _) = wrap_for(&alice, bob.public_key());

        // This is the whole point of NIP-17: nothing on the public event ties
        // it back to alice.
        assert_ne!(to_bob.pubkey, alice.public_key());
        assert_ne!(to_bob.pubkey, bob.public_key());
        assert_eq!(to_bob.kind, Kind::GiftWrap);
    }

    #[test]
    fn a_stranger_cannot_open_the_wrap() {
        let alice = Keys::generate();
        let bob = Keys::generate();
        let eve = Keys::generate();
        let (_, to_bob, _) = wrap_for(&alice, bob.public_key());

        assert!(UnwrappedGift::from_gift_wrap(&eve, &to_bob).is_err());
    }

    #[test]
    fn the_self_copy_is_readable_by_the_sender() {
        // Without this, our own sent messages would not survive a restart.
        let alice = Keys::generate();
        let bob = Keys::generate();
        let (_, _, to_self) = wrap_for(&alice, bob.public_key());

        let opened = UnwrappedGift::from_gift_wrap(&alice, &to_self).expect("alice unwraps");
        assert_eq!(opened.sender, alice.public_key());
        assert_eq!(
            first_p_tag(&opened.rumor.tags),
            Some(bob.public_key()),
            "the conversation partner is still bob, not alice"
        );
    }

    #[test]
    fn sort_uses_the_rumor_timestamp_because_the_wrap_is_jittered() {
        let alice = Keys::generate();
        let bob = Keys::generate();
        let (rumor, to_bob, _) = wrap_for(&alice, bob.public_key());

        let now = Timestamp::now().as_secs();
        let inner = rumor.created_at.as_secs();
        assert!(
            inner.abs_diff(now) < 60,
            "the rumor carries the true send time"
        );
        // The wrap's own timestamp is randomised up to two days into the past,
        // so it is never a safe sort key. Assert only that it is not in the
        // future — the jitter direction is what makes it useless to us.
        assert!(to_bob.created_at.as_secs() <= now + 60);
    }

    #[test]
    fn whitelist_admits_self_and_contacts_only() {
        let me = "aa".repeat(32);
        let friend = "bb".repeat(32);
        let stranger = "cc".repeat(32);
        let list = vec![friend.clone()];

        assert!(is_allowed(&me, &me, &list), "own key always allowed");
        assert!(is_allowed(&friend, &me, &list));
        assert!(!is_allowed(&stranger, &me, &list), "strangers are dropped");
        assert!(!is_allowed(&stranger, &me, &[]), "empty list admits nobody");
    }
}
