import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  cancelJob as apiCancelJob,
  compilePage as apiCompilePage,
  connectEvents,
  createPage as apiCreatePage,
  deletePage as apiDeletePage,
  generatePage as apiGeneratePage,
  getCharacters as apiGetCharacters,
  getPage as apiGetPage,
  getPages as apiGetPages,
  getProject as apiGetProject,
  getRenders as apiGetRenders,
  layoutApply as apiLayoutApply,
  layoutSuggest as apiLayoutSuggest,
  pickRender as apiPickRender,
  savePage as apiSavePage,
  skewPage as apiSkewPage,
  validatePage as apiValidatePage
} from "./api";
import {
  createEmptyProject,
  projectPageToSodaPage,
  sodaPageToProjectPage
} from "./project";
import {
  CharacterSummary,
  Figure,
  Job,
  LayoutCandidate,
  PageSummary,
  Panel,
  Project,
  ProjectPage,
  RenderListResponse,
  Selection,
  SodaCharacter,
  SodaOverlay,
  SodaPage,
  SodaPanel,
  SodaProject,
  SodaText,
  SseEvent,
  ValidationIssue
} from "../types";

export type NoticeEntry = {
  id: string;
  text: string;
  time: string;
  timestamp: number;
};

export type LayerSettings = {
  showSketch: boolean;
  sketchOpacity: number;
  showRender: boolean;
  renderOpacity: number;
};

