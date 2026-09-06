export type StatusResponse = {
  printer_ip: string;
  printer_name: string;
  display_name: string;
  network_sharing: boolean;
  reachable: boolean;
  printer: { ok: boolean; state: string; detail: string };
  scanner: { ok: boolean; state: string; detail: string; backend: string | null; device: string | null; open_source?: boolean };
  queue: Array<{ id: string; owner: string; size: string; raw: string }>;
  recent_prints: HistoryItem[];
  scans: string[];
};

export type HistoryItem = {
  job_id: number;
  document: string;
  created_display: string;
  created_at: number;
  origin_host?: string;
  user_name?: string;
  source: string;
  state: string;
  size_display: string;
  history_key?: string;
};

export type HistoryResponse = { history: HistoryItem[] };

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([$?*|{}\]\\^])/g, "\\$1") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function getCsrfToken(): string {
  // try cookie first (Hono sets csrf_token httpOnly? No, httpOnly true but we also embed in HTML - for SPA we need to fetch token via GET / which sets cookie, and also we can read from meta or endpoint)
  // Hono sets httpOnly:true so JS cannot read it. We'll instead fetch it via reading the HTML csrf hidden input initially or via new endpoint /api/csrf.
  // For now, try to read from cookie if not httpOnly, else try to fetch.
  return getCookie("csrf_token") || "";
}

export async function fetchCsrf(): Promise<string> {
  // hitting / will set cookie and we can parse HTML for token, but better to hit new endpoint
  try {
    const r = await fetch("/api/csrf", { credentials: "same-origin" });
    if (r.ok) {
      const j = await r.json();
      return j.csrf_token || "";
    }
  } catch {}
  // fallback: fetch / and parse
  try {
    const r = await fetch("/", { credentials: "same-origin" });
    const t = await r.text();
    const m = t.match(/name="_csrf_token" value="([^"]+)"/);
    if (m) return m[1];
  } catch {}
  return "";
}

let cachedCsrf: string | null = null;
export async function ensureCsrf(): Promise<string> {
  if (cachedCsrf) return cachedCsrf;
  // try cookie-readable first
  let t = getCsrfToken();
  if (t) { cachedCsrf = t; return t; }
  t = await fetchCsrf();
  cachedCsrf = t;
  return t;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.headers || {}) }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function apiPostForm(path: string, form: FormData): Promise<{ ok: boolean; message?: string; redirect?: string }> {
  const csrf = await ensureCsrf();
  // ensure token in form
  if (!form.has("_csrf_token") && csrf) form.set("_csrf_token", csrf);
  const res = await fetch(path, {
    method: "POST",
    body: form,
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrf, Accept: "application/json" },
  });
  // server may return JSON for accept json, or redirect
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || j.message || `Request failed ${res.status}`);
    return j;
  }
  if (res.redirected || res.status === 302 || res.status === 303) {
    // follow redirect to get flash? Instead treat as success
    return { ok: res.ok, redirect: res.url };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt.slice(0, 400) || `Request failed ${res.status}`);
  }
  return { ok: true };
}
