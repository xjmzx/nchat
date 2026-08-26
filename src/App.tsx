import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  MessagesSquare,
  RefreshCw,
  ShieldOff,
  Timer,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "./lib/cn";
import {
  addContact,
  addIdentity,
  fetchInbox,
  loadState,
  removeContact,
  removeIdentity,
  sendMessage,
  setActiveIdentity,
  setRelays,
  type AppState,
  type Message,
} from "./lib/tauri";
import {
  describeInterval,
  loadPrefs,
  readKey,
  savePrefs,
  SYNC_INTERVALS,
  type Prefs,
} from "./lib/prefs";
import { onToneFailure, playReceive, playSent, unlockTones } from "./lib/sound";
import { ContactList } from "./components/ContactList";
import { Conversation } from "./components/Conversation";
import { IdentityPicker } from "./components/IdentityPicker";
import { RelayPanel } from "./components/RelayPanel";

// Suite rule (n-suite headers): the version chip shows only
// major.minor.patch; any pre-release/build suffix (…-beta.1, +build) drops
// to the tooltip so the chip keeps a fixed, consistent width as releases
// move from 0.1.0-beta.1 toward 1.3.1.
function shortVersion(v: string): string {
  return v.split(/[-+]/)[0];
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(0);
  const [upleb, setUpleb] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Diagnostic: what the tone element actually did, since a silent tone is
  // otherwise invisible from outside the webview.
  const [toneNote, setToneNote] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  // Ids seen by the previous sync, so a background poll can tell an actually
  // new message from the same backlog fetched again. `null` means no sync has
  // completed for this identity yet — the first one must stay silent rather
  // than announcing the entire history at launch.
  const seenIds = useRef<Set<string> | null>(null);
  // A background tick must not stack a second fetch on top of one in flight.
  const inFlight = useRef(false);
  const soundOn = useRef(prefs.sound);
  soundOn.current = prefs.sound;

  const updatePrefs = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      if (next !== prev) savePrefs(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await loadState());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve app version once.
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    onToneFailure(setToneNote);
    return () => onToneFailure(null);
  }, []);

  // Bless the tone elements on the first real interaction. WebKitGTK only
  // grants transient user activation, so by the time a send tone fires — after
  // a relay round trip — or a receive tone fires from the sync timer, the
  // activation from the click is long gone and play() is refused outright.
  // Doing it here, synchronously inside the event, is the whole trick: it must
  // not sit behind an await.
  useEffect(() => {
    const bless = () => {
      unlockTones();
      window.removeEventListener("pointerdown", bless);
      window.removeEventListener("keydown", bless);
    };
    window.addEventListener("pointerdown", bless);
    window.addEventListener("keydown", bless);
    return () => {
      window.removeEventListener("pointerdown", bless);
      window.removeEventListener("keydown", bless);
    };
  }, []);

  const activeId = state?.activeIdentity ?? null;

  const sync = useCallback(async () => {
    if (!activeId || inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    setError(null);
    try {
      const page = await fetchInbox(activeId);

      const previous = seenIds.current;
      const arrived = previous
        ? page.messages.filter((m) => !m.mine && !previous.has(m.id))
        : [];
      seenIds.current = new Set(page.messages.map((m) => m.id));

      setMessages(page.messages);
      setBlocked(page.blocked);
      if (arrived.length > 0 && soundOn.current) playReceive();
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [activeId]);

  // Switching identity invalidates the transcript — it was decrypted for a
  // different key and none of it belongs to the new one.
  useEffect(() => {
    setMessages([]);
    setBlocked(0);
    seenIds.current = null;
  }, [activeId]);

  // Sync once as soon as an identity is available, so launching the app is
  // enough to see what arrived while it was closed.
  useEffect(() => {
    if (!activeId) return;
    void sync();
  }, [activeId, sync]);

  // Then poll, unless the interval is set to manual.
  useEffect(() => {
    if (!activeId || prefs.autoSyncSecs === 0) return;
    const t = setInterval(() => void sync(), prefs.autoSyncSecs * 1000);
    return () => clearInterval(t);
  }, [activeId, prefs.autoSyncSecs, sync]);

  const contacts = state?.contacts ?? [];
  const contact = contacts.find((c) => c.pubkey === selected) ?? null;

  const thread = useMemo(
    () => (selected ? messages.filter((m) => m.peer === selected) : []),
    [messages, selected],
  );

  // Unread is "arrived since you last looked at this conversation", not "not
  // written by me" — otherwise the badge counts the whole history forever.
  const unread = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!activeId) return counts;
    for (const m of messages) {
      if (m.mine) continue;
      const seenAt = prefs.lastRead[readKey(activeId, m.peer)] ?? 0;
      if (m.createdAt > seenAt) counts[m.peer] = (counts[m.peer] ?? 0) + 1;
    }
    return counts;
  }, [messages, activeId, prefs.lastRead]);

  const totalUnread = useMemo(
    () => Object.values(unread).reduce((a, b) => a + b, 0),
    [unread],
  );

  // An open conversation is a read one. Returning `prev` unchanged when there
  // is nothing newer keeps this from looping against its own state update.
  useEffect(() => {
    if (!activeId || !selected) return;
    let newest = 0;
    for (const m of thread) {
      if (!m.mine && m.createdAt > newest) newest = m.createdAt;
    }
    if (newest === 0) return;
    const key = readKey(activeId, selected);
    updatePrefs((prev) =>
      (prev.lastRead[key] ?? 0) >= newest
        ? prev
        : { ...prev, lastRead: { ...prev.lastRead, [key]: newest } },
    );
  }, [activeId, selected, thread, updatePrefs]);

  const onSend = useCallback(
    async (text: string) => {
      if (!activeId || !selected) throw new Error("no identity or recipient");
      const report = await sendMessage(activeId, selected, text);
      // Only after the relays have answered — the tone means "it went", not
      // "you pressed the button".
      if (soundOn.current && report.success.length > 0) playSent();
      await sync();
      return report;
    },
    [activeId, selected, sync],
  );

  const editRelays = useCallback(async () => {
    if (!state) return;
    const next = prompt(
      "Relays, one per line:",
      state.relays.join("\n"),
    );
    if (next === null) return;
    await setRelays(next.split("\n").map((r) => r.trim()).filter(Boolean));
    await refresh();
  }, [state, refresh]);

  const cycleInterval = useCallback(() => {
    updatePrefs((p) => {
      const i = SYNC_INTERVALS.indexOf(
        p.autoSyncSecs as (typeof SYNC_INTERVALS)[number],
      );
      const next = SYNC_INTERVALS[(i + 1) % SYNC_INTERVALS.length];
      return { ...p, autoSyncSecs: next };
    });
  }, [updatePrefs]);

  return (
    <div className={cn("min-h-full flex flex-col", upleb && "theme-upleb")}>
      <header className="relative flex items-center gap-3 px-4 py-3 border-b border-surface/60">
        <MessagesSquare size={20} className="text-accent shrink-0" />
        <button
          onClick={() => setUpleb((v) => !v)}
          title="Toggle theme"
          className="text-xl font-bold tracking-tight select-none"
        >
          <span className="text-accent">n</span>
          <span className="text-mauve">chat</span>
        </button>
        {appVersion && (
          <span
            className="hidden md:inline-flex items-center px-2.5 py-2
                       rounded-md bg-surface text-mauve font-mono text-xs
                       shrink-0"
            title={`v${appVersion}`}
          >
            v{shortVersion(appVersion)}
          </span>
        )}
        <span className="text-xs text-muted hidden sm:inline">
          Private Nostr messaging
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => updatePrefs((p) => ({ ...p, sound: !p.sound }))}
            title={prefs.sound ? "Mute message tones" : "Unmute message tones"}
            className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
          >
            {prefs.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            onClick={cycleInterval}
            title={
              prefs.autoSyncSecs === 0
                ? "Background sync off — click to poll every 30s"
                : `Syncing every ${describeInterval(prefs.autoSyncSecs)} — click to change`
            }
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-mono transition-colors",
              prefs.autoSyncSecs === 0
                ? "text-muted hover:text-fg hover:bg-fg/5"
                : "text-accent hover:bg-accent/10",
            )}
          >
            <Timer size={14} />
            {describeInterval(prefs.autoSyncSecs)}
          </button>
          <IdentityPicker
            identities={state?.identities ?? []}
            activeId={activeId}
            onSelect={async (id) => {
              await setActiveIdentity(id);
              await refresh();
            }}
            onAdd={async (label, nsec) => {
              await addIdentity(label, nsec);
              await refresh();
            }}
            onRemove={async (id) => {
              await removeIdentity(id);
              await refresh();
            }}
          />
          <button
            onClick={() => void sync()}
            disabled={!activeId || syncing}
            title="Fetch messages"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            Sync
          </button>
        </div>
      </header>

      {state?.keychainError && (
        <div className="px-4 py-2 bg-alert/10 text-alert text-xs flex items-center gap-2">
          <ShieldOff size={14} />
          Keychain unavailable — identities cannot be saved. {state.keychainError}
        </div>
      )}
      {error && (
        <div className="px-4 py-2 bg-alert/10 text-alert text-xs break-all">
          {error}
        </div>
      )}

      <main className="flex-1 flex min-h-0">
        <aside className="w-[240px] shrink-0 border-r border-surface/60 flex flex-col min-h-0">
          <ContactList
            contacts={contacts}
            selected={selected}
            unread={unread}
            onSelect={setSelected}
            onAdd={async (key, petname) => {
              await addContact(key, petname);
              await refresh();
            }}
            onRemove={async (pubkey) => {
              await removeContact(pubkey);
              if (selected === pubkey) setSelected(null);
              await refresh();
            }}
          />
          <RelayPanel relays={state?.relays ?? []} onEdit={() => void editRelays()} />
        </aside>

        <Conversation
          contact={contact}
          messages={thread}
          canSend={!!activeId && !!selected}
          onSend={onSend}
        />
      </main>

      <footer className="px-4 py-2 border-t border-surface/60 text-xs text-muted flex items-center gap-4">
        <span>
          {contacts.length} contact{contacts.length === 1 ? "" : "s"}
        </span>
        <span>{messages.length} messages</span>
        {totalUnread > 0 && (
          <span className="text-accent">{totalUnread} unread</span>
        )}
        {blocked > 0 && (
          <span className="text-warn" title="From keys not on the whitelist — counted, never rendered">
            {blocked} blocked
          </span>
        )}
        {toneNote && (
          <span className="font-mono truncate max-w-[52%]" title={toneNote}>
            tone: {toneNote}
          </span>
        )}
        <span className="ml-auto opacity-60">ndisc suite</span>
      </footer>
    </div>
  );
}
