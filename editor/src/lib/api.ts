import {
  CharacterSummary,
  Job,
  LayoutCandidate,
  PageSummary,
  RenderListResponse,
  SodaCharacter,
  SodaPage,
  SodaProject,
  SseEvent,
  ValidationIssue,
  ValidationResult
} from "../types";

export const API_BASE = "";

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

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; status: number; headers: Headers }> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

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
      data = await res.json();
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
      const data = JSON.parse(e.data);
      onEvent({ type: "ready", data });
    } catch {
      onEvent({ type: "ready", data: { refresh: true } });
    }
  });

  eventSource.addEventListener("resync", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "resync", data });
    } catch {
      onEvent({ type: "resync", data: { message: "事件积压，请重新读取项目" } });
    }
  });

  eventSource.addEventListener("file_changed", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "file_changed", data });
    } catch (err) {
      console.error("Failed to parse file_changed event", err);
    }
  });

  eventSource.addEventListener("job", (e) => {
    try {
      const data = JSON.parse(e.data);
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
