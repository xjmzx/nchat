import { useState } from "react";
import { UserPlus, Users, X } from "lucide-react";
import { cn } from "../lib/cn";
import { shortKey, type Contact } from "../lib/tauri";

/** The whitelist. This list *is* the trust model: nchat renders messages from
 *  these keys and no others. Everything else is counted and dropped unread,
 *  which is what keeps an open inbox from becoming a spam surface. */
export function ContactList({
  contacts,
  selected,
  unread,
  onSelect,
  onAdd,
  onRemove,
}: {
  contacts: Contact[];
  selected: string | null;
  unread: Record<string, number>;
  onSelect: (pubkey: string) => void;
  onAdd: (key: string, petname: string) => Promise<void>;
  onRemove: (pubkey: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [petname, setPetname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(key.trim(), petname.trim());
      setKey("");
      setPetname("");
      setAdding(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wide text-muted">
        <Users size={13} />
        Whitelist
        <button
          onClick={() => setAdding((v) => !v)}
          title="Add a contact"
          className="ml-auto p-1 rounded text-muted hover:text-fg hover:bg-fg/5 transition-colors"
        >
          {adding ? <X size={14} /> : <UserPlus size={14} />}
        </button>
      </div>

      {adding && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <input
            value={petname}
            onChange={(e) => setPetname(e.target.value)}
            placeholder="Petname"
            className="bg-surface text-fg text-sm rounded-md px-2.5 py-1.5 border border-surfaceHover placeholder:text-muted/60"
          />
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="npub… or hex pubkey"
            spellCheck={false}
            className="bg-surface text-fg text-xs font-mono rounded-md px-2.5 py-1.5 border border-surfaceHover placeholder:text-muted/60"
          />
          {error && <p className="text-[11px] text-alert">{error}</p>}
          <button
            onClick={() => void submit()}
            disabled={busy || !key.trim() || !petname.trim()}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            {busy ? "Adding…" : "Add to whitelist"}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted leading-relaxed">
            No contacts yet. Add a key above — nothing is rendered until you do.
          </p>
        ) : (
          contacts.map((c) => (
            <div
              key={c.pubkey}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors",
                selected === c.pubkey
                  ? "bg-surface border-accent"
                  : "border-transparent hover:bg-surface/50",
              )}
              onClick={() => onSelect(c.pubkey)}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-fg truncate">{c.petname}</div>
                <div className="text-[10px] font-mono text-muted truncate">
                  {shortKey(c.npub)}
                </div>
              </div>
              {unread[c.pubkey] > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-accent/20 text-accent shrink-0">
                  {unread[c.pubkey]}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove ${c.petname} from the whitelist?`)) {
                    onRemove(c.pubkey);
                  }
                }}
                title="Remove from whitelist"
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-alert transition-all shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
