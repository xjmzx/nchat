import { useCallback, useState } from "react";
import { Radio, Zap } from "lucide-react";
import { StatusDot, type Status } from "./StatusDot";
import { probeRelay, type RelayProbe } from "../lib/tauri";

/** Relay health, borrowed wholesale from nping. A messenger should be able to
 *  answer "why did that not arrive" without a second tool — and a relay that
 *  connects but silently refuses writes is a real, observed failure. */
export function RelayPanel({
  relays,
  onEdit,
}: {
  relays: string[];
  onEdit: () => void;
}) {
  const [probes, setProbes] = useState<Record<string, RelayProbe>>({});
  const [checking, setChecking] = useState(false);

  const pingAll = useCallback(async () => {
    setChecking(true);
    try {
      const results = await Promise.all(
        relays.map(async (url) => [url, await probeRelay(url)] as const),
      );
      setProbes(Object.fromEntries(results));
    } finally {
      setChecking(false);
    }
  }, [relays]);

  const statusOf = (url: string): Status => {
    if (checking) return "checking";
    const p = probes[url];
    if (!p) return "idle";
    if (!p.connectOk) return "fail";
    if (!p.reqEose) return "warn";
    return "ok";
  };

  return (
    <div className="border-t border-surface/60">
      <div className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wide text-muted">
        <Radio size={13} />
        Relays
        <button
          onClick={() => void pingAll()}
          disabled={checking || relays.length === 0}
          title="Probe every relay"
          className="ml-auto p-1 rounded text-muted hover:text-fg hover:bg-fg/5 disabled:opacity-40 transition-colors"
        >
          <Zap size={14} className={checking ? "animate-pulse" : ""} />
        </button>
      </div>
      <div className="pb-2">
        {relays.map((url) => {
          const p = probes[url];
          return (
            <div key={url} className="px-3 py-1 flex items-center gap-2">
              <StatusDot status={statusOf(url)} size={7} />
              <span className="text-[11px] font-mono text-muted truncate flex-1">
                {url.replace(/^wss:\/\//, "")}
              </span>
              {p?.connectMs != null && (
                <span className="text-[10px] font-mono text-muted/70 tabular-nums">
                  {p.connectMs}ms
                </span>
              )}
            </div>
          );
        })}
        <button
          onClick={onEdit}
          className="mx-3 mt-1 text-[11px] text-muted hover:text-fg transition-colors"
        >
          edit relays…
        </button>
      </div>
    </div>
  );
}