type EditorState = {
  // Soda Storyboard Project State
  sodaProject: SodaProject | null;
  pages: PageSummary[];
  characters: CharacterSummary[];
  characterDetails: Record<string, SodaCharacter>;

  // Current active page
  activePageId: string;
  sodaPage: SodaPage | null;
  currentVersion: string;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  lastSavedTime: string | null;

  // OpenKoma canvas adaptation
  project: Project;
  selection: Selection | null;

  // Layers
  layerSettings: LayerSettings;
  renders: RenderListResponse | null;
  selectedRenderUrl: string | null;

  // Background job
  activeJob: Job | null;

  // Issues and validation
  validationIssues: ValidationIssue[];

  // Modals & dialogues
  conflictModal: {
    open: boolean;
    serverPage?: SodaPage;
    serverVersion?: string;
    reason?: string;
    localBackup?: string;
  } | null;

  layoutModal: {
    open: boolean;
    candidates: LayoutCandidate[];
    loading: boolean;
    error?: string;
  };

  previewModal: {
    open: boolean;
    url: string | null;
  };

  compileModal: {
    open: boolean;
    moss: any;
    path: string;
    paths: string[];
  } | null;

  generateModal: {
    open: boolean;
    seeds: number;
    preset: "draft" | "final";
    loading: boolean;
    error?: string;
  };

  // Notification
  notice: string | null;
  noticeHistory: NoticeEntry[];

  // Lifecycle
  initialized: boolean;
  disconnectSse: (() => void) | null;
  autoSaveTimer: any;

  // Actions
  init: () => Promise<void>;
  selectPage: (pageId: string) => Promise<void>;
  createPage: () => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;

  // Canvas & Page updates
  updatePanel: (id: string, patch: Partial<Panel>) => void;
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => void;
  updateSodaText: (id: string, patch: Partial<SodaText>) => void;
  updateSodaOverlay: (id: string, patch: Partial<SodaOverlay>) => void;
  addFigureToPanel: (panelId: string, figure: Figure) => void;
  removeFigureFromPanel: (panelId: string, figureIndex: number) => void;
  updateFigureInPanel: (panelId: string, figureIndex: number, patch: Partial<Figure>) => void;

  selectItem: (selection: Selection | null) => void;
  deleteSelection: () => void;

  // Save & Sync
  saveCurrentPage: (force?: boolean) => Promise<boolean>;
  triggerAutoSave: () => void;
  reloadCurrentPage: () => Promise<void>;
  resolveConflictLoadLatest: () => Promise<void>;
  closeConflictModal: () => void;

  // Modals & Tools
  openLayoutModal: () => Promise<void>;
  closeLayoutModal: () => void;
  applyLayoutCandidate: (candidateId: string) => Promise<void>;

  openPreviewModal: () => void;
  closePreviewModal: () => void;

  openCompileModal: () => Promise<void>;
  closeCompileModal: () => void;

  openGenerateModal: () => void;
  closeGenerateModal: () => void;
  submitGenerate: (options: { seeds: number; preset: string; model?: string | null; lora?: string }) => Promise<void>;

  pickRender: (renderPath: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  setLayerSettings: (patch: Partial<LayerSettings>) => void;
  setNotice: (text: string) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  sodaProject: null,
  pages: [],
  characters: [],
  characterDetails: {},

  activePageId: "",
  sodaPage: null,
  currentVersion: "",
  hasUnsavedChanges: false,
  isSaving: false,
  lastSavedTime: null,

  project: createEmptyProject(),
  selection: null,

  layerSettings: {
    showSketch: true,
    sketchOpacity: 0.35,
    showRender: true,
    renderOpacity: 0.8
  },
  renders: null,
  selectedRenderUrl: null,

  activeJob: null,
  validationIssues: [],

  conflictModal: null,
  layoutModal: {
    open: false,
    candidates: [],
    loading: false
  },
  previewModal: {
    open: false,
    url: null
  },
  compileModal: null,
  generateModal: {
    open: false,
    seeds: 4,
    preset: "draft",
    loading: false
  },

  notice: null,
  noticeHistory: [],
  initialized: false,
  disconnectSse: null,
  autoSaveTimer: null,

  // Initialize store and connect SSE
  init: async () => {
    if (get().initialized) return;

    try {
      const { project, pages, characters } = await apiGetProject();
      set({
        sodaProject: project,
        pages,
        characters,
        initialized: true
      });

      // Load character details in background
      apiGetCharacters().then((res) => {
        const charMap: Record<string, SodaCharacter> = {};
        for (const c of res.characters) {
          charMap[c.id] = c;
        }
        set({ characterDetails: charMap });
      }).catch(console.error);

      // Select first page
      if (pages.length > 0) {
        await get().selectPage(pages[0].id);
      }

      // Connect SSE
      const disconnect = connectEvents((event: SseEvent) => {
        const state = get();
        if (event.type === "ready" || event.type === "resync") {
          // Re-fetch project and current page if no unsaved changes
          apiGetProject().then(({ project: p, pages: pgs, characters: chs }) => {
            set({ sodaProject: p, pages: pgs, characters: chs });
          });
          if (!state.hasUnsavedChanges && state.activePageId) {
            get().reloadCurrentPage();
          }
        } else if (event.type === "file_changed") {
          const { page_id, change, message } = event.data;
          // Refresh page list
          apiGetPages().then(({ pages: pgs }) => set({ pages: pgs }));

          if (page_id && page_id === state.activePageId) {
            if (!state.hasUnsavedChanges) {
              // Safe to auto-refresh
              get().reloadCurrentPage();
              get().setNotice(message || "页面已在外部修改");
            } else {
              // Local has unsaved changes -> 409 style conflict notice
              get().setNotice("外部文件已变更，本地有未保存内容");
            }
          }
        } else if (event.type === "job") {
          const job = event.data;
          set({ activeJob: job });

          if (job.status === "completed") {
            get().setNotice(`任务完成: ${job.message || "出图已完成"}`);
            if (state.activePageId) {
              apiGetRenders(state.activePageId).then((r) => set({ renders: r }));
              if (!state.hasUnsavedChanges) {
                get().reloadCurrentPage();
              }
            }
          } else if (job.status === "failed") {
            get().setNotice(`任务失败: ${job.error || job.message || "未知错误"}`);
          }
        }
      });

      set({ disconnectSse: disconnect });
    } catch (err: any) {
      console.error("Failed to initialize soda storyboard editor", err);
      get().setNotice(`加载项目失败: ${err.message}`);
    }
  },

  selectPage: async (pageId: string) => {
    const state = get();
    // If has unsaved changes, prompt save or preserve
    if (state.hasUnsavedChanges) {
      await state.saveCurrentPage();
    }

    try {
      const { page, version } = await apiGetPage(pageId);
      const openKomaPage = sodaPageToProjectPage(page);

      set({
        activePageId: pageId,
        sodaPage: page,
        currentVersion: version,
        hasUnsavedChanges: false,
        validationIssues: [],
        selection: null,
        project: {
          id: pageId,
          name: pageId,
          pages: [openKomaPage],
          activePageId: pageId
        }
      });

      // Fetch renders
      apiGetRenders(pageId).then((r) => {
        let selectedUrl: string | null = null;
        if (r.selected_render) {
          const matched = r.renders.find((x) => x.path === r.selected_render);
          selectedUrl = matched?.url || `/api/files/${r.selected_render}`;
        }
        set({ renders: r, selectedRenderUrl: selectedUrl });
      }).catch(console.error);

      get().setNotice(`已载入分镜页: ${pageId}`);
    } catch (err: any) {
      console.error(`Failed to load page ${pageId}`, err);
      get().setNotice(`载入分镜页失败: ${err.message}`);
    }
  },

  createPage: async () => {
    const pageId = `page_${Date.now().toString().slice(-4)}`;
    try {
      const { page, version } = await apiCreatePage({
        id: pageId,
        canvas_width: 1024,
        canvas_height: 1536,
        panels: [],
        texts: []
      });
      const { pages } = await apiGetPages();
      set({ pages });
      await get().selectPage(page.id);
      get().setNotice(`已新建分镜页: ${page.id}`);
    } catch (err: any) {
      get().setNotice(`新建分镜页失败: ${err.message}`);
    }
  },

  deletePage: async (pageId: string) => {
    const state = get();
    if (state.pages.length <= 1) {
      get().setNotice("项目中至少保留一个页面");
      return;
    }
    try {
      await apiDeletePage(pageId, state.currentVersion);
      const { pages } = await apiGetPages();
      set({ pages });
      if (state.activePageId === pageId && pages.length > 0) {
        await get().selectPage(pages[0].id);
      }
      get().setNotice(`分镜页 ${pageId} 已移入 .trash 目录`);
    } catch (err: any) {
      get().setNotice(`删除分镜页失败: ${err.message}`);
    }
  },

  // Update canvas panel
  updatePanel: (id: string, patch: Partial<Panel>) => {
    const state = get();
    const activePage = state.project.pages[0];
    if (!activePage) return;

    const nextPanels = activePage.panels.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...patch
      };
    });

    const nextProject = {
      ...state.project,
      pages: [
        {
          ...activePage,
          panels: nextPanels
        }
      ]
    };

    set({ project: nextProject });
    get().triggerAutoSave();
  },

  // Update Soda panel metadata (shot, angle, figures, description, caption_en)
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => {
    const state = get();
    if (!state.sodaPage) return;

    const activePage = state.project.pages[0];
    const nextSodaPanels = state.sodaPage.panels.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...patch
      };
    });

    const nextSodaPage = {
      ...state.sodaPage,
      panels: nextSodaPanels
    };

    // Also sync to active OpenKoma panel sodaData
    let nextPanels = activePage.panels;
    if (activePage) {
      nextPanels = activePage.panels.map((p) => {
        if (p.id !== id) return p;
        return {
          ...p,
          order: patch.order ?? p.order,
          sodaData: {
            ...p.sodaData,
            ...patch
          }
        };
      });
    }

    set({
      sodaPage: nextSodaPage,
      project: {
        ...state.project,
        pages: [
          {
            ...activePage,
            panels: nextPanels
          }
        ]
      }
    });
    get().triggerAutoSave();
  },

  // Update text box
  updateSodaText: (id: string, patch: Partial<SodaText>) => {
    const state = get();
    if (!state.sodaPage) return;

    const activePage = state.project.pages[0];
    const nextSodaTexts = state.sodaPage.texts.map((t) => {
      if (t.id !== id) return t;
      return {
        ...t,
        ...patch
      };
    });

    const nextSodaPage = {
      ...state.sodaPage,
      texts: nextSodaTexts
    };

    let nextBubbles = activePage.bubbles;
    if (activePage) {
      nextBubbles = activePage.bubbles.map((b) => {
        if (b.id !== id) return b;
        return {
          ...b,
          text: patch.text ?? b.text,
          direction: patch.direction ? (patch.direction as any) : b.direction,
          sodaData: {
            ...(b.sodaData as any),
            ...patch
          }
        };
      });
    }

    set({
      sodaPage: nextSodaPage,
      project: {
        ...state.project,
        pages: [
          {
            ...activePage,
            bubbles: nextBubbles
          }
        ]
      }
    });
    get().triggerAutoSave();
  },

  // Update overlay
  updateSodaOverlay: (id: string, patch: Partial<SodaOverlay>) => {
    const state = get();
    if (!state.sodaPage) return;

    const overlays = state.sodaPage.overlays || [];
    const nextOverlays = overlays.map((o) => {
      if (o.id !== id) return o;
      return {
        ...o,
        ...patch
      };
    });

    set({
      sodaPage: {
        ...state.sodaPage,
        overlays: nextOverlays
      }
    });
    get().triggerAutoSave();
  },

  addFigureToPanel: (panelId: string, figure: Figure) => {
    const state = get();
    if (!state.sodaPage) return;

    const targetPanel = state.sodaPage.panels.find((p) => p.id === panelId);
    if (!targetPanel) return;

    const figures = [...(targetPanel.figures || []), figure];
    get().updateSodaPanel(panelId, { figures });
  },

  removeFigureFromPanel: (panelId: string, figureIndex: number) => {
    const state = get();
    if (!state.sodaPage) return;

    const targetPanel = state.sodaPage.panels.find((p) => p.id === panelId);
    if (!targetPanel) return;

    const figures = (targetPanel.figures || []).filter((_, idx) => idx !== figureIndex);
    get().updateSodaPanel(panelId, { figures });
  },

  updateFigureInPanel: (panelId: string, figureIndex: number, patch: Partial<Figure>) => {
    const state = get();
    if (!state.sodaPage) return;

    const targetPanel = state.sodaPage.panels.find((p) => p.id === panelId);
    if (!targetPanel) return;

    const figures = (targetPanel.figures || []).map((f, idx) => {
      if (idx !== figureIndex) return f;
      return { ...f, ...patch };
    });
    get().updateSodaPanel(panelId, { figures });
  },

  selectItem: (selection: Selection | null) => {
    set({ selection });
  },

  deleteSelection: () => {
    const state = get();
    const sel = state.selection;
    if (!sel || !state.sodaPage) return;

    const activePage = state.project.pages[0];
    if (sel.kind === "panel") {
      const nextPanels = activePage.panels.filter((p) => p.id !== sel.id);
      const nextSodaPanels = state.sodaPage.panels.filter((p) => p.id !== sel.id);
      set({
        selection: null,
        sodaPage: { ...state.sodaPage, panels: nextSodaPanels },
        project: {
          ...state.project,
          pages: [{ ...activePage, panels: nextPanels }]
        }
      });
      get().triggerAutoSave();
    } else if (sel.kind === "text" || sel.kind === "bubble") {
      const nextBubbles = activePage.bubbles.filter((b) => b.id !== sel.id);
      const nextSodaTexts = state.sodaPage.texts.filter((t) => t.id !== sel.id);
      set({
        selection: null,
        sodaPage: { ...state.sodaPage, texts: nextSodaTexts },
        project: {
          ...state.project,
          pages: [{ ...activePage, bubbles: nextBubbles }]
        }
      });
      get().triggerAutoSave();
    } else if (sel.kind === "overlay") {
      const overlays = state.sodaPage.overlays || [];
      const nextOverlays = overlays.filter((o) => o.id !== sel.id);
      set({
        selection: null,
        sodaPage: { ...state.sodaPage, overlays: nextOverlays }
      });
      get().triggerAutoSave();
    }
  },

  // Save current page
  saveCurrentPage: async (_force = false): Promise<boolean> => {
    const state = get();
    if (!state.sodaPage || !state.activePageId || state.isSaving) return false;

    set({ isSaving: true });
    const activePage = state.project.pages[0];
    const pageToSave = projectPageToSodaPage(activePage, state.sodaPage);

    try {
      const res = await apiSavePage(state.activePageId, pageToSave, state.currentVersion);

      if (res.success) {
        set({
          sodaPage: res.page,
          currentVersion: res.version,
          hasUnsavedChanges: false,
          isSaving: false,
          lastSavedTime: new Date().toLocaleTimeString(),
          validationIssues: res.warnings || []
        });
        get().setNotice("分镜已保存");
        return true;
      }

      if (res.status === 409) {
        set({
          isSaving: false,
          conflictModal: {
            open: true,
            serverPage: res.current,
            serverVersion: res.version,
            reason: res.reason,
            localBackup: JSON.stringify(pageToSave, null, 2)
          }
        });
        get().setNotice("保存冲突: 页面已被外部修改");
        return false;
      }

      if (res.status === 422) {
        set({
          isSaving: false,
          validationIssues: res.issues || res.errors || []
        });
        get().setNotice("页面校验失败，请检查右栏错误");
        return false;
      }

      set({ isSaving: false });
      get().setNotice(`保存失败: ${res.error}`);
      return false;
    } catch (err: any) {
      set({ isSaving: false });
      get().setNotice(`保存异常: ${err.message}`);
      return false;
    }
  },

  triggerAutoSave: () => {
    const state = get();
    set({ hasUnsavedChanges: true });
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
    }
    const timer = setTimeout(() => {
      get().saveCurrentPage();
    }, 1000);
    set({ autoSaveTimer: timer });
  },

  reloadCurrentPage: async () => {
    const state = get();
    if (!state.activePageId) return;
    try {
      const { page, version } = await apiGetPage(state.activePageId);
      const openKomaPage = sodaPageToProjectPage(page);
      set({
        sodaPage: page,
        currentVersion: version,
        hasUnsavedChanges: false,
        validationIssues: [],
        project: {
          ...state.project,
          pages: [openKomaPage]
        }
      });
      apiGetRenders(state.activePageId).then((r) => {
        let selectedUrl: string | null = null;
        if (r.selected_render) {
          const matched = r.renders.find((x) => x.path === r.selected_render);
          selectedUrl = matched?.url || `/api/files/${r.selected_render}`;
        }
        set({ renders: r, selectedRenderUrl: selectedUrl });
      }).catch(console.error);
    } catch (err: any) {
      get().setNotice(`重新载入失败: ${err.message}`);
    }
  },

  resolveConflictLoadLatest: async () => {
    set({ conflictModal: null });
    await get().reloadCurrentPage();
    get().setNotice("已载入服务端最新版本");
  },

  closeConflictModal: () => {
    set({ conflictModal: null });
  },

  // Layout Modal & Apply
  openLayoutModal: async () => {
    const state = get();
    if (!state.activePageId) return;

    set({
      layoutModal: {
        open: true,
        candidates: [],
        loading: true,
        error: undefined
      }
    });

    try {
      const res = await apiLayoutSuggest(state.activePageId, { candidates: 6, skew: 0 });
      set({
        layoutModal: {
          open: true,
          candidates: res.candidates,
          loading: false
        }
      });
    } catch (err: any) {
      set({
        layoutModal: {
          open: true,
          candidates: [],
          loading: false,
          error: err.message
        }
      });
    }
  },

  closeLayoutModal: () => {
    set({ layoutModal: { open: false, candidates: [], loading: false } });
  },

  applyLayoutCandidate: async (candidateId: string) => {
    const state = get();
    if (!state.activePageId) return;

    try {
      const res = await apiLayoutApply(state.activePageId, candidateId, state.currentVersion);
      const openKomaPage = sodaPageToProjectPage(res.page);
      set({
        sodaPage: res.page,
        currentVersion: res.version,
        hasUnsavedChanges: false,
        validationIssues: res.warnings || [],
        layoutModal: { open: false, candidates: [], loading: false },
        project: {
          ...state.project,
          pages: [openKomaPage]
        }
      });
      get().setNotice("已应用版式候选");
    } catch (err: any) {
      get().setNotice(`应用版式失败: ${err.message}`);
    }
  },

  openPreviewModal: () => {
    const state = get();
    if (!state.activePageId) return;
    const url = `/api/pages/${encodeURIComponent(state.activePageId)}/preview.png?style=sketch&scale=1&v=${encodeURIComponent(state.currentVersion)}`;
    set({ previewModal: { open: true, url } });
  },

  closePreviewModal: () => {
    set({ previewModal: { open: false, url: null } });
  },

  openCompileModal: async () => {
    const state = get();
    if (!state.activePageId) return;

    try {
      const res = await apiCompilePage(state.activePageId, { with_ids: true, slant_mode: "cut" });
      set({
        compileModal: {
          open: true,
          moss: res.moss,
          path: res.path,
          paths: res.paths || [res.path]
        }
      });
    } catch (err: any) {
      get().setNotice(`导出/编译失败: ${err.message}`);
    }
  },

  closeCompileModal: () => {
    set({ compileModal: null });
  },

  openGenerateModal: () => {
    set({
      generateModal: {
        open: true,
        seeds: 4,
        preset: "draft",
        loading: false
      }
    });
  },

  closeGenerateModal: () => {
    set({
      generateModal: {
        open: false,
        seeds: 4,
        preset: "draft",
        loading: false
      }
    });
  },

  submitGenerate: async (options) => {
    const state = get();
    if (!state.activePageId) return;

    set({ generateModal: { ...state.generateModal, loading: true, error: undefined } });

    try {
      const job = await apiGeneratePage(state.activePageId, options);
      set({
        activeJob: job,
        generateModal: { ...state.generateModal, open: false, loading: false }
      });
      get().setNotice(`出图任务已提交 (${job.message || "排队中"})`);
    } catch (err: any) {
      const msg = err.status === 501 ? "出图功能尚未安装" : err.message;
      set({
        generateModal: {
          ...state.generateModal,
          loading: false,
          error: msg
        }
      });
      get().setNotice(`出图提示: ${msg}`);
    }
  },

  pickRender: async (renderPath: string) => {
    const state = get();
    if (!state.activePageId) return;

    try {
      const job = await apiPickRender(state.activePageId, renderPath);
      set({ activeJob: job });
      get().setNotice(`已选择底图任务 (${job.message || "处理中"})`);
      // Update selected render
      const r = await apiGetRenders(state.activePageId);
      const matched = r.renders.find((x) => x.path === renderPath);
      const url = matched?.url || `/api/files/${renderPath}`;
      set({ renders: r, selectedRenderUrl: url });
    } catch (err: any) {
      const msg = err.status === 501 ? "出图功能尚未安装" : err.message;
      get().setNotice(`选择底图失败: ${msg}`);
    }
  },

  cancelJob: async (jobId: string) => {
    try {
      const job = await apiCancelJob(jobId);
      set({ activeJob: job });
      get().setNotice("已请求取消任务");
    } catch (err: any) {
      get().setNotice(`取消任务失败: ${err.message}`);
    }
  },

  setLayerSettings: (patch: Partial<LayerSettings>) => {
    set({
      layerSettings: {
        ...get().layerSettings,
        ...patch
      }
    });
  },

  setNotice: (text: string) => {
    const entry: NoticeEntry = {
      id: uuidv4(),
      text,
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now()
    };
    set({
      notice: text,
      noticeHistory: [entry, ...get().noticeHistory].slice(0, 30)
    });
  }
}));

export function getActivePage(project: Project): ProjectPage {
  return project.pages[0] || {
    id: "empty",
    name: "empty",
    canvas: { width: 1024, height: 1536 },
    panels: [],
    bubbles: []
  };
}
