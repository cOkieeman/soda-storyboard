import {
  CharacterSummary,
  Job,
  LayoutCandidate,
  PageSummary,
  RenderListResponse,
  SketchGeometry,
  SodaCharacter,
  SodaPage,
  SodaProject,
  SseEvent,
  ValidationIssue,
  ValidationResult
} from "../types";
import { normalizeCharacterColor } from "./characterColors";

export const API_BASE = "";

export async function importExternalStoryboard(source: string): Promise<{ page: SodaPage; report: { guesses: string[]; warnings: string[]; unrecognized_items: { index: number; reason: string }[] } }> {
  return (await request<{ page: SodaPage; report: { guesses: string[]; warnings: string[]; unrecognized_items: { index: number; reason: string }[] } }>("/api/import", { method: "POST", body: JSON.stringify({ source }) })).data;
}

function getOrCreateClientId(): string {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const stored = window.sessionStorage.getItem("soda_client_id");
      if (stored) return stored;
      const created = `client_${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem("soda_client_id", created);
      return created;
    }
  } catch {
    // fallback
  }
  return `client_${Math.random().toString(36).slice(2, 10)}`;
}

export const CLIENT_ID = getOrCreateClientId();

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// Python emits 64-bit render seeds as JSON integers. Protect their source digits
// before JSON.parse converts numbers to IEEE-754, including page metadata that
// will later be saved back to the server. Match complete strings so text that
// happens to contain an escaped `"seed": 123` is never treated as a property.
export function parseJsonWithStringSeeds(json: string): any {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const token of json.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    if (JSON.parse(token[0]) !== "seed") continue;
    const keyEnd = token.index! + token[0].length;
    const value = /^\s*:\s*(-?(?:0|[1-9]\d*))(?=\s*[,}])/.exec(json.slice(keyEnd));
    if (!value) continue;
    const start = keyEnd + value[0].length - value[1].length;
    replacements.push({ start, end: start + value[1].length, value: JSON.stringify(value[1]) });
  }
  let cursor = 0;
  let protectedJson = "";
  for (const replacement of replacements) {
    protectedJson += json.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  return JSON.parse(protectedJson + json.slice(cursor));
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; status: number; headers: Headers }> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  headers.set("X-Client-Id", CLIENT_ID);

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 204) {
    return { data: {} as T, status: res.status, headers: res.headers };
  }

  const contentType = res.headers.get("Content-Type") || "";
  let data: any = null;
  if (contentType.includes("application/json")) {
    try {
      data = parseJsonWithStringSeeds(await res.text());
    } catch {
      data = null;
    }
  } else if (contentType.includes("text/")) {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new ApiError(errorMsg, res.status, data);
  }

  return { data, status: res.status, headers: res.headers };
}

// ==========================================
// API Methods
// ==========================================

export async function getProject(): Promise<{
  project: SodaProject;
  pages: PageSummary[];
  characters: CharacterSummary[];
}> {
  const { data } = await request<{
    project: SodaProject;
    pages: PageSummary[];
    characters: CharacterSummary[];
  }>("/api/project");
  return data;
}

export async function patchProject(
  patch: Partial<SodaProject>
): Promise<{
  project: SodaProject;
  pages: PageSummary[];
  characters: CharacterSummary[];
}> {
  const { data } = await request<{
    project: SodaProject;
    pages: PageSummary[];
    characters: CharacterSummary[];
  }>("/api/project", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  return data;
}

export async function getPages(): Promise<{ pages: PageSummary[] }> {
  const { data } = await request<{ pages: PageSummary[] }>("/api/pages");
  return data;
}

export async function getPage(id: string): Promise<{ page: SodaPage; version: string }> {
  const { data, headers } = await request<{ page: SodaPage; version?: string }>(
    `/api/pages/${encodeURIComponent(id)}`
  );
  const version = data.version || headers.get("ETag") || "";
  return { page: data.page, version };
}

export type PanelCaptionPreview = { panel_id: string; caption: string; custom_override: boolean; language?: "en" | "zh" | "custom"; translation_status?: "fresh" | "stale" | "missing" | "preserved"; warnings?: { code: string; message: string }[] };

/** Compile the current draft for inspection without saving files or creating a generation job. */
export async function previewPanelCaptions(id: string, page: SodaPage, signal?: AbortSignal): Promise<PanelCaptionPreview[]> {
  const { data } = await request<{ panels: PanelCaptionPreview[] }>(`/api/pages/${encodeURIComponent(id)}/caption-preview`, {
    method: "POST", body: JSON.stringify({ page }), signal
  });
  return data.panels;
}

export type SavePageResult = {
  success: boolean;
  status: number;
  page?: SodaPage;
  version?: string;
  warnings?: ValidationIssue[];
  error?: string;
  current?: SodaPage;
  reason?: string;
  errors?: ValidationIssue[];
  issues?: ValidationIssue[];
  data?: any;
};

export async function savePage(
  id: string,
  page: SodaPage,
  version: string
): Promise<SavePageResult> {
  try {
    const { data, headers } = await request<{ page: SodaPage; version?: string; warnings?: ValidationIssue[] }>(
      `/api/pages/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: {
          "If-Match": version
        },
        body: JSON.stringify(page)
      }
    );
    const newVersion = data.version || headers.get("ETag") || version;
    return {
      success: true,
      status: 200,
      page: data.page,
      version: newVersion,
      warnings: data.warnings || []
    };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          success: false,
          status: 409,
          error: err.message,
          current: err.data?.current,
          version: err.data?.version,
          reason: err.data?.reason
        };
      }
      if (err.status === 422) {
        return {
          success: false,
          status: 422,
          error: err.message,
          errors: err.data?.errors || [],
          warnings: err.data?.warnings || [],
          issues: err.data?.issues || []
        };
      }
      return {
        success: false,
        status: err.status,
        error: err.message,
        data: err.data
      };
    }
    return {
      success: false,
      status: 0,
      error: (err as Error).message
    };
  }
}

