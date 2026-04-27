export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rel}`;
}

export type QueryValue = string | number | boolean | null | undefined;

export function encodeQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const stringValue = value === null ? "null" : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(stringValue)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
