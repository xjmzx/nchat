import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare, RefreshCw, ShieldOff } from "lucide-react";
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
import { ContactList } from "./components/ContactList";
import { Conversation } from "./components/Conversation";
import { IdentityPicker } from "./components/IdentityPicker";
import { RelayPanel } from "./components/RelayPanel";

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(0);
  const [upleb, setUpleb] = useState(false);

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

  const activeId = state?.activeIdentity ?? null;

  const sync = useCallback(async () => {
    if (!activeId) return;
    setSyncing(true);
    setError(null);
    try {
      const page = await fetchInbox(activeId);
      setMessages(page.messages);
      setBlocked(page.blocked);
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }, [activeId]);

  // Switching identity invalidates the transcript — it was decrypted for a
  // different key and none of it belongs to the new one.
  useEffect(() => {
    setMessages([]);
    setBlocked(0);
  }, [activeId]);

  const contacts = state?.contacts ?? [];
  const contact = contacts.find((c) => c.pubkey === selected) ?? null;

  const thread = useMemo(
    () => (selected ? messages.filter((m) => m.peer === selected) : []),
    [messages, selected],
  );

  const unread = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of messages) {
      if (!m.mine) counts[m.peer] = (counts[m.peer] ?? 0) + 1;
    }
    return counts;
  }, [messages]);

  const onSend = useCallback(
    async (text: string) => {
      if (!activeId || !selected) throw new Error("no identity or recipient");
      const report = await sendMessage(activeId, selected, text);
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
        <span className="text-xs text-muted hidden sm:inline">
          Private Nostr messaging
        </span>

        <div className="ml-auto flex items-center gap-2">
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
        {blocked > 0 && (
          <span className="text-warn" title="From keys not on the whitelist — counted, never rendered">
            {blocked} blocked
          </span>
        )}
        <span className="ml-auto opacity-60">ndisc suite</span>
      </footer>
    </div>
  );
}
