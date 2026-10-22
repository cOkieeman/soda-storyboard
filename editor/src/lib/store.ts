import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  ApiError,
  cancelJob as apiCancelJob,
  CLIENT_ID,
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
  getSketchGeometry as apiGetSketchGeometry,
  layoutApply as apiLayoutApply,
  layoutSuggest as apiLayoutSuggest,
  pickRender as apiPickRender,
  savePage as apiSavePage,
  saveCharacterColor as apiSaveCharacterColor,
  skewPage as apiSkewPage,
  validatePage as apiValidatePage
} from "./api";
import {
  createEmptyProject,
  projectPageToSodaPage,
  sodaPageToProjectPage
} from "./project";
import { generatePageSketchGeometry } from "./sketchGeometry";
import { ensureFigureEditor, getFigureId, withFigurePose } from "./figureRig";
import { TEXT_PRESETS, type TextPresetId } from "./elementPresets";
import { resolvedFigures } from "./figures";
import {
  Bubble,
  CharacterSummary,
  Figure,
  FigurePose,
  Job,
  LayoutCandidate,
  PageSummary,
  Panel,
  Project,
  ProjectPage,
  RenderListResponse,
  Selection,
  SketchGeometry,
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
  savePromise: Promise<boolean> | null;
  editRevision: number;
  lastSavedTime: string | null;

  // Dirty tracking for precision & persistence (P4c Items 2 & 3)
  dirtyPanelIds: Set<string>;
  dirtyBubbleIds: Set<string>;

  // Sketch geometry (P4c Item 1)
  sketchGeometry: SketchGeometry | null;
  sketchGeometryUnavailable: boolean;

  // OpenKoma canvas adaptation
  project: Project;
  selection: Selection | null;

  // History / Undo / Redo (P4c Item 5)
  historyPast: Array<{ project: Project; sodaPage: SodaPage }>;
  historyFuture: Array<{ project: Project; sodaPage: SodaPage }>;
  canUndo: boolean;
  canRedo: boolean;
  historyGroup: { key: string; timestamp: number } | null;
  recordEdit: (key: string) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

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

  commandPaletteOpen: boolean;
  importModalOpen: boolean;

  // Notification
  notice: string | null;
  noticeHistory: NoticeEntry[];

  // Lifecycle
  initialized: boolean;
  sseConnected: boolean;
  disconnectSse: (() => void) | null;
  autoSaveTimer: any;

  // Actions
  init: () => Promise<void>;
  selectPage: (pageId: string) => Promise<void>;
  createPage: () => Promise<void>;
  importPageAsNew: (page: SodaPage) => Promise<{ id: string; selected: boolean }>;
  startFirstPanel: () => void;
  deletePage: (pageId: string) => Promise<void>;

  // Canvas & Page updates
  updatePanel: (id: string, patch: Partial<Panel>) => void;
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => void;
  togglePanelCharacter: (panelId: string, characterId: string) => void;
  updateBubble: (id: string, patch: Partial<Bubble>) => void;
  updateSodaText: (id: string, patch: Partial<SodaText>) => void;
  updateSodaOverlay: (id: string, patch: Partial<SodaOverlay>) => void;
  addFigureToPanel: (panelId: string, figure: Figure) => void;
  removeFigureFromPanel: (panelId: string, figureIndex: number) => void;
  updateFigureInPanel: (panelId: string, figureIndex: number, patch: Partial<Figure>) => void;
  addTextPreset: (preset: TextPresetId, panelId?: string) => void;
  addFigurePreset: (pose?: FigurePose, pair?: "handshake" | "hug", panelId?: string) => void;
  updateFigureById: (panelId: string, id: string, patch: Partial<Figure>) => void;
  removeFigureById: (panelId: string, id: string) => void;

  // Floating toolbar actions (P4c Item 5)
  splitPanelHorizontal: (panelId: string) => void;
  splitPanelVertical: (panelId: string) => void;
  addTextToPanel: (panelId: string) => void;

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

  openPreviewModal: () => Promise<void>;
  closePreviewModal: () => void;

  openCompileModal: () => Promise<void>;
  closeCompileModal: () => void;

  openGenerateModal: () => void;
  closeGenerateModal: () => void;
  submitGenerate: (options: { seeds: number; preset: string; model?: string | null; lora?: string }) => Promise<void>;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openImportModal: () => void;
  closeImportModal: () => void;

  pickRender: (renderPath: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  setLayerSettings: (patch: Partial<LayerSettings>) => void;
  updateCharacterColor: (id: string, color: string) => Promise<boolean>;
  setNotice: (text: string) => void;
};

function insertionPanelId(state: Pick<EditorState, "selection" | "sodaPage" | "project">, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const selection = state.selection;
  if (selection?.kind === "panel") return selection.id;
  if (selection?.kind === "figure") return selection.panelId;
  if (selection?.kind === "text" || selection?.kind === "bubble") {
    const panelId = state.sodaPage?.texts.find(text => text.id === selection.id)?.panel_id;
    if (panelId) return panelId;
  }
  return [...(state.project.pages[0]?.panels || [])].sort((a, b) => a.order - b.order)[0]?.id;
}

let pageLoadSequence = 0;
let pageReloadSequence = 0;

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
  savePromise: null,
  editRevision: 0,
  lastSavedTime: null,

  dirtyPanelIds: new Set<string>(),
  dirtyBubbleIds: new Set<string>(),

  sketchGeometry: null,
  sketchGeometryUnavailable: false,

  project: createEmptyProject(),
  selection: null,

  historyPast: [],
  historyFuture: [],
  canUndo: false,
  canRedo: false,
  historyGroup: null,

  // Coalesce typing and continuous adjustments while keeping separate objects
  // and edits separated by a pause independently undoable.
  recordEdit: (key) => {
    const group = get().historyGroup;
    const timestamp = Date.now();
    if (!group || group.key !== key || timestamp - group.timestamp > 750) {
      get().pushHistory();
    }
    set({ historyGroup: { key, timestamp } });
  },

  pushHistory: () => {
    const state = get();
    if (!state.sodaPage) return;
    const snapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds)
    };
    const nextPast = [...state.historyPast.slice(-29), snapshot];
    set({
      historyPast: nextPast,
      historyFuture: [],
      canUndo: true,
      canRedo: false,
      historyGroup: null
    });
  },

  undo: () => {
    const state = get();
    if (state.historyPast.length === 0 || !state.sodaPage) return;
    const prev = state.historyPast[state.historyPast.length - 1];
    const nextPast = state.historyPast.slice(0, -1);
    const currentSnapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds)
    };
    set({
      project: prev.project,
      sodaPage: prev.sodaPage,
      dirtyPanelIds: new Set<string>(),
      dirtyBubbleIds: new Set<string>(),
      sketchGeometry: generatePageSketchGeometry(prev.sodaPage, state.characters as any),
      historyGroup: null,
      historyPast: nextPast,
      historyFuture: [currentSnapshot, ...state.historyFuture],
      canUndo: nextPast.length > 0,
      canRedo: true
    });
    get().triggerAutoSave();
  },

  redo: () => {
    const state = get();
    if (state.historyFuture.length === 0 || !state.sodaPage) return;
    const next = state.historyFuture[0];
    const nextFuture = state.historyFuture.slice(1);
    const currentSnapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds)
    };
    set({
      project: next.project,
      sodaPage: next.sodaPage,
      dirtyPanelIds: new Set<string>(),
      dirtyBubbleIds: new Set<string>(),
      sketchGeometry: generatePageSketchGeometry(next.sodaPage, state.characters as any),
      historyGroup: null,
      historyPast: [...state.historyPast, currentSnapshot],
      historyFuture: nextFuture,
      canUndo: true,
      canRedo: nextFuture.length > 0
    });
    get().triggerAutoSave();
  },

  layerSettings: {
    showSketch: false, // Default OFF per P4c Item 1
    sketchOpacity: 0.35,
    showRender: false,
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

  commandPaletteOpen: false,
  importModalOpen: false,

  notice: null,
  noticeHistory: [],
  initialized: false,
  sseConnected: false,
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
        set((state) => ({ characterDetails: charMap, characters: state.characters.map(character => ({
          ...character, ...(charMap[character.id]?.sketch_color ? { sketch_color: charMap[character.id].sketch_color } : {})
        })) }));
      }).catch(console.error);

      const requestedPage = new URLSearchParams(window.location.hash.slice(1)).get("page");
      if (pages.length > 0) {
        const initialPage = pages.find((page) => page.id === requestedPage)?.id || pages[0].id;
        await get().selectPage(initialPage);
        if (requestedPage && requestedPage !== initialPage) {
          get().setNotice(`页面 ${requestedPage} 不存在，已打开 ${initialPage}`);
        }
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
          const { page_id, message, source, client_id, version } = event.data;
          // Refresh page list
          apiGetPages().then(({ pages: pgs }) => set({ pages: pgs }));

          // Suppress echo from self-save (P4c Item 4)
          if (
            client_id === CLIENT_ID ||
            (source === "editor" && client_id === CLIENT_ID) ||
            version === state.currentVersion
          ) {
            return;
          }

          if (page_id && page_id === state.activePageId) {
            if (!state.hasUnsavedChanges) {
              // Safe to auto-refresh
              get().reloadCurrentPage();
              get().setNotice(message || `页面 ${page_id} 已在外部修改`);
            } else {
              // Local has unsaved changes -> conflict notice
              get().setNotice(`外部文件已变更（${message || "其他修改"}），本地有未保存内容`);
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
      }, (connected) => set({ sseConnected: connected }));

      set({ disconnectSse: disconnect });
    } catch (err: any) {
      console.error("Failed to initialize soda storyboard editor", err);
      get().setNotice(`加载项目失败: ${err.message}`);
    }
  },

  selectPage: async (pageId: string) => {
    const requestSequence = ++pageLoadSequence;
    const state = get();
    // If has unsaved changes, prompt save or preserve
    if (state.hasUnsavedChanges || state.savePromise) {
      if (!(await state.saveCurrentPage())) {
        if (requestSequence === pageLoadSequence) window.history.replaceState(null, "", `#page=${encodeURIComponent(state.activePageId)}`);
        return;
      }
    }
    if (requestSequence !== pageLoadSequence) return;
    const revision = get().editRevision;

    try {
      const { page, version } = await apiGetPage(pageId);
      if (requestSequence !== pageLoadSequence) return;
      if (get().editRevision !== revision) {
        window.history.replaceState(null, "", `#page=${encodeURIComponent(get().activePageId)}`);
        get().setNotice("载入期间有新的编辑，已保留当前页；保存后可再次切换");
        return;
      }
      const openKomaPage = sodaPageToProjectPage(page);

      set({
        activePageId: pageId,
        sodaPage: page,
        currentVersion: version,
        hasUnsavedChanges: false,
        validationIssues: [],
        selection: null,
        dirtyPanelIds: new Set<string>(),
        dirtyBubbleIds: new Set<string>(),
        historyPast: [],
        historyFuture: [],
        historyGroup: null,
        canUndo: false,
        canRedo: false,
        project: {
          id: pageId,
          name: pageId,
          pages: [openKomaPage],
          activePageId: pageId
        }
      });

      window.history.replaceState(null, "", `#page=${encodeURIComponent(pageId)}`);

      // Fetch sketch geometry (P4c Item 1)
      apiGetSketchGeometry(pageId).then((geo) => {
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return;
        set({
          sketchGeometry: geo,
          sketchGeometryUnavailable: !geo
        });
      }).catch(() => {
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return;
        set({
          sketchGeometry: null,
          sketchGeometryUnavailable: true
        });
      });

      // Fetch renders
      apiGetRenders(pageId).then((r) => {
        if (get().activePageId !== pageId || get().currentVersion !== version) return;
        let selectedUrl: string | null = null;
        if (r.selected_render) {
          const matched = r.renders.find((x) => x.path === r.selected_render);
          selectedUrl = matched?.url || `/api/files/${r.selected_render}`;
        }
        set({ renders: r, selectedRenderUrl: selectedUrl });
      }).catch(console.error);

      get().setNotice(`已载入分镜页: ${pageId}`);
    } catch (err: any) {
      if (requestSequence !== pageLoadSequence) return;
      console.error(`Failed to load page ${pageId}`, err);
      get().setNotice(`载入分镜页失败: ${err.message}`);
    }
  },

  createPage: async () => {
    const pageId = `page_${Date.now().toString().slice(-4)}`;
    try {
      const { page } = await apiCreatePage({
        id: pageId,
        canvas_width: 1024,
        canvas_height: 1536,
        panels: [{
          id: "p1", order: 1, shot: "medium", angle: "eye", description: "", caption_en: "",
          character_ids: [], figures: [],
          shape: { type: "rect", x: 40, y: 40, w: 944, h: 1456 }
        }],
        texts: []
      });
      const { pages } = await apiGetPages();
      set({ pages });
      await get().selectPage(page.id);
      get().selectItem({ kind: "panel", id: page.panels[0].id });
      get().setNotice("已新建分镜页，先填写第一格的画面描述");
    } catch (err: any) {
      get().setNotice(`新建分镜页失败: ${err.message}`);
    }
  },

  importPageAsNew: async (page) => {
    const initialPageId = get().activePageId;
    const requestSequence = pageLoadSequence;
    if ((get().hasUnsavedChanges || get().savePromise) && !(await get().saveCurrentPage())) {
      throw new Error("当前页尚未保存，未导入新页。请先处理保存提示后重试。");
    }
    if (get().activePageId !== initialPageId || pageLoadSequence !== requestSequence) {
      throw new Error("当前页面正在切换，未导入新页。请在切换完成后重试。");
    }
    const revision = get().editRevision;
    const imported = JSON.parse(JSON.stringify(page)) as SodaPage;
    imported.id = `import_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
    // Page.from_dict accepts this legacy alias before id. An external alias
    // must never choose the new file's identity or defeat the safe fresh id.
    delete imported.page_id;

    let created: SodaPage;
    let createdVersion: string;
    try {
      ({ page: created, version: createdVersion } = await apiCreatePage(imported));
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const issues = error.data?.errors || error.data?.issues || [];
        get().setNotice(`导入未完成：${issues.map((issue: ValidationIssue) => issue.message).slice(0, 3).join("；") || error.message}`);
      }
      throw error;
    }

    // Once POST succeeds, never report a later list/load failure as a failed
    // import: the file exists and another import would create a duplicate.
    try {
      const { pages } = await apiGetPages();
      set({ pages });
    } catch {
      const summary: PageSummary = {
        id: created.id, description: created.description || "", panel_count: created.panels.length, version: createdVersion
      };
      set({ pages: [...get().pages.filter(item => item.id !== created.id), summary] });
      get().setNotice(`已导入新页 ${created.id}，页面列表刷新失败；请在左侧选择该页，勿重复导入。`);
      return { id: created.id, selected: false };
    }

    if (get().activePageId !== initialPageId || get().editRevision !== revision || get().hasUnsavedChanges || pageLoadSequence !== requestSequence) {
      get().setNotice(`已导入新页 ${created.id}，保留当前编辑位置；可从左侧打开。`);
      return { id: created.id, selected: false };
    }
    await get().selectPage(created.id);
    const selected = get().activePageId === created.id && get().sodaPage?.id === created.id;
    get().setNotice(selected ? `已导入新分镜页 ${created.id}` : `已导入新页 ${created.id}，未自动打开；可从左侧选择，勿重复导入。`);
    return { id: created.id, selected };
  },

  startFirstPanel: () => {
    const state = get();
    if (!state.sodaPage) return;
    if (state.sodaPage.panels.length) {
      state.selectItem({ kind: "panel", id: state.sodaPage.panels[0].id });
      return;
    }
    state.pushHistory();
    const panel: SodaPanel = {
      id: "p1", order: 1, shot: "medium", angle: "eye", description: "", caption_en: "",
      character_ids: [], figures: [],
      shape: { type: "rect", x: 40, y: 40, w: Math.max(40, state.sodaPage.canvas_width - 80), h: Math.max(40, state.sodaPage.canvas_height - 80) }
    };
    const nextPage = { ...state.sodaPage, panels: [panel] };
    set({
      sodaPage: nextPage,
      project: { ...state.project, pages: [sodaPageToProjectPage(nextPage)] },
      sketchGeometry: generatePageSketchGeometry(nextPage, state.characters as any),
      selection: { kind: "panel", id: panel.id },
      dirtyPanelIds: new Set([panel.id])
    });
    get().triggerAutoSave();
  },

  deletePage: async (pageId: string) => {
    const state = get();
    if (state.pages.length <= 1) {
      get().setNotice("项目中至少保留一个页面");
      return;
    }
    try {
      if (pageId === get().activePageId && (get().hasUnsavedChanges || get().savePromise)) {
        if (!(await get().saveCurrentPage())) return;
      }
      const version = pageId === get().activePageId ? get().currentVersion : (await apiGetPage(pageId)).version;
      await apiDeletePage(pageId, version);
      const { pages } = await apiGetPages();
      set({ pages });
      if (get().activePageId === pageId && pages.length > 0) {
        clearTimeout(get().autoSaveTimer);
        set({ hasUnsavedChanges: false, autoSaveTimer: null, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set() });
        await get().selectPage(pages[0].id);
      }
      get().setNotice(`分镜页 ${pageId} 已移入 .trash 目录`);
    } catch (err: any) {
      get().setNotice(`删除分镜页失败: ${err.message}`);
    }
  },

  // Update canvas panel
  updatePanel: (id: string, patch: Partial<Panel>) => {
    get().recordEdit(`panel:${id}`);
    const state = get();
    state.dirtyPanelIds.add(id);
    const activePage = state.project.pages[0];
    if (!activePage) return;

    const originalPanel = activePage.panels.find(panel => panel.id === id);
    const dx = originalPanel && patch.x !== undefined ? patch.x - originalPanel.x : 0;
    const dy = originalPanel && patch.y !== undefined ? patch.y - originalPanel.y : 0;

    const nextPanels = activePage.panels.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...patch
      };
    });

    const nextBubbles = activePage.bubbles.map(bubble => {
      if ((!dx && !dy) || bubble.sodaData?.panel_id !== id) return bubble;
      state.dirtyBubbleIds.add(bubble.id);
      return { ...bubble, x: bubble.x + dx, y: bubble.y + dy };
    });
    const nextActivePage = { ...activePage, panels: nextPanels, bubbles: nextBubbles };
    const nextProject = {
      ...state.project,
      pages: [
        nextActivePage
      ]
    };

    const nextSodaPage = state.sodaPage ? projectPageToSodaPage(nextActivePage, {
      ...state.sodaPage,
      ...(state.sodaPage.overlays ? { overlays: state.sodaPage.overlays.map(overlay => overlay.panel_id === id && (dx || dy)
        ? { ...overlay, rect: { ...overlay.rect, x: overlay.rect.x + dx, y: overlay.rect.y + dy } } : overlay) } : {})
    }, state.dirtyPanelIds, state.dirtyBubbleIds) : null;
    set({ project: nextProject, ...(nextSodaPage ? { sodaPage: nextSodaPage, sketchGeometry: generatePageSketchGeometry(nextSodaPage, state.characters as any) } : {}) });
    get().triggerAutoSave();
  },

  // Update Soda panel metadata (shot, angle, figures, description, caption_en)
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => {
    get().recordEdit(`panel:${id}`);
    const state = get();
    if (patch.shape) state.dirtyPanelIds.add(id);
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

    // Real-time local stick figure geometry update for 0ms lag
    const nextSketch = generatePageSketchGeometry(
      projectPageToSodaPage({ ...activePage, panels: nextPanels }, nextSodaPage, state.dirtyPanelIds, state.dirtyBubbleIds),
      state.characters as any
    );

    set({
      sodaPage: nextSodaPage,
      sketchGeometry: nextSketch,
      sketchGeometryUnavailable: false,
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

  // The cast buttons edit the visible people as well as the generated cast.
  togglePanelCharacter: (panelId, characterId) => {
    const state = get();
    const panel = state.project.pages[0]?.panels.find(item => item.id === panelId);
    if (!panel?.sodaData || !state.sodaPage) return;
    const figures = resolvedFigures(panel.sodaData, state.sodaPage.reading_direction)
      .map((figure, index) => ({ ...figure, id: getFigureId(figure, index) }));
    const present = figures.some(figure => figure.character_id === characterId);
    const nextFigures: Figure[] = present ? figures.filter(figure => figure.character_id !== characterId) : [
      ...figures,
      {
        id: `fig_${uuidv4().slice(0, 8)}`,
        character_id: characterId,
        pose: "stand",
        position: figures.length ? (state.sodaPage.reading_direction === "rtl" ? 0.23 : 0.77) : "center",
        facing: "front"
      }
    ];
    state.pushHistory();
    set({ historyGroup: { key: `panel:${panelId}`, timestamp: Date.now() } });
    get().updateSodaPanel(panelId, {
      figures: nextFigures,
      character_ids: [...new Set(nextFigures.map(figure => figure.character_id).filter(Boolean))]
    });
    set({ historyGroup: null });
  },

  // Update Bubble (bidirectional sync with sodaData.bbox, fixing S1)
  updateBubble: (id: string, patch: Partial<Bubble>) => {
    get().recordEdit(`text:${id}`);
    const state = get();
    state.dirtyBubbleIds.add(id);
    const activePage = state.project.pages[0];
    if (!activePage) return;

    const nextBubbles = activePage.bubbles.map((b) => {
      if (b.id !== id) return b;
      return { ...b, ...patch };
    });

    let nextSodaTexts = state.sodaPage?.texts || [];
    if (state.sodaPage) {
      nextSodaTexts = state.sodaPage.texts.map((t) => {
        if (t.id !== id) return t;
        const targetB = nextBubbles.find((item) => item.id === id);
        return {
          ...t,
          text: patch.text ?? t.text,
          direction: patch.direction ?? t.direction,
          tail_tip: patch.tailTip !== undefined ? patch.tailTip : t.tail_tip,
          bbox: {
            type: "rect" as const,
            x: targetB ? targetB.x : (patch.x ?? t.bbox?.x ?? 0),
            y: targetB ? targetB.y : (patch.y ?? t.bbox?.y ?? 0),
            w: targetB ? targetB.width : (patch.width ?? t.bbox?.w ?? 100),
            h: targetB ? targetB.height : (patch.height ?? t.bbox?.h ?? 200)
          }
        };
      });
    }

    set({
      project: {
        ...state.project,
        pages: [{ ...activePage, bubbles: nextBubbles }]
      },
      sodaPage: state.sodaPage ? { ...state.sodaPage, texts: nextSodaTexts } : null
    });
    get().triggerAutoSave();
  },

  // Update text box (bidirectional sync with OpenKoma bubble)
  updateSodaText: (id: string, patch: Partial<SodaText>) => {
    get().recordEdit(`text:${id}`);
    const state = get();
    state.dirtyBubbleIds.add(id);
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
          x: patch.bbox ? patch.bbox.x : b.x,
          y: patch.bbox ? patch.bbox.y : b.y,
          width: patch.bbox ? Math.max(30, patch.bbox.w) : b.width,
          height: patch.bbox ? Math.max(30, patch.bbox.h) : b.height,
          text: patch.text ?? b.text,
          fontSize: typeof patch.font_size === "number" && Number.isFinite(patch.font_size) ? Math.max(1, Math.min(512, patch.font_size)) : b.fontSize,
          ...(patch.bubble ? {
            type: patch.bubble === "box" || patch.bubble === "none" ? "rect" as const : "rounded" as const,
            background: patch.bubble === "none" ? "transparent" : "#ffffff",
            borderColor: patch.bubble === "none" ? "transparent" : "#171815",
            borderWidth: patch.bubble === "none" ? 0 : 2
          } : {}),
          direction: patch.direction ? (patch.direction as any) : b.direction,
          tailTip: patch.tail_tip !== undefined ? patch.tail_tip : b.tailTip,
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
    get().recordEdit(`overlay:${id}`);
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

    const created = { ...figure, id: figure.id || `fig_${uuidv4().slice(0, 8)}` };
    const figures = [...resolvedFigures(targetPanel, state.sodaPage.reading_direction).map((item, index) => ({ ...item, id: getFigureId(item, index) })), created];
    const character_ids = Array.from(
      new Set([...(targetPanel.character_ids || []), figure.character_id])
    );
    state.pushHistory();
    set({ historyGroup: { key: `panel:${panelId}`, timestamp: Date.now() } });
    get().updateSodaPanel(panelId, { figures, character_ids });
    set({ selection: { kind: "figure", panelId, id: created.id }, historyGroup: null });
  },

  removeFigureFromPanel: (panelId: string, figureIndex: number) => {
    const state = get();
    const targetPanel = state.sodaPage?.panels.find((p) => p.id === panelId);
    if (!targetPanel) return;
    const figure = resolvedFigures(targetPanel, state.sodaPage?.reading_direction)[figureIndex];
    if (figure) state.removeFigureById(panelId, getFigureId(figure, figureIndex));
  },

  updateFigureInPanel: (panelId: string, figureIndex: number, patch: Partial<Figure>) => {
    const state = get();
    const targetPanel = state.sodaPage?.panels.find((p) => p.id === panelId);
    if (!targetPanel) return;
    const figure = resolvedFigures(targetPanel, state.sodaPage?.reading_direction)[figureIndex];
    if (figure) state.updateFigureById(panelId, getFigureId(figure, figureIndex), patch);
  },

  addFigurePreset: (pose = "stand", pair, panelId) => {
    const state = get();
    const activePage = state.project.pages[0];
    if (!state.sodaPage || !activePage) return;
    const targetId = insertionPanelId(state, panelId);
    const panel = activePage.panels.find(item => item.id === targetId);
    if (!panel) return;
    const existing = resolvedFigures(panel.sodaData!, state.sodaPage.reading_direction).map((figure, index) => ({ ...figure, id: getFigureId(figure, index) }));
    const size = Math.max(24, Math.min(panel.height * 0.68, panel.width * (pair ? 0.9 : 1.2), 400));
    const chosenPose = pair || pose;
    const count = pair ? 2 : 1;
    const gap = size * (pair === "hug" ? 0.4 : 0.66);
    const figures: Figure[] = Array.from({ length: count }, (_, index) => {
      const characterId = state.characters[index % Math.max(1, state.characters.length)]?.id || "";
      const figure: Figure = { id: `fig_${uuidv4().slice(0, 8)}`, character_id: characterId, pose: chosenPose, position: 0.5, facing: index ? "left" : "right", framing: "full" };
      const editor = ensureFigureEditor(figure, { width: panel.width, height: panel.height, shot: "full" });
      figure.editor = { ...withFigurePose(editor, chosenPose), style: "stick", size,
        x: panel.width / 2 + (pair ? (index - 0.5) * gap : ((existing.length % 3) - 1) * size * 0.12),
        y: Math.min(panel.height - 12, Math.max(size + 12, panel.height * 0.85)), flip: index === 1 };
      figure.position = Math.max(0, Math.min(1, figure.editor.x / panel.width));
      return figure;
    });
    state.pushHistory();
    // Keep insertion as a single undo step, including both members of a pair.
    set({ historyGroup: { key: `panel:${panel.id}`, timestamp: Date.now() } });
    const nextFigures = [...existing, ...figures];
    get().updateSodaPanel(panel.id, { figures: nextFigures, character_ids: [...new Set(nextFigures.map(item => item.character_id).filter(Boolean))] });
    set({ selection: { kind: "figure", panelId: panel.id, id: figures[0].id! }, historyGroup: null });
    get().setNotice(pair === "handshake" ? "已添加握手双人，可分别拖动和编辑" : pair === "hug" ? "已添加拥抱双人，可分别拖动和编辑" : "已添加人物，拖动身体移动，拖动圆点调整关节");
  },

  updateFigureById: (panelId, id, patch) => {
    const state = get();
    const panel = state.project.pages[0]?.panels.find(item => item.id === panelId);
    if (!panel?.sodaData) return;
    const figures = resolvedFigures(panel.sodaData, state.sodaPage?.reading_direction).map((figure, index) => ({ ...figure, id: getFigureId(figure, index) }));
    const index = figures.findIndex((figure, idx) => getFigureId(figure, idx) === id);
    if (index < 0) return;
    const original = figures[index];
    let next = { ...original, ...patch, id: original.id || id };
    const bounds = { width: panel.width, height: panel.height, shot: panel.sodaData.shot };
    if (patch.editor) {
      next.editor = ensureFigureEditor(next, bounds);
      next.position = Math.max(0, Math.min(1, next.editor.x / panel.width));
      if (!patch.facing && next.editor.flip !== ensureFigureEditor(original, bounds).flip) {
        next.facing = next.editor.flip ? "left" : "right";
      }
    } else if (original.editor) {
      let editor = ensureFigureEditor(original, bounds);
      if (patch.pose) editor = withFigurePose(editor, patch.pose);
      if (patch.position !== undefined) {
        const position = typeof patch.position === "number" ? patch.position : ({ left: 0.23, center: 0.5, right: 0.77 } as const)[patch.position];
        editor = { ...editor, x: position * panel.width };
      }
      if (patch.facing) editor = { ...editor, flip: patch.facing === "left" };
      next = { ...next, editor };
    }
    figures[index] = next;
    // Separate figure edits from panel description and other figures in history.
    state.recordEdit(`figure:${panelId}:${id}`);
    set({ historyGroup: { key: `panel:${panelId}`, timestamp: Date.now() } });
    get().updateSodaPanel(panelId, { figures, character_ids: [...new Set(figures.map(item => item.character_id).filter(Boolean))] });
    set({ historyGroup: { key: `figure:${panelId}:${id}`, timestamp: Date.now() } });
  },

  removeFigureById: (panelId, id) => {
    const state = get();
    const panel = state.project.pages[0]?.panels.find(item => item.id === panelId);
    if (!panel?.sodaData) return;
    const original = resolvedFigures(panel.sodaData, state.sodaPage?.reading_direction).map((figure, index) => ({ ...figure, id: getFigureId(figure, index) }));
    const figures = original.filter((figure, index) => getFigureId(figure, index) !== id);
    if (figures.length === original.length) return;
    state.pushHistory();
    set({ historyGroup: { key: `panel:${panelId}`, timestamp: Date.now() } });
    get().updateSodaPanel(panelId, { figures, character_ids: [...new Set(figures.map(item => item.character_id).filter(Boolean))] });
    set({ selection: { kind: "panel", id: panelId }, historyGroup: null });
    get().setNotice("已删除人物");
  },

  // Floating mini-toolbar actions (P4c Item 5)
  splitPanelHorizontal: (panelId: string) => {
    const state = get();
    const activePage = state.project.pages[0];
    if (!activePage || !state.sodaPage) return;
    const target = activePage.panels.find((p) => p.id === panelId);
    if (!target) return;
    get().pushHistory();

    const gap = target.gap || 20;
    const halfHeight = Math.max(30, Math.floor((target.height - gap) / 2));
    const newPanelId = `p_${uuidv4().slice(0, 6)}`;
    const newOrder = target.order + 1;

    const updatedPanels = activePage.panels.map((p) => {
      if (p.id === panelId) {
        return {
          ...p,
          height: halfHeight,
          sodaData: {
            ...p.sodaData,
            shape: { type: "rect" as const, x: p.x, y: p.y, w: p.width, h: halfHeight }
          }
        };
      }
      if (p.order >= newOrder) {
        return { ...p, order: p.order + 1 };
      }
      return p;
    });

    const newPanel: Panel = {
      id: newPanelId,
      order: newOrder,
      x: target.x,
      y: target.y + halfHeight + gap,
      width: target.width,
      height: halfHeight,
      rotation: 0,
      shape: { topLeft: 0, topRight: 1, bottomRight: 1, bottomLeft: 0 },
      borderWidth: target.borderWidth,
      borderColor: target.borderColor,
      borderRadius: 0,
      gap: target.gap,
      sodaData: {
        id: newPanelId,
        order: newOrder,
        shape: { type: "rect", x: target.x, y: target.y + halfHeight + gap, w: target.width, h: halfHeight },
        shot: "medium",
        angle: "eye",
        character_ids: [],
        description: "",
        caption_en: "",
        figures: []
      }
    };

    updatedPanels.push(newPanel);
    updatedPanels.sort((a, b) => a.order - b.order);

    state.dirtyPanelIds.add(panelId);
    state.dirtyPanelIds.add(newPanelId);

    const nextPage = { ...activePage, panels: updatedPanels };
    const nextSodaPage = projectPageToSodaPage(nextPage, state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds);
    nextPage.panels = nextPage.panels.map(panel => ({ ...panel, sodaData: nextSodaPage.panels.find(item => item.id === panel.id)! }));
    set({
      sodaPage: nextSodaPage,
      sketchGeometry: generatePageSketchGeometry(nextSodaPage, state.characters as any),
      project: {
        ...state.project,
        pages: [nextPage]
      },
      selection: { kind: "panel", id: newPanelId }
    });
    get().triggerAutoSave();
    get().setNotice("已横向切分分镜");
  },

  splitPanelVertical: (panelId: string) => {
    const state = get();
    const activePage = state.project.pages[0];
    if (!activePage || !state.sodaPage) return;
    const target = activePage.panels.find((p) => p.id === panelId);
    if (!target) return;
    get().pushHistory();

    const gap = target.gap || 20;
    const halfWidth = Math.max(30, Math.floor((target.width - gap) / 2));
    const newPanelId = `p_${uuidv4().slice(0, 6)}`;
    const newOrder = target.order + 1;

    const updatedPanels = activePage.panels.map((p) => {
      if (p.id === panelId) {
        return {
          ...p,
          width: halfWidth,
          sodaData: {
            ...p.sodaData,
            shape: { type: "rect" as const, x: p.x, y: p.y, w: halfWidth, h: p.height }
          }
        };
      }
      if (p.order >= newOrder) {
        return { ...p, order: p.order + 1 };
      }
      return p;
    });

    const newPanel: Panel = {
      id: newPanelId,
      order: newOrder,
      x: target.x + halfWidth + gap,
      y: target.y,
      width: halfWidth,
      height: target.height,
      rotation: 0,
      shape: { topLeft: 0, topRight: 1, bottomRight: 1, bottomLeft: 0 },
      borderWidth: target.borderWidth,
      borderColor: target.borderColor,
      borderRadius: 0,
      gap: target.gap,
      sodaData: {
        id: newPanelId,
        order: newOrder,
        shape: { type: "rect", x: target.x + halfWidth + gap, y: target.y, w: halfWidth, h: target.height },
        shot: "medium",
        angle: "eye",
        character_ids: [],
        description: "",
        caption_en: "",
        figures: []
      }
    };

    updatedPanels.push(newPanel);
    updatedPanels.sort((a, b) => a.order - b.order);

    state.dirtyPanelIds.add(panelId);
    state.dirtyPanelIds.add(newPanelId);

    const nextPage = { ...activePage, panels: updatedPanels };
    const nextSodaPage = projectPageToSodaPage(nextPage, state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds);
    nextPage.panels = nextPage.panels.map(panel => ({ ...panel, sodaData: nextSodaPage.panels.find(item => item.id === panel.id)! }));
    set({
      sodaPage: nextSodaPage,
      sketchGeometry: generatePageSketchGeometry(nextSodaPage, state.characters as any),
      project: {
        ...state.project,
        pages: [nextPage]
      },
      selection: { kind: "panel", id: newPanelId }
    });
    get().triggerAutoSave();
    get().setNotice("已纵向切分分镜");
  },

  addTextToPanel: (panelId: string) => get().addTextPreset("speech_vertical", panelId),

  addTextPreset: (presetId, panelId) => {
    const state = get();
    const activePage = state.project.pages[0];
    if (!activePage || !state.sodaPage) return;
    const targetId = insertionPanelId(state, panelId);
    const panel = activePage.panels.find((p) => p.id === targetId);
    if (!panel) return;
    const preset = TEXT_PRESETS[presetId];
    const width = Math.min(preset.width, Math.max(30, panel.width - 16));
    const height = Math.min(preset.height, Math.max(30, panel.height - 16));
    const offset = activePage.bubbles.filter(item => item.sodaData?.panel_id === panel.id).length % 5 * 16;
    const px = panel.x + Math.min(Math.max(8, (panel.width - width) / 2 + offset), Math.max(8, panel.width - width - 8));
    const py = panel.y + Math.min(Math.max(8, (panel.height - height) / 2 + offset), Math.max(8, panel.height - height - 8));
    state.pushHistory();

    const newTextId = `t_${uuidv4().slice(0, 6)}`;
    const newBubble: Bubble = {
      id: newTextId,
      type: preset.bubble === "box" || preset.bubble === "none" ? "rect" : "rounded",
      x: px,
      y: py,
      width,
      height,
      text: preset.text,
      direction: preset.direction,
      fontSize: preset.fontSize,
      fontFamily: "Consolas, 'Microsoft YaHei', sans-serif",
      textColor: "#171815",
      background: preset.bubble === "none" ? "transparent" : "#ffffff",
      borderColor: preset.bubble === "none" ? "transparent" : "#171815",
      borderWidth: preset.bubble === "none" ? 0 : 2,
      tailTip: null,
      sodaData: {
        id: newTextId,
        text: preset.text,
        kind: preset.kind,
        panel_id: panel.id,
        speaker_id: null,
        direction: preset.direction,
        bubble: preset.bubble,
        font_size: preset.fontSize,
        bbox: { type: "rect", x: px, y: py, w: width, h: height }
      }
    };

    state.dirtyBubbleIds.add(newTextId);
    set({
      project: {
        ...state.project,
        pages: [{ ...activePage, bubbles: [...activePage.bubbles, newBubble] }]
      },
      sodaPage: state.sodaPage ? {
        ...state.sodaPage,
        texts: [...state.sodaPage.texts, newBubble.sodaData as SodaText]
      } : null,
      selection: { kind: "text", id: newTextId }
    });
    get().triggerAutoSave();
    get().setNotice(`已添加${preset.label}，在右侧编辑文字`);
  },

  selectItem: (selection: Selection | null) => {
    set({ selection });
  },

  deleteSelection: () => {
    const state = get();
    const sel = state.selection;
    if (!sel || !state.sodaPage) return;
    if (sel.kind === "figure") {
      state.removeFigureById(sel.panelId, sel.id);
      return;
    }
    get().pushHistory();

    const activePage = state.project.pages[0];
    if (sel.kind === "panel") {
      const currentPage = projectPageToSodaPage(activePage, state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds);
      const removedTextIds = new Set(currentPage.texts.filter(text => text.panel_id === sel.id).map(text => text.id));
      const nextPanels = activePage.panels.filter((p) => p.id !== sel.id);
      const nextSodaPage = {
        ...currentPage,
        panels: currentPage.panels.filter(panel => panel.id !== sel.id),
        texts: currentPage.texts.filter(text => !removedTextIds.has(text.id)),
        ...(currentPage.overlays ? { overlays: currentPage.overlays.filter(overlay => overlay.panel_id !== sel.id) } : {})
      };
      set({
        selection: null,
        sodaPage: nextSodaPage,
        sketchGeometry: generatePageSketchGeometry(nextSodaPage, state.characters as any),
        project: {
          ...state.project,
          pages: [{ ...activePage, panels: nextPanels, bubbles: activePage.bubbles.filter(bubble => !removedTextIds.has(bubble.id)) }]
        }
      });
      get().triggerAutoSave();
      get().setNotice("已删除分镜");
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
      get().setNotice("已删除台词框");
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
  saveCurrentPage: (_force = false): Promise<boolean> => {
    const initial = get();
    if (initial.savePromise) return initial.savePromise;
    if (!initial.sodaPage || !initial.activePageId) return Promise.resolve(false);
    const pageId = initial.activePageId;

    // Every caller shares one drain: edits made during a PUT get a subsequent
    // PUT with the returned version, even if their autosave timer already fired.
    const drain = async (): Promise<boolean> => {
      try {
        while (get().activePageId === pageId && get().sodaPage) {
          const state = get();
          const revision = state.editRevision;
          const pageToSave = projectPageToSodaPage(
            state.project.pages[0], state.sodaPage!, state.dirtyPanelIds, state.dirtyBubbleIds
          );
          const res = await apiSavePage(pageId, pageToSave, state.currentVersion);
          if (get().activePageId !== pageId) return false;

          if (res.success) {
            const unchanged = get().editRevision === revision;
            set({
              currentVersion: res.version,
              hasUnsavedChanges: !unchanged,
              lastSavedTime: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
              validationIssues: res.warnings || [],
              ...(unchanged ? {
                sodaPage: res.page || pageToSave,
                dirtyPanelIds: new Set<string>(), dirtyBubbleIds: new Set<string>()
              } : {})
            });
            if (!unchanged) continue;

            clearTimeout(get().autoSaveTimer);
            set({ autoSaveTimer: null });
            apiGetSketchGeometry(pageId).then((geo) => {
              const latest = get();
              if (geo && latest.activePageId === pageId && latest.currentVersion === res.version && latest.editRevision === revision && !latest.hasUnsavedChanges) {
                set({ sketchGeometry: geo, sketchGeometryUnavailable: false });
              }
            }).catch(console.error);
            get().setNotice("分镜已保存");
            return true;
          }

          set({ hasUnsavedChanges: true });
          if (res.status === 409) {
            const latest = get();
            const backup = projectPageToSodaPage(latest.project.pages[0], latest.sodaPage!, latest.dirtyPanelIds, latest.dirtyBubbleIds);
            set({ conflictModal: {
              open: true, serverPage: res.current, serverVersion: res.version, reason: res.reason,
              localBackup: JSON.stringify(backup, null, 2)
            } });
            get().setNotice("保存冲突: 页面已被外部修改");
          } else if (res.status === 422) {
            const issues = res.issues || res.errors || [];
            set({ validationIssues: issues });
            get().setNotice(`有 ${issues.length} 个问题，已在右栏列出`);
          } else {
            get().setNotice(`保存失败: ${res.error}`);
          }
          return false;
        }
      } catch (err: any) {
        if (get().activePageId === pageId) {
          set({ hasUnsavedChanges: true });
          get().setNotice(`保存异常: ${err.message}`);
        }
      }
      return false;
    };

    const promise = drain().finally(() => {
      if (get().savePromise === promise) set({ savePromise: null, isSaving: false });
    });
    set({ savePromise: promise, isSaving: true });
    return promise;
  },

  triggerAutoSave: () => {
    const state = get();
    set({ hasUnsavedChanges: true, editRevision: state.editRevision + 1 });
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
    const pageId = state.activePageId;
    const revision = state.editRevision;
    const requestedVersion = state.currentVersion;
    const requestSequence = pageLoadSequence;
    const reloadSequence = ++pageReloadSequence;
    try {
      const { page, version } = await apiGetPage(pageId);
      if (requestSequence !== pageLoadSequence || reloadSequence !== pageReloadSequence || get().activePageId !== pageId || get().editRevision !== revision || get().currentVersion !== requestedVersion) return;
      const openKomaPage = sodaPageToProjectPage(page);

      set({
        sodaPage: page,
        currentVersion: version,
        hasUnsavedChanges: false,
        dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(),
        validationIssues: [],
        project: {
          ...get().project,
          pages: [openKomaPage]
        }
      });

      apiGetSketchGeometry(pageId).then((geo) => {
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return;
        set({
          sketchGeometry: geo,
          sketchGeometryUnavailable: !geo
        });
      }).catch(() => {
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return;
        set({
          sketchGeometry: null,
          sketchGeometryUnavailable: true
        });
      });

      apiGetRenders(pageId).then((r) => {
        if (get().activePageId !== pageId || get().currentVersion !== version) return;
        let selectedUrl: string | null = null;
        if (r.selected_render) {
          const matched = r.renders.find((x) => x.path === r.selected_render);
          selectedUrl = matched?.url || `/api/files/${r.selected_render}`;
        }
        set({ renders: r, selectedRenderUrl: selectedUrl });
      }).catch(console.error);
    } catch (err: any) {
      if (requestSequence !== pageLoadSequence || reloadSequence !== pageReloadSequence || get().activePageId !== pageId) return;
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
    const pageId = state.activePageId;
    if (!(await get().saveCurrentPage()) || get().activePageId !== pageId) return;
    const version = get().currentVersion;

    set({
      layoutModal: {
        open: true,
        candidates: [],
        loading: true,
        error: undefined
      }
    });

    try {
      const res = await apiLayoutSuggest(pageId, { candidates: 6, skew: 0 });
      if (get().activePageId !== pageId || get().currentVersion !== version) return;
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
    const pageId = get().activePageId;
    if (!pageId) return;
    // A clean PUT still replaces the file and changes its mtime-based ETag,
    // invalidating the candidate created for the current saved version.
    if ((get().hasUnsavedChanges || get().savePromise) && !(await get().saveCurrentPage())) return;
    if (get().activePageId !== pageId) return;
    const state = get();
    const revision = state.editRevision;
    const snapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage!, state.dirtyPanelIds, state.dirtyBubbleIds)
    };

    try {
      const res = await apiLayoutApply(pageId, candidateId, state.currentVersion);
      if (get().activePageId !== pageId) return;
      if (get().editRevision !== revision) {
        set({ currentVersion: res.version, layoutModal: { open: false, candidates: [], loading: false } });
        get().setNotice("应用版式期间有新的编辑，已保留你的修改；请重新选择版式");
        return;
      }
      const openKomaPage = sodaPageToProjectPage(res.page);
      set({
        sodaPage: res.page,
        currentVersion: res.version,
        hasUnsavedChanges: false,
        dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(),
        editRevision: revision + 1,
        sketchGeometry: generatePageSketchGeometry(res.page, get().characters as any),
        historyPast: [...get().historyPast.slice(-29), snapshot], historyFuture: [],
        historyGroup: null, canUndo: true, canRedo: false,
        validationIssues: res.warnings || [],
        layoutModal: { open: false, candidates: [], loading: false },
        project: {
          ...get().project,
          pages: [openKomaPage]
        }
      });
      get().setNotice("已应用版式候选");
    } catch (err: any) {
      get().setNotice(`应用版式失败: ${err.message}`);
    }
  },

  openPreviewModal: async () => {
    const pageId = get().activePageId;
    if (!pageId || !(await get().saveCurrentPage()) || get().activePageId !== pageId) return;
    const url = `/api/pages/${encodeURIComponent(pageId)}/preview.png?style=sketch&scale=1&v=${encodeURIComponent(get().currentVersion)}`;
    set({ previewModal: { open: true, url } });
  },

  closePreviewModal: () => {
    set({ previewModal: { open: false, url: null } });
  },

  openCompileModal: async () => {
    const pageId = get().activePageId;
    if (!pageId || !(await get().saveCurrentPage()) || get().activePageId !== pageId) return;

    try {
      const res = await apiCompilePage(pageId, { with_ids: true, slant_mode: "cut" });
      if (get().activePageId !== pageId) return;
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

  openCommandPalette: () => {
    set({ commandPaletteOpen: true });
  },

  closeCommandPalette: () => {
    set({ commandPaletteOpen: false });
  },

  openImportModal: () => {
    set({ importModalOpen: true });
  },

  closeImportModal: () => {
    set({ importModalOpen: false });
  },

  submitGenerate: async (options) => {
    const state = get();
    if (!state.activePageId) return;
    const pageId = state.activePageId;

    set({ generateModal: { ...state.generateModal, loading: true, error: undefined } });

    try {
      if (!(await get().saveCurrentPage()) || get().activePageId !== pageId) {
        set({ generateModal: { ...get().generateModal, loading: false, error: "页面尚未保存，请先处理保存提示后重试" } });
        return;
      }
      const job = await apiGeneratePage(pageId, options);
      if (get().activePageId !== pageId) return;
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
      // A quick CPU pick may complete over SSE before its POST response arrives.
      // Do not replace that terminal state with the queued response snapshot.
      set((latest) => ({
        activeJob: latest.activeJob?.id === job.id && ["completed", "failed", "cancelled"].includes(latest.activeJob.status)
          ? latest.activeJob
          : job
      }));
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

  updateCharacterColor: async (id, color) => {
    try {
      const character = await apiSaveCharacterColor(id, color);
      set((state) => ({
        characters: state.characters.map(item => item.id === id ? { ...item, sketch_color: character.sketch_color } : item),
        characterDetails: { ...state.characterDetails, [id]: character },
        sketchGeometry: state.sketchGeometry ? { ...state.sketchGeometry, panels: state.sketchGeometry.panels.map(panel => ({
          ...panel, figures: panel.figures.map(figure => figure.character_id === id ? { ...figure, color: character.sketch_color! } : figure)
        })) } : null
      }));
      get().setNotice(`已保存 ${character.display_name} 的人物颜色`);
      return true;
    } catch (error) {
      get().setNotice(error instanceof ApiError && error.status === 409
        ? "角色资料已变更，颜色未保存。请刷新后重新选择颜色。"
        : `人物颜色保存失败：${(error as Error).message}`);
      return false;
    }
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
