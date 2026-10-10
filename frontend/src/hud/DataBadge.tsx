import type { Envelope } from "../data/api";
import { formatAge } from "./formatAge";
import { useNow } from "./useNow";

const LABEL = { live: "LIVE", cache: "CACHED", snapshot: "OFFLINE SNAPSHOT" } as const;

/** Where a number came from and how old it is. Shape + text, never colour alone. */
export function DataBadge({
  env,
  error,
  compact,
}: {
  env: Envelope<unknown> | null;
  error?: string | null;
  compact?: boolean;
}) {
  const now = useNow(5000);
  if (!env) {
    return (
      <span className={`badge ${error ? "badge-error" : "badge-loading"}`}>
        {error ? "UNAVAILABLE" : "LOADING"}
      </span>
    );
  }
  const age = formatAge(now - Date.parse(env.fetched_at));
  return (
    <span
      className={`badge badge-${env.source}`}
      title={`${env.provider} — ${LABEL[env.source].toLowerCase()}, fetched ${new Date(env.fetched_at).toUTCString()}${error ? ` (refresh failed: ${error})` : ""}`}
    >
      <span className="badge-dot" aria-hidden />
      {LABEL[env.source]}
      {!compact && <span className="badge-age"> · {age}</span>}
    </span>
  );
}
