// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// Note what is NOT here: there is no command that returns a secret key. Keys
// are written to the OS keychain by `addIdentity` and from then on only Rust
// ever sees them. The webview handles public keys and plaintext, nothing else.

import { invoke } from "@tauri-apps/api/core";

export interface Identity {
  id: string;
  label: string;
  npub: string;
  pubkey: string;
}

export interface Contact {
  pubkey: string;
  npub: string;
  petname: string;
  note: string | null;
}

export interface AppState {
  identities: Identity[];
  contacts: Contact[];
  relays: string[];
  activeIdentity: string | null;
  /** null when the OS credential store is healthy, else why it is not. */
  keychainError: string | null;
}

export interface Message {
  id: string;
  author: string;
  peer: string;
  text: string;
  /** Seconds since epoch. For NIP-17 this is the inner rumor's time. */
  createdAt: number;
  mine: boolean;
  transport: "nip17" | "nip04";
}

export interface InboxPage {
  messages: Message[];
  /** Decrypted fine, but the sender is not whitelisted. Never rendered. */
  blocked: number;
  undecryptable: number;
}

export interface RelayFailure {
  relay: string;
  error: string;
}

export interface SendReport {
  eventId: string;
  success: string[];
  failed: RelayFailure[];
}

export const loadState = (): Promise<AppState> => invoke("load_state");

/** `nsec` empty generates a fresh keypair inside Rust. */
export const addIdentity = (label: string, nsec: string): Promise<Identity> =>
  invoke("add_identity", { label, nsec });

export const removeIdentity = (id: string): Promise<void> =>
  invoke("remove_identity", { id });

export const setActiveIdentity = (id: string): Promise<void> =>
  invoke("set_active_identity", { id });

export const addContact = (key: string, petname: string): Promise<Contact> =>
  invoke("add_contact", { key, petname });

export const removeContact = (pubkey: string): Promise<void> =>
  invoke("remove_contact", { pubkey });

export const setRelays = (relays: string[]): Promise<void> =>
  invoke("set_relays", { relays });

export const fetchInbox = (identityId: string): Promise<InboxPage> =>
  invoke("fetch_inbox", { identityId });

export const sendMessage = (
  identityId: string,
  recipient: string,
  text: string,
): Promise<SendReport> =>
  invoke("send_message", { identityId, recipient, text });

// --- relay diagnostics, carried over from nping -------------------------

export interface Nip11 {
  name: string | null;
  description: string | null;
  software: string | null;
  version: string | null;
  pubkey: string | null;
  contact: string | null;
  supportedNips: number[];
  paymentRequired: boolean;
  authRequired: boolean;
}

export interface RelayProbe {
  url: string;
  ok: boolean;
  connectOk: boolean;
  connectMs: number | null;
  connectError: string | null;
  reqOk: boolean;
  reqMs: number | null;
  reqEvents: number;
  reqEose: boolean;
  reqError: string | null;
  notice: string | null;
  info: Nip11 | null;
  infoError: string | null;
}

export const probeRelay = (url: string): Promise<RelayProbe> =>
  invoke("probe_relay", { url });

/** Short display form for a hex pubkey when there is no petname. */
export function shortKey(npubOrHex: string): string {
  if (npubOrHex.length <= 16) return npubOrHex;
  return `${npubOrHex.slice(0, 10)}…${npubOrHex.slice(-6)}`;
}
