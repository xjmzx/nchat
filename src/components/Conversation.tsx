import { useEffect, useRef, useState } from "react";
import { Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn";
import type { Contact, Message, SendReport } from "../lib/tauri";

function when(secs: number): string {
  const d = new Date(secs * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One message. `text` is interpolated as a React child, never as HTML — the
 *  body is someone else's input and must never be parsed as markup. */
function Bubble({ m }: { m: Message }) {
  return (
    <div className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-lg px-3 py-2",
          m.mine ? "bg-accent/15 text-fg" : "bg-surface text-fg",
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted font-mono">
          <span>{when(m.createdAt)}</span>
          {/* Transport is shown deliberately: NIP-04 leaks who talked to whom
              and when, so a legacy badge is a nudge, not decoration. */}
          <span
            className={m.transport === "nip17" ? "text-ok" : "text-warn"}
            title={
              m.transport === "nip17"
                ? "NIP-17 gift wrap — sender and timing hidden"
                : "Legacy NIP-04 — metadata is public"
            }
          >
            {m.transport}
          </span>
        </div>
      </div>
    </div>
  );
}

function SendResult({ report }: { report: SendReport }) {
  const ok = report.success.length;
  const bad = report.failed.length;
  return (
    <div
      className={cn(
        "text-[11px] font-mono px-3 py-2 rounded-md flex flex-col gap-1",
        ok === 0 ? "bg-alert/10 text-alert" : "bg-surface text-muted",
      )}
    >
      <div className="flex items-center gap-1.5">
        {ok === 0 ? <TriangleAlert size={12} /> : <ShieldCheck size={12} />}
        confirmed on {ok}/{ok + bad} relays
      </div>
      {report.failed.map((f) => (
        <div key={f.relay} className="pl-4 text-alert/80 break-all">
          {f.relay}: {f.error}
        </div>
      ))}
    </div>
  );
}

export function Conversation({
  contact,
  messages,
  canSend,
  onSend,
}: {
  contact: Contact | null;
  messages: Message[];
  canSend: boolean;
  onSend: (text: string) => Promise<SendReport>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SendReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, contact?.pubkey]);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onSend(text);
      setReport(r);
      setDraft("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!contact) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-muted">
        Pick a contact to start.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-surface/60">
        <div className="text-sm text-fg">{contact.petname}</div>
        <div className="text-[10px] font-mono text-muted truncate">
          {contact.npub}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {messages.length === 0 ? (
          <p className="text-xs text-muted text-center py-10">
            Nothing here yet. Sync to pull messages, or send the first one.
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        <div ref={endRef} />
      </div>

      <div className="px-4 py-3 border-t border-surface/60 flex flex-col gap-2">
        {report && <SendResult report={report} />}
        {error && <p className="text-[11px] text-alert">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={
              canSend ? "Message… (⌘/Ctrl+Enter to send)" : "Select an identity first"
            }
            disabled={!canSend}
            className="flex-1 resize-none bg-surface text-fg text-sm rounded-md px-3 py-2 border border-surfaceHover placeholder:text-muted/60 disabled:opacity-40"
          />
          <button
            onClick={() => void submit()}
            disabled={!canSend || busy || draft.trim() === ""}
            className="p-2.5 rounded-md text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            <Send size={16} className={busy ? "animate-pulse" : ""} />
          </button>
        </div>
      </div>
    </div>
  );
}
