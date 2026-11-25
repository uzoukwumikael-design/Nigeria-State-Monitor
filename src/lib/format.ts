const LAGOS_TZ = "Africa/Lagos";

const dateTimeFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: LAGOS_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: LAGOS_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: LAGOS_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LAGOS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Not reported";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not reported";
  return `${dateTimeFormatter.format(date)} WAT`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Not reported";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not reported";
  return dateFormatter.format(date);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${timeFormatter.format(date)} WAT`;
}

/** YYYY-MM-DD in Africa/Lagos, used for daily buckets. */
export function lagosDayKey(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return dayKeyFormatter.format(date);
}

export function formatDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: LAGOS_TZ,
    day: "numeric",
    month: "short",
  }).format(date);
}

export function relativeTime(iso: string | null | undefined, referenceIso: string): string {
  if (!iso) return "time unknown";
  const then = new Date(iso).getTime();
  const reference = new Date(referenceIso).getTime();
  if (Number.isNaN(then) || Number.isNaN(reference)) return "time unknown";
  const deltaMs = reference - then;
  const future = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let value: string;
  if (minutes < 2) value = "just now";
  else if (minutes < 60) value = `${minutes}m`;
  else if (hours < 24) value = `${hours}h`;
  else if (days < 30) value = `${days}d`;
  else if (days < 365) value = `${Math.round(days / 30)}mo`;
  else value = `${Math.round(days / 365)}y`;
  if (value === "just now") return future ? "just now" : value;
  return future ? `in ${value}` : `${value} ago`;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en-NG", options).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatCoordinates(point: { lat: number; lng: number } | null): string {
  if (!point) return "No point";
  const lat = Math.abs(point.lat).toFixed(3);
  const lng = Math.abs(point.lng).toFixed(3);
  return `${lat}°${point.lat >= 0 ? "N" : "S"}, ${lng}°${point.lng >= 0 ? "E" : "W"}`;
}

export function formatArea(areaKm2: number): string {
  return `${formatNumber(areaKm2, { maximumFractionDigits: 0 })} km²`;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1).trimEnd();
  return `${cut}…`;
}