export async function createPage(page: Partial<SodaPage>): Promise<{ page: SodaPage; version: string }> {
  const { data, headers } = await request<{ page: SodaPage; version?: string }>("/api/pages", {
    method: "POST",
    body: JSON.stringify(page)
  });
  const version = data.version || headers.get("ETag") || "";
  return { page: data.page, version };
}

export async function deletePage(id: string, version: string): Promise<void> {
  await request(`/api/pages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      "If-Match": version
    }
  });
}

export async function getCharacters(): Promise<{ characters: SodaCharacter[] }> {
  const { data } = await request<{ characters: SodaCharacter[] }>("/api/characters");
  return data;
}

export async function getCharacter(id: string): Promise<{ character: SodaCharacter }> {
  const { data } = await request<{ character: SodaCharacter }>(`/api/characters/${encodeURIComponent(id)}`);
  return data;
}

/** Read the complete latest file before merging its color; conditional PUT never overwrites a concurrent edit. */
export async function saveCharacterColor(id: string, color: string): Promise<SodaCharacter> {
  const normalized = normalizeCharacterColor(color);
  if (!normalized) throw new ApiError("请选择有效的十六进制颜色", 400, null);
  const endpoint = `/api/characters/${encodeURIComponent(id)}`;
  const { data, headers } = await request<{ character: SodaCharacter; version?: string }>(endpoint);
  const version = data.version || headers.get("ETag");
  if (!version) throw new ApiError("角色服务缺少版本信息，请重启编辑器服务后重试", 409, null);
  const result = await request<{ character: SodaCharacter }>(endpoint, {
    method: "PUT", headers: { "If-Match": version }, body: JSON.stringify({ ...data.character, sketch_color: normalized })
  });
  return result.data.character;
}

export async function validatePage(id: string): Promise<ValidationResult> {
  const { data } = await request<ValidationResult>(`/api/pages/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return data;
}

export async function compilePage(
  id: string,
  options: { with_ids?: boolean; slant_mode?: "cut" | "hint" | "rect" } = {}
): Promise<{ moss: any; path: string; paths: string[] }> {
  const { data } = await request<{ moss: any; path: string; paths: string[] }>(
    `/api/pages/${encodeURIComponent(id)}/compile`,
    {
      method: "POST",
      body: JSON.stringify(options)
    }
  );
  return data;
}

export async function layoutSuggest(
  id: string,
  options: { candidates?: number; skew?: number } = {}
): Promise<{ candidates: LayoutCandidate[]; version: string }> {
  const { data } = await request<{ candidates: LayoutCandidate[]; version: string }>(
    `/api/pages/${encodeURIComponent(id)}/layout-suggest?style=sketch`,
    {
      method: "POST",
      body: JSON.stringify(options)
    }
  );
  return data;
}

export async function layoutApply(
  id: string,
  candidateId: string,
  version: string
): Promise<{ page: SodaPage; version: string; warnings?: ValidationIssue[] }> {
  const { data, headers } = await request<{ page: SodaPage; version?: string; warnings?: ValidationIssue[] }>(
    `/api/pages/${encodeURIComponent(id)}/layout-apply`,
    {
      method: "POST",
      headers: {
        "If-Match": version
      },
      body: JSON.stringify({
        candidate_id: candidateId
      })
    }
  );
  return {
    page: data.page,
    version: data.version || headers.get("ETag") || version,
    warnings: data.warnings
  };
}

export async function skewPage(
  id: string,
  panels: string[],
  angle: number,
  version: string
): Promise<{ page: SodaPage; version: string; warnings?: ValidationIssue[] }> {
  const { data, headers } = await request<{ page: SodaPage; version?: string; warnings?: ValidationIssue[] }>(
    `/api/pages/${encodeURIComponent(id)}/skew`,
    {
      method: "POST",
      headers: {
        "If-Match": version
      },
      body: JSON.stringify({
        panels,
        angle
      })
    }
  );
  return {
    page: data.page,
    version: data.version || headers.get("ETag") || version,
    warnings: data.warnings
  };
}

export async function generatePage(
  id: string,
  options: { seeds: number; preset: string; model?: string | null; lora?: string }
): Promise<Job> {
  const { data } = await request<Job>(`/api/pages/${encodeURIComponent(id)}/generate`, {
    method: "POST",
    body: JSON.stringify(options)
  });
  return data;
}

export async function getRenders(id: string): Promise<RenderListResponse> {
  try {
    const { data } = await request<RenderListResponse>(`/api/pages/${encodeURIComponent(id)}/renders`);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 501) {
      return {
        renders: [],
        metadata: [],
        selected_render: null,
        candidate_sheet: null
      };
    }
    throw err;
  }
}

