// UI preferences, persisted in the webview's localStorage.
//
// Deliberately *not* in nchat.json: these are per-machine display choices, not
// configuration, and routing them through Rust would mean new IPC commands for
// no gain. Note the boundary this respects — localStorage is plaintext and the
// webview is treated as untrusted, so nothing here may ever be sensitive. Read
// state and a mute flag qualify; keys, contacts and relays do not, and stay in
// nchat.json where Rust owns them.

const KEY = "nchat.ui";

export interface Prefs {
  /** Play a tone on send and on receive. */
  sound: boolean;
  /** Seconds between background syncs; 0 disables the timer entirely. */
  autoSyncSecs: number;
  /** Newest message time seen per `identityId|peerPubkey`. Drives unread. */
  lastRead: Record<string, number>;
}

/** Offered by the header control, in order. 0 = manual Sync only. */
export const SYNC_INTERVALS = [0, 30, 60, 300] as const;

const DEFAULTS: Prefs = { sound: true, autoSyncSecs: 60, lastRead: {} };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sound: parsed.sound ?? DEFAULTS.sound,
      autoSyncSecs: parsed.autoSyncSecs ?? DEFAULTS.autoSyncSecs,
      lastRead: parsed.lastRead ?? {},
    };
  } catch {
    // Corrupt or unavailable storage falls back to defaults. Losing a mute
    // flag is not worth failing to start over.
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* Storage full or disabled — the app works, the choice just won't stick. */
  }
}

/** Read state is per identity: the same peer is a different conversation
 *  under a different key, and merging them would mark messages read that the
 *  active identity has never seen. */
export function readKey(identityId: string, peer: string): string {
  return `${identityId}|${peer}`;
}

export function describeInterval(secs: number): string {
  if (secs === 0) return "manual";
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}
