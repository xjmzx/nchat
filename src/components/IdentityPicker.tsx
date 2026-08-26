import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2, X } from "lucide-react";
import { cn } from "../lib/cn";
import { shortKey, type Identity } from "../lib/tauri";

/** Identity switcher. Multiple keypairs are first-class here: the relay set
 *  and contact whitelist are shared, but every message is signed by, and
 *  decrypted for, exactly the identity selected. */
export function IdentityPicker({
  identities,
  activeId,
  onSelect,
  onAdd,
  onRemove,
}: {
  identities: Identity[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (label: string, nsec: string) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [nsec, setNsec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const active = identities.find((i) => i.id === activeId) ?? null;

  // The npub is the one thing you have to hand to a correspondent before
  // anything works, and it is otherwise only in nchat.json — the selector
  // shows a truncation. Public key only; no secret is reachable from here.
  const copyNpub = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused outright. Falling back to a prompt
      // still lets the key be selected and copied by hand, which is the
      // whole point of the button.
      prompt("Your npub:", active.npub);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(label.trim(), nsec.trim());
      setLabel("");
      setNsec("");
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={activeId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={identities.length === 0}
        className="bg-surface text-fg text-sm rounded-md px-2 py-1.5 border border-surfaceHover disabled:opacity-40 max-w-[220px]"
      >
        {identities.length === 0 && <option value="">no identity</option>}
        {identities.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label} · {shortKey(i.npub)}
          </option>
        ))}
      </select>

      {active && (
        <button
          onClick={() => void copyNpub()}
          title={`Copy ${active.npub}`}
          className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
        >
          {copied ? (
            <Check size={15} className="text-ok" />
          ) : (
            <Copy size={15} />
          )}
        </button>
      )}

      {activeId && identities.length > 0 && (
        <button
          onClick={() => {
            const cur = identities.find((i) => i.id === activeId);
            if (
              cur &&
              confirm(
                `Remove identity "${cur.label}"?\n\nThis deletes its key from the OS keychain. If you have no other copy of the nsec it cannot be recovered.`,
              )
            ) {
              onRemove(activeId);
            }
          }}
          title="Remove the selected identity"
          className="p-1.5 rounded-md text-muted hover:text-alert hover:bg-fg/5 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title="Add an identity"
        className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
      >
        {open ? <X size={16} /> : <Plus size={16} />}
      </button>

      {open && (
        <div className="absolute right-4 top-14 z-10 w-[380px] bg-panel border border-surfaceHover rounded-lg p-4 shadow-xl flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-fg">
            <KeyRound size={15} className="text-accent" />
            Add identity
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. personal, ops)"
            className="bg-surface text-fg text-sm rounded-md px-2.5 py-2 border border-surfaceHover placeholder:text-muted/60"
          />
          <input
            value={nsec}
            onChange={(e) => setNsec(e.target.value)}
            placeholder="nsec… (leave blank to generate a new key)"
            type="password"
            spellCheck={false}
            className="bg-surface text-fg text-sm font-mono rounded-md px-2.5 py-2 border border-surfaceHover placeholder:text-muted/60"
          />
          <p className="text-[11px] text-muted leading-relaxed">
            The secret goes straight to the OS keychain. It is never written to
            disk in the clear and never returned to this window.
          </p>
          {error && <p className="text-[11px] text-alert">{error}</p>}
          <button
            onClick={() => void submit()}
            disabled={busy || label.trim() === ""}
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium text-bg bg-accent",
              "hover:bg-accent/90 disabled:opacity-40 transition-colors",
            )}
          >
            {busy ? "Working…" : nsec.trim() ? "Import key" : "Generate key"}
          </button>
        </div>
      )}
    </div>
  );
}