export async function pickRender(id: string, renderPath: string): Promise<Job> {
  const { data } = await request<Job>(`/api/pages/${encodeURIComponent(id)}/pick`, {
    method: "POST",
    body: JSON.stringify({
      render_path: renderPath
    })
  });
  return data;
}

export async function getJob(id: string): Promise<Job> {
  const { data } = await request<Job>(`/api/jobs/${encodeURIComponent(id)}`);
  return data;
}

export async function cancelJob(id: string): Promise<Job> {
  const { data } = await request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return data;
}

export async function getSketchGeometry(id: string): Promise<SketchGeometry | null> {
  try {
    const { data } = await request<SketchGeometry>(
      `/api/pages/${encodeURIComponent(id)}/sketch-geometry`
    );
    return data;
  } catch {
    return null;
  }
}

export function getPreviewUrl(id: string, style: "sketch" | "boxes" = "sketch", version?: string): string {
  const query = new URLSearchParams({ style, scale: "1" });
  if (version) {
    query.set("v", version);
  }
  return `/api/pages/${encodeURIComponent(id)}/preview.png?${query.toString()}`;
}

export function connectEvents(
  onEvent: (event: SseEvent) => void,
  onConnectionChange: (connected: boolean) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/api/events`);
  eventSource.onopen = () => onConnectionChange(true);

  eventSource.addEventListener("ready", (e) => {
    try {
      const data = parseJsonWithStringSeeds(e.data);
      onEvent({ type: "ready", data });
    } catch {
      onEvent({ type: "ready", data: { refresh: true } });
    }
  });

  eventSource.addEventListener("resync", (e) => {
    try {
      const data = parseJsonWithStringSeeds(e.data);
      onEvent({ type: "resync", data });
    } catch {
      onEvent({ type: "resync", data: { message: "事件积压，请重新读取项目" } });
    }
  });

  eventSource.addEventListener("file_changed", (e) => {
    try {
      const data = parseJsonWithStringSeeds(e.data);
      onEvent({ type: "file_changed", data });
    } catch (err) {
      console.error("Failed to parse file_changed event", err);
    }
  });

  eventSource.addEventListener("job", (e) => {
    try {
      const data = parseJsonWithStringSeeds(e.data);
      onEvent({ type: "job", data });
    } catch (err) {
      console.error("Failed to parse job event", err);
    }
  });

  eventSource.onerror = (err) => {
    onConnectionChange(false);
    console.warn("SSE connection error, EventSource will reconnect automatically", err);
  };

  return () => {
    eventSource.close();
    onConnectionChange(false);
  };
}
