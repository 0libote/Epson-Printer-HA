export type ScanItem = {
  name: string;
  path?: string;
  size: number;
  sizeDisplay: string;
  mtime: number;
  mtimeMs: number;
  mtimeRel: string;
  mtimeIso: string;
  ext: string;
};
export type ScansResponse = { scans: ScanItem[]; total: number; limit: number; max: number };
export type ScanJobResponse = { ok: boolean; jobId: string; state: string; pollUrl: string; message?: string };
export type ScanJobStatus = { ok: boolean; job: { id: string; state: string; dpi: number; mode: string; fmt: string; createdAt: number; startedAt?: number; finishedAt?: number; elapsed: number; progress: string; resultName?: string; error?: string } };

export type InkCartridge = {
  key: "black" | "cyan" | "magenta" | "yellow";
  name: string;
  color: string;
  level: number | null;
  state: "ok" | "low" | "empty" | "unknown";
  detail: string;
};

export type InkStatus = {
  ok: boolean;
  source: "snmp" | "ipp" | "http" | "none";
  updated_at: string;
  cartridges: InkCartridge[];
  message: string;
};

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
  ink?: InkStatus | null;
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
export function clearCachedCsrf() { cachedCsrf = null; }
export async function ensureCsrf(): Promise<string> {
  if (cachedCsrf) return cachedCsrf;
  // try cookie-readable first
  let t = getCsrfToken();
  if (t) { cachedCsrf = t; return t; }
  t = await fetchCsrf();
  cachedCsrf = t;
  return t;
}

function isCsrfError(msg: string) {
  return msg.toLowerCase().includes("csrf");
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // never blindly .json() an error page (login HTML / proxy 502) — that threw SyntaxError: Unexpected token <
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({} as any));
      throw new Error((j as any).error || (j as any).message || `${res.status} ${res.statusText}`);
    }
    const txt = await res.text().catch(() => "");
    throw new Error(txt.slice(0, 200).replace(/<[^>]*>/g, "").trim() || `${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt.slice(0, 200).replace(/<[^>]*>/g, "").trim() || "Unexpected response from server");
  }
  return res.json() as Promise<T>;
}

export async function fetchStatus(): Promise<StatusResponse> {
  return readJson<StatusResponse>(await fetch("/api/status", { credentials: "same-origin", headers: { Accept: "application/json" } }));
}
export async function fetchHistory(): Promise<HistoryResponse> {
  return readJson<HistoryResponse>(await fetch("/api/history?limit=100", { credentials: "same-origin", headers: { Accept: "application/json" } }));
}
export async function fetchHealth(): Promise<{ ok: boolean }> {
  return readJson<{ ok: boolean }>(await fetch("/api/health", { credentials: "same-origin", headers: { Accept: "application/json" } }));
}
export async function fetchInk(refresh = false): Promise<InkStatus> {
  const url = refresh ? "/api/ink?refresh=1" : "/api/ink";
  return readJson<InkStatus>(await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }));
}

async function parseFormResponse(res: Response): Promise<{ ok: boolean; message?: string; redirect?: string }> {
  // server may return JSON for accept json, or redirect
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || j.message || `Request failed ${res.status}`);
    return j;
  }
  if (res.redirected || res.status === 302 || res.status === 303) return { ok: res.ok, redirect: res.url };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt.slice(0, 400) || `Request failed ${res.status}`);
  }
  return { ok: true };
}

async function formRequest(res: Promise<Response>): Promise<{ ok: boolean; message?: string; redirect?: string }> {
  return parseFormResponse(await res);
}

async function addCsrf(form: FormData): Promise<string> {
  const csrf = await ensureCsrf();
  if (!form.has("_csrf_token") && csrf) form.set("_csrf_token", csrf);
  return csrf;
}

export async function postPrint(form: FormData) {
  const csrf = await addCsrf(form);
  return formRequest(fetch("/print", {
    method: "POST",
    body: form,
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrf, Accept: "application/json" },
  }));
}
export async function postScan(form: FormData) {
  const csrf = await addCsrf(form);
  return formRequest(fetch("/scan", { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } }));
}
export async function postClientSettings(form: FormData) {
  const csrf = await addCsrf(form);
  return formRequest(fetch("/client-settings", { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } }));
}
export async function postSetup(form: FormData) {
  const csrf = await addCsrf(form);
  return formRequest(fetch("/setup", { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } }));
}
export async function cancelPrintJob(jobId: string) {
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(jobId)) throw new Error("Invalid print job id");
  const form = new FormData();
  const csrf = await addCsrf(form);
  return formRequest(fetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } }));
}

async function csrfAwareFetch(input: RequestInfo, init: RequestInit, retryBody?: () => RequestInit): Promise<Response> {
  let res = await fetch(input, init);
  if (res.status === 400) {
    const clone = res.clone();
    const txt = await clone.text().catch(() => "");
    if (isCsrfError(txt)) {
      clearCachedCsrf();
      const fresh = await ensureCsrf();
      const retryInit = retryBody ? retryBody() : init;
      const headers = new Headers(retryInit.headers || (init.headers as any));
      headers.set("X-CSRF-Token", fresh);
      // patch _csrf_token in JSON or FormData bodies
      if (retryInit.body && typeof retryInit.body === "string" && retryInit.body.includes("_csrf_token")) {
        try {
          const j = JSON.parse(retryInit.body);
          j._csrf_token = fresh;
          retryInit.body = JSON.stringify(j);
        } catch {}
      } else if (retryInit.body instanceof FormData && fresh) {
        retryInit.body.set("_csrf_token", fresh);
      }
      retryInit.headers = headers;
      res = await fetch(input, retryInit);
    }
  }
  return res;
}

export async function renameScan(oldName: string, newName: string): Promise<{ name: string }> {
  const csrf = await ensureCsrf();
  const safeName = encodeURIComponent(oldName);
  const makeInit = (token: string): RequestInit => ({
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token, Accept: "application/json" },
    body: JSON.stringify({ name: newName, _csrf_token: token }),
  });
  const res = await csrfAwareFetch(`/api/scans/${safeName}/rename`, makeInit(csrf), () => makeInit(cachedCsrf || csrf));
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : { text: await res.text().catch(() => "") };
  if (!res.ok) throw new Error((data as any).error || (data as any).message || `Request failed ${res.status}`);
  // server returns { ok, name } — normalise so callers never see `undefined`
  const name = (data as any).name || (data as any).newName || newName;
  return { name };
}
export async function deleteScan(name: string): Promise<void> {
  const csrf = await ensureCsrf();
  const res = await fetch(`/api/scans/${encodeURIComponent(name)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrf, Accept: "application/json" },
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new Error((data as any).error || `Request failed ${res.status}`);
  return data;
}

// — scan library helpers —
export async function fetchScans(): Promise<ScansResponse> {
  return readJson<ScansResponse>(await fetch("/api/scans?limit=100", { credentials: "same-origin", headers: { Accept: "application/json" } }));
}
export async function startScanJob(opts: { dpi: string; mode: string; format: string; force?: boolean }): Promise<ScanJobResponse> {
  const csrf = await ensureCsrf();
  const makeInit = (token: string): RequestInit => ({
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token, Accept: "application/json" },
    body: JSON.stringify({ dpi: Number.parseInt(opts.dpi, 10), mode: opts.mode, format: opts.format, force: opts.force ? true : undefined, _csrf_token: token }),
  });
  const res = await csrfAwareFetch("/api/scan", makeInit(csrf), () => makeInit(cachedCsrf || csrf));
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : { error: await res.text().catch(() => "") };
  if (!res.ok) {
    const err: any = new Error(data.error || data.message || `Scan failed ${res.status}`);
    err.status = res.status;
    err.jobId = (data as any).jobId;
    err.jobState = (data as any).state;
    throw err;
  }
  return data as ScanJobResponse;
}
export async function pollScanJob(jobId: string): Promise<ScanJobStatus["job"]> {
  if (!/^[a-f0-9]{12}$/.test(jobId)) throw new Error("Invalid scan job id");
  const data = await readJson<ScanJobStatus>(await fetch(`/api/scan/jobs/${jobId}`, { credentials: "same-origin", headers: { Accept: "application/json" } }));
  return data.job;
}
export async function cancelScanJob(jobId: string): Promise<void> {
  const form = new FormData();
  if (!/^[a-f0-9]{12}$/.test(jobId)) throw new Error("Invalid scan job id");
  const csrf = await addCsrf(form);
  await formRequest(fetch(`/api/scan/jobs/${jobId}/cancel`, { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } }));
}
export async function cancelAllScans(): Promise<{ cancelled: number }> {
  const form = new FormData();
  const csrf = await addCsrf(form);
  const res = await fetch("/api/scan/cancel-all", { method: "POST", body: form, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new Error((data as any).error || `Request failed ${res.status}`);
  return data as { cancelled: number };
}
