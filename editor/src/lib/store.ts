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
  getJob as apiGetJob,
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
import { alignPageSelections, copyPageSelections, deletePageSelections, isSelectionHidden, isSelectionLocked, movePageSelections, normalizeSelections, panelHasLockedChildren, pastePageSelections, selectionKey, stylePageSelections, type SelectionClipboard } from "./batchEditing";
import { clearRecoveryDraft, discoverProjectIdentity, readObjectFlags, readRecoveryDraft, writeObjectFlags, writeRecoveryDraft } from "./recovery";
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
  ObjectFlags,
  RecoveryDraft,
  SelectionAlignment,
  SelectionStylePatch,
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

type HistorySnapshot = { project: Project; sodaPage: SodaPage; label?: string; selection?: Selection | null; selections?: Selection[] };
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
  saveStatus: "saved" | "dirty" | "saving" | "error" | "conflict";
  saveError: string | null;
  projectIdentity: string;
  recoveryDraft: RecoveryDraft | null;
  recoveryStorageError: string | null;

  // Dirty tracking for precision & persistence (P4c Items 2 & 3)
  dirtyPanelIds: Set<string>;
  dirtyBubbleIds: Set<string>;

  // Sketch geometry (P4c Item 1)
  sketchGeometry: SketchGeometry | null;
  sketchGeometryUnavailable: boolean;

  // OpenKoma canvas adaptation
  project: Project;
  selection: Selection | null;
  selections: Selection[];
  objectFlags: Record<string, ObjectFlags>;
  clipboard: SelectionClipboard | null;

  // History / Undo / Redo (P4c Item 5)
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  undoLabel: string | null;
  redoLabel: string | null;
  canUndo: boolean;
  canRedo: boolean;
  historyGroup: { key: string; timestamp: number } | null;
  recordEdit: (key: string, label?: string) => void;
  pushHistory: (label?: string) => void;
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
    loading?: boolean;
    error?: string;
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
  setLegacyCaptionMode: (enabled: boolean) => void;
  setPageLoraCharacter: (characterId: string | undefined) => void;
  updatePanel: (id: string, patch: Partial<Panel>) => void;
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => void;
  togglePanelCharacter: (panelId: string, characterId: string) => void;
  updateBubble: (id: string, patch: Partial<Bubble>) => void;
  updateSodaText: (id: string, patch: Partial<SodaText>) => void;
  updateSodaOverlay: (id: string, patch: Partial<SodaOverlay>) => void;
  updateObjectBox: (id: string, patch: Partial<import("../types").SodaObject>) => void;
  addObjectBox: () => void;
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

  selectItem: (selection: Selection | null, additive?: boolean) => void;
  selectItems: (selections: Selection[]) => void;
  moveSelection: (dx: number, dy: number) => void;
  duplicateSelection: (dx?: number, dy?: number) => Selection[];
  copySelection: () => Promise<boolean>;
  pasteSelection: () => Promise<Selection[]>;
  applySelectionStyle: (patch: SelectionStylePatch) => void;
  batchUpdateSelections: (patch: SelectionStylePatch) => void;
  updateTextsBatch: (updates: Array<{ id: string; patch: Partial<SodaText> }>) => void;
  alignSelection: (action: SelectionAlignment) => void;
  getObjectFlags: (selection: Selection) => ObjectFlags;
  isObjectLocked: (selection: Selection) => boolean;
  isObjectHidden: (selection: Selection) => boolean;
  toggleObjectLock: (selection?: Selection) => void;
  toggleObjectVisibility: (selection?: Selection) => void;
  deleteSelection: () => void;
  getEditableSource: () => SodaPage | null;
  downloadSourceJson: () => void;
  duplicatePage: (pageId?: string) => Promise<void>;
  retrySave: () => Promise<boolean>;
  restoreRecoveryDraft: () => Promise<boolean>;
  discardRecoveryDraft: () => void;
  saveRecoveryAsNewPage: () => Promise<{ id: string; selected: boolean } | null>;

  // Save & Sync
  saveCurrentPage: (force?: boolean) => Promise<boolean>;
  triggerAutoSave: () => void;
  reloadCurrentPage: () => Promise<boolean>;
  resolveConflictLoadLatest: () => Promise<boolean>;
  closeConflictModal: () => void;

  // Modals & Tools
  openLayoutModal: () => Promise<boolean>;
  closeLayoutModal: () => void;
  applyLayoutCandidate: (candidateId: string) => Promise<boolean>;

  openPreviewModal: () => Promise<void>;
  closePreviewModal: () => void;

  openCompileModal: () => Promise<boolean>;
  closeCompileModal: () => void;

  openGenerateModal: () => void;
  closeGenerateModal: () => void;
  submitGenerate: (options: { seeds: number; preset: string; model?: string | null; lora?: string }) => Promise<boolean>;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openImportModal: () => void;
  closeImportModal: () => void;

  pickRender: (renderPath: string) => Promise<boolean>;
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

function currentSelections(state: Pick<EditorState, "selection" | "selections">): Selection[] {
  if (!state.selection) return [];
  return state.selections.some(item => selectionKey(item) === selectionKey(state.selection!)) ? state.selections : [state.selection];
}
const lastSelection = (items: Selection[]) => items[items.length - 1] || null;
function locked(state: EditorState, selection: Selection, children = false): boolean {
  const protectedItem = !!state.sodaPage && (isSelectionLocked(state.sodaPage, state.objectFlags, selection)
    || children && selection.kind === "panel" && panelHasLockedChildren(state.sodaPage, state.objectFlags, selection.id));
  if (protectedItem) state.setNotice("对象已锁定，请在左侧对象列表解锁后编辑");
  return protectedItem;
}
function editableSelections(state: EditorState, page: SodaPage, children = false): Selection[] {
  return normalizeSelections(page, currentSelections(state)).filter(item => !isSelectionLocked(page, state.objectFlags, item)
    && !(children && item.kind === "panel" && panelHasLockedChildren(page, state.objectFlags, item.id)));
}
function commitPageEdit(state: EditorState, set: (patch: Partial<EditorState>) => void, page: SodaPage, label: string, selected = currentSelections(state)): void {
  state.pushHistory(label);
  const selections = normalizeSelections(page, selected);
  set({ sodaPage: page, project: { ...state.project, pages: [sodaPageToProjectPage(page)] },
    sketchGeometry: generatePageSketchGeometry(page, state.characters as any), dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(),
    selections, selection: lastSelection(selections), historyGroup: null });
  state.triggerAutoSave();
}
function persistCurrentDraft(state: EditorState): void {
  const page = state.getEditableSource();
  if (!page || !state.projectIdentity) return;
  const saved = writeRecoveryDraft({ format: "soda-editor-recovery-v1", projectIdentity: state.projectIdentity,
    pageId: state.activePageId, baseVersion: state.currentVersion, savedAt: Date.now(), page }, state.recoveryDraft);
  if (!saved) useEditorStore.setState({ recoveryStorageError: "浏览器无法保存恢复副本，请下载分镜源文件保留修改" });
  else if (state.recoveryStorageError) useEditorStore.setState({ recoveryStorageError: null });
}
async function createDetachedPage(source: SodaPage, get: () => EditorState, set: (patch: Partial<EditorState>) => void): Promise<{ id: string; selected: boolean }> {
  const initialPage = get().activePageId, revision = get().editRevision;
  const page = JSON.parse(JSON.stringify(source)) as SodaPage;
  page.id = "copy_" + uuidv4().replace(/-/g, "").slice(0, 12);
  delete page.page_id;
  for (const field of ["production", "renders", "selected_render", "candidate_sheet", "composed", "lettered"]) delete page[field];
  const created = await apiCreatePage(page);
  // POST is the commit point. A later list/load failure must not invite a duplicate POST.
  try { const { pages } = await apiGetPages(); set({ pages }); }
  catch { set({ pages: [...get().pages, { id: created.page.id, description: created.page.description || "", panel_count: created.page.panels.length, version: created.version }] }); }
  if (get().activePageId === initialPage && get().editRevision === revision && !get().hasUnsavedChanges && !get().savePromise) await get().selectPage(created.page.id);
  return { id: created.page.id, selected: get().activePageId === created.page.id };
}

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
  saveStatus: "saved",
  saveError: null,
  projectIdentity: "",
  recoveryDraft: null,
  recoveryStorageError: null,

  dirtyPanelIds: new Set<string>(),
  dirtyBubbleIds: new Set<string>(),

  sketchGeometry: null,
  sketchGeometryUnavailable: false,

  project: createEmptyProject(),
  selection: null,
  selections: [],
  objectFlags: {},
  clipboard: null,

  historyPast: [],
  historyFuture: [],
  undoLabel: null,
  redoLabel: null,
  canUndo: false,
  canRedo: false,
  historyGroup: null,

  // Coalesce typing and continuous adjustments while keeping separate objects
  // and edits separated by a pause independently undoable.
  recordEdit: (key, label) => {
    const group = get().historyGroup;
    const timestamp = Date.now();
    if (!group || group.key !== key || timestamp - group.timestamp > 750) {
      get().pushHistory(label || (key.startsWith("figure:") ? "调整人物" : key.startsWith("text:") ? "编辑台词" : "编辑格子"));
    }
    set({ historyGroup: { key, timestamp } });
  },

  pushHistory: (label = "编辑对象") => {
    const state = get();
    if (!state.sodaPage) return;
    const snapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds),
      label, selection: state.selection, selections: currentSelections(state)
    };
    const nextPast = [...state.historyPast.slice(-29), snapshot];
    set({
      historyPast: nextPast,
      historyFuture: [],
      canUndo: true,
      canRedo: false,
      undoLabel: label,
      redoLabel: null,
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
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds),
      label: prev.label, selection: state.selection, selections: currentSelections(state)
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
      ,undoLabel: nextPast[nextPast.length - 1]?.label || null, redoLabel: prev.label || "编辑对象",
      selections: normalizeSelections(prev.sodaPage, prev.selections || (prev.selection ? [prev.selection] : [])),
      selection: lastSelection(normalizeSelections(prev.sodaPage, prev.selections || (prev.selection ? [prev.selection] : [])))
    });
    get().triggerAutoSave();
    get().setNotice("已撤销：" + (prev.label || "编辑对象"));
  },

  redo: () => {
    const state = get();
    if (state.historyFuture.length === 0 || !state.sodaPage) return;
    const next = state.historyFuture[0];
    const nextFuture = state.historyFuture.slice(1);
    const currentSnapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds),
      label: next.label, selection: state.selection, selections: currentSelections(state)
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
      ,undoLabel: next.label || "编辑对象", redoLabel: nextFuture[0]?.label || null,
      selections: normalizeSelections(next.sodaPage, next.selections || (next.selection ? [next.selection] : [])),
      selection: lastSelection(normalizeSelections(next.sodaPage, next.selections || (next.selection ? [next.selection] : [])))
    });
    get().triggerAutoSave();
    get().setNotice("已重做：" + (next.label || "编辑对象"));
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
      const [{ project, pages, characters }, projectIdentity] = await Promise.all([apiGetProject(), discoverProjectIdentity()]);
      set({
        sodaProject: project,
        pages,
        characters,
        projectIdentity,
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
      const recoveryDraft = readRecoveryDraft(get().projectIdentity, pageId);
      if (recoveryDraft) writeRecoveryDraft(recoveryDraft, recoveryDraft);

      set({
        activePageId: pageId,
        sodaPage: page,
        currentVersion: version,
        saveStatus: "saved", saveError: null,
        objectFlags: readObjectFlags(get().projectIdentity, pageId),
        recoveryDraft,
        hasUnsavedChanges: false,
        validationIssues: [],
        selection: null,
        dirtyPanelIds: new Set<string>(),
        dirtyBubbleIds: new Set<string>(),
        historyPast: [],
        historyFuture: [],
        undoLabel: null, redoLabel: null,
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

  setLegacyCaptionMode: (enabled) => {
    const state = get();
    if (!state.sodaPage || Boolean(state.sodaPage.legacy_caption_en) === enabled) return;
    get().recordEdit("page:caption-mode", "更改提示词兼容模式");
    set({ sodaPage: { ...state.sodaPage, legacy_caption_en: enabled } });
    get().triggerAutoSave();
  },

  setPageLoraCharacter: (characterId) => {
    const state = get();
    if (!state.sodaPage || state.sodaPage.lora_character === characterId) return;
    get().recordEdit(`page:lora-character:${characterId || "auto"}`, "更改本页 LoRA 角色");
    const sodaPage = { ...state.sodaPage };
    if (characterId === undefined) delete sodaPage.lora_character;
    else sodaPage.lora_character = characterId;
    set({ sodaPage });
    get().triggerAutoSave();
  },

  // Update canvas panel
  updatePanel: (id: string, patch: Partial<Panel>) => {
    if (locked(get(), { kind: "panel", id }, ["x", "y", "width", "height", "shape"].some(key => key in patch))) return;
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
      ...(state.sodaPage.objects ? { objects: state.sodaPage.objects.map(object => object.panel_id === id && (dx || dy)
        ? { ...object, rect: { ...object.rect, x: object.rect.x + dx, y: object.rect.y + dy } } : object) } : {}),
      ...(state.sodaPage.overlays ? { overlays: state.sodaPage.overlays.map(overlay => overlay.panel_id === id && (dx || dy)
        ? { ...overlay, rect: { ...overlay.rect, x: overlay.rect.x + dx, y: overlay.rect.y + dy } } : overlay) } : {})
    }, state.dirtyPanelIds, state.dirtyBubbleIds) : null;
    set({ project: nextProject, ...(nextSodaPage ? { sodaPage: nextSodaPage, sketchGeometry: generatePageSketchGeometry(nextSodaPage, state.characters as any) } : {}) });
    get().triggerAutoSave();
  },

  // Update Soda panel metadata (shot, angle, figures, description, caption_en)
  updateSodaPanel: (id: string, patch: Partial<SodaPanel>) => {
    if (locked(get(), { kind: "panel", id }, !!patch.shape || "figures" in patch || "character_ids" in patch)) return;
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
    if (locked(get(), { kind: "panel", id: panelId }, true)) return;
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
    if (locked(get(), { kind: "text", id })) return;
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
    if (locked(get(), { kind: "text", id })) return;
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

  addObjectBox: () => {
    const state = get();
    if (!state.sodaPage) return;
    get().recordEdit("object:new", "添加物件框");
    const id = `object_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const box = { id, caption: "", label: "object" as const, rect: { type: "rect" as const, x: state.sodaPage.canvas_width * 0.25, y: state.sodaPage.canvas_height * 0.25, w: state.sodaPage.canvas_width * 0.3, h: state.sodaPage.canvas_height * 0.2 }, panel_id: null };
    set({ sodaPage: { ...state.sodaPage, objects: [...(state.sodaPage.objects || []), box] }, selection: { kind: "object", id }, selections: [{ kind: "object", id }] });
    get().triggerAutoSave();
  },
  updateObjectBox: (id, patch) => {
    if (locked(get(), { kind: "object", id })) return;
    const state = get();
    if (!state.sodaPage) return;
    get().recordEdit(`object:${id}`, "编辑物件框");
    set({ sodaPage: { ...state.sodaPage, objects: (state.sodaPage.objects || []).map(item => item.id === id ? { ...item, ...patch } : item) } });
    get().triggerAutoSave();
  },
  // Update overlay
  updateSodaOverlay: (id: string, patch: Partial<SodaOverlay>) => {
    if (locked(get(), { kind: "overlay", id })) return;
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
    if (locked(get(), { kind: "panel", id: panelId })) return;
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
    if (targetId && locked(state, { kind: "panel", id: targetId })) return;
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
    if (locked(get(), { kind: "figure", panelId, id })) return;
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
    if (locked(get(), { kind: "figure", panelId, id })) return;
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
    if (locked(get(), { kind: "panel", id: panelId }, true)) return;
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
    if (locked(get(), { kind: "panel", id: panelId }, true)) return;
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
    if (targetId && locked(state, { kind: "panel", id: targetId })) return;
    const panel = activePage.panels.find((p) => p.id === targetId) || (state.sodaPage.canvas_mode === "single" ? { id: "", x: 0, y: 0, width: state.sodaPage.canvas_width, height: state.sodaPage.canvas_height } : undefined);
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
        panel_id: panel.id || null,
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

  selectItem: (selection: Selection | null, additive = false) => {
    const state = get();
    if (!selection || !state.sodaPage) { set({ selection: null, selections: [] }); return; }
    let items = additive ? currentSelections(state) : [];
    const key = selectionKey(selection), present = items.some(item => selectionKey(item) === key);
    items = additive && present ? items.filter(item => selectionKey(item) !== key) : [...items, selection];
    const selections = normalizeSelections(state.getEditableSource()!, items);
    set({ selections, selection: selections[selections.length - 1] || null });
  },
  selectItems: (items) => {
    const source = get().getEditableSource();
    const selections = source ? normalizeSelections(source, items) : [];
    set({ selections, selection: selections[selections.length - 1] || null });
  },
  getEditableSource: () => {
    const state = get(), page = state.project.pages[0];
    return state.sodaPage && page ? projectPageToSodaPage(page, state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds) : null;
  },
  moveSelection: (dx, dy) => {
    const state = get(), page = state.getEditableSource();
    if (!page || !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
    const selected = editableSelections(state, page, true);
    if (!selected.length) return;
    commitPageEdit(state, set, movePageSelections(page, selected, dx, dy, state.sketchGeometry, state.project.pages[0]), selected.length > 1 ? "移动所选对象" : "移动对象", selected);
  },
  duplicateSelection: (dx = 24, dy = 24) => {
    const state = get(), page = state.getEditableSource();
    if (!page) return [];
    const selected = editableSelections(state, page);
    if (!selected.length) return [];
    const result = pastePageSelections(page, copyPageSelections(page, selected, state.projectIdentity, state.sketchGeometry), dx, dy, undefined, state.project.pages[0]);
    if (!result.selections.length) return [];
    commitPageEdit(state, set, result.page, "复制所选对象", result.selections);
    return result.selections;
  },
  copySelection: async () => {
    const state = get(), page = state.getEditableSource();
    if (!page || !currentSelections(state).length) return false;
    const clipboard = copyPageSelections(page, currentSelections(state), state.projectIdentity, state.sketchGeometry);
    set({ clipboard });
    try { if (typeof navigator !== "undefined") await navigator.clipboard?.writeText(JSON.stringify(clipboard)); } catch { /* The in-app clipboard remains usable when browser permission is denied. */ }
    state.setNotice("已复制所选对象"); return true;
  },
  pasteSelection: async () => {
    const state = get(), pageId = state.activePageId;
    let clipboard = state.clipboard;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        const raw = await navigator.clipboard.readText();
        if (raw.length < 5000000) {
          const parsed = JSON.parse(raw);
          if (parsed?.format === "soda-editor-elements-v1" && Array.isArray(parsed.panels) && Array.isArray(parsed.texts) && Array.isArray(parsed.figures) && Array.isArray(parsed.overlays)) clipboard = parsed;
        }
      }
    } catch { /* A denied or unrelated system clipboard falls back to the editor clipboard. */ }
    const latest = get(), page = latest.getEditableSource();
    if (!clipboard || !page || latest.activePageId !== pageId) return [];
    if (clipboard.projectIdentity && clipboard.projectIdentity !== latest.projectIdentity) {
      latest.setNotice("跨项目粘贴需要关联角色，请使用 JSON 导入完成角色映射"); return [];
    }
    const target = insertionPanelId(latest);
    if ((clipboard.figures.length || clipboard.texts.length) && target && locked(latest, { kind: "panel", id: target })) return [];
    try {
      const result = pastePageSelections(page, clipboard, 24, 24, target, latest.project.pages[0]);
      if (!result.selections.length) return [];
      commitPageEdit(latest, set, result.page, "粘贴对象", result.selections); return result.selections;
    } catch { latest.setNotice("剪贴板对象无效，未粘贴任何内容"); return []; }
  },
  applySelectionStyle: (patch) => {
    const state = get(), page = state.getEditableSource();
    if (!page) return;
    const selected = editableSelections(state, page, !!patch.panel?.shape);
    const next = stylePageSelections(page, selected, patch, state.sketchGeometry);
    if (JSON.stringify(next) !== JSON.stringify(page)) commitPageEdit(state, set, next, "批量修改属性", selected);
  },
  batchUpdateSelections: (patch) => get().applySelectionStyle(patch),
  updateTextsBatch: (updates) => {
    const state = get(), page = state.getEditableSource();
    if (!page) return;
    let next = page;
    updates.forEach(({ id, patch }) => {
      if (!isSelectionLocked(page, state.objectFlags, { kind: "text", id })) next = stylePageSelections(next, [{ kind: "text", id }], { text: patch });
    });
    if (JSON.stringify(next) !== JSON.stringify(page)) commitPageEdit(state, set, next, "编辑本页台词");
  },
  alignSelection: (action) => {
    const state = get(), page = state.getEditableSource();
    if (!page) return;
    const selected = editableSelections(state, page, true), next = alignPageSelections(page, selected, action, state.sketchGeometry, state.project.pages[0]);
    if (JSON.stringify(next) !== JSON.stringify(page)) commitPageEdit(state, set, next, action.startsWith("distribute") ? "等距分布对象" : "对齐对象", selected);
  },
  getObjectFlags: (selection) => ({ locked: get().isObjectLocked(selection), hidden: get().isObjectHidden(selection) }),
  isObjectLocked: (selection) => !!get().sodaPage && isSelectionLocked(get().sodaPage!, get().objectFlags, selection),
  isObjectHidden: (selection) => !!get().sodaPage && isSelectionHidden(get().sodaPage!, get().objectFlags, selection),
  toggleObjectLock: (selection) => {
    const state = get(), items = selection ? [selection] : currentSelections(state);
    const next = !items.every(item => state.objectFlags[selectionKey(item)]?.locked), flags = { ...state.objectFlags };
    items.forEach(item => { const key = selectionKey(item); flags[key] = { ...(flags[key] || { hidden: false, locked: false }), locked: next }; });
    set({ objectFlags: flags }); writeObjectFlags(state.projectIdentity, state.activePageId, flags);
  },
  toggleObjectVisibility: (selection) => {
    const state = get(), items = selection ? [selection] : currentSelections(state);
    const next = !items.every(item => state.objectFlags[selectionKey(item)]?.hidden), flags = { ...state.objectFlags };
    items.forEach(item => { const key = selectionKey(item); flags[key] = { ...(flags[key] || { hidden: false, locked: false }), hidden: next }; });
    set({ objectFlags: flags }); writeObjectFlags(state.projectIdentity, state.activePageId, flags);
  },
  deleteSelection: () => {
    const state = get(), page = state.getEditableSource();
    if (!page) return;
    const selected = editableSelections(state, page, true);
    if (!selected.length) return;
    commitPageEdit(state, set, deletePageSelections(page, selected), selected.length > 1 ? "删除所选对象" : "删除对象", []);
    state.setNotice("已删除所选对象");
  },
  downloadSourceJson: () => {
    const page = get().getEditableSource();
    if (!page || typeof document === "undefined") return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(page, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = page.id + ".soda.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  duplicatePage: async (pageId) => {
    const state = get(), id = pageId || state.activePageId;
    try {
      const source = id === get().activePageId ? get().getEditableSource() : (await apiGetPage(id)).page;
      if (!source) return;
      await createDetachedPage(source, get, set);
      get().setNotice("已复制分镜页；原页的编辑已保留");
    } catch (error) { get().setNotice("复制页面失败：" + (error as Error).message); }
  },
  retrySave: () => get().saveCurrentPage(true),
  restoreRecoveryDraft: async () => {
    const state = get(), draft = state.recoveryDraft;
    if (!draft || draft.projectIdentity !== state.projectIdentity || draft.pageId !== state.activePageId) return false;
    try {
      const latest = await apiGetPage(draft.pageId);
      if (get().activePageId !== draft.pageId || get().editRevision !== state.editRevision) return false;
      if (latest.version !== draft.baseVersion) {
        set({ saveError: "恢复草稿基于较早版本，当前文件已更新。可将草稿另存为新页，避免覆盖新内容。", saveStatus: "conflict" });
        return false;
      }
      clearTimeout(get().autoSaveTimer);
      clearRecoveryDraft(state.projectIdentity, draft.pageId, true);
      set({ recoveryDraft: null, currentVersion: latest.version, saveError: null, saveStatus: "dirty" });
      commitPageEdit(get(), set, JSON.parse(JSON.stringify(draft.page)), "恢复本地草稿", []);
      return true;
    } catch (error) { set({ saveError: "无法检查服务端版本：" + (error as Error).message, saveStatus: "error" }); return false; }
  },
  discardRecoveryDraft: () => {
    const state = get(); clearRecoveryDraft(state.projectIdentity, state.activePageId, true); set({ recoveryDraft: null });
    if (state.hasUnsavedChanges) persistCurrentDraft(get());
    else set({ saveStatus: "saved", saveError: null });
  },
  saveRecoveryAsNewPage: async () => {
    const state = get(), draft = state.recoveryDraft;
    if (!draft || draft.projectIdentity !== state.projectIdentity) return null;
    try {
      const result = await createDetachedPage(draft.page, get, set);
      clearRecoveryDraft(draft.projectIdentity, draft.pageId, true);
      if (get().recoveryDraft === draft) set({ recoveryDraft: null });
      if (get().activePageId === draft.pageId && get().hasUnsavedChanges) persistCurrentDraft(get());
      return result;
    } catch (error) { set({ saveError: "草稿另存失败：" + (error as Error).message }); return null; }
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
              saveStatus: unchanged ? "saved" : "saving", saveError: null,
              ...(unchanged ? {
                sodaPage: res.page || pageToSave,
                dirtyPanelIds: new Set<string>(), dirtyBubbleIds: new Set<string>()
              } : {})
            });
            if (!unchanged) { persistCurrentDraft(get()); continue; }
            clearRecoveryDraft(get().projectIdentity, pageId);

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
          persistCurrentDraft(get());
          if (res.status === 409) {
            set({ saveStatus: "conflict", saveError: "文件已被外部修改，未覆盖本地编辑。请处理冲突或下载源文件。" });
            const latest = get();
            const backup = projectPageToSodaPage(latest.project.pages[0], latest.sodaPage!, latest.dirtyPanelIds, latest.dirtyBubbleIds);
            set({ conflictModal: {
              open: true, serverPage: res.current, serverVersion: res.version, reason: res.reason,
              localBackup: JSON.stringify(backup, null, 2)
            } });
            get().setNotice("保存冲突: 页面已被外部修改");
          } else if (res.status === 422) {
            const issues = res.issues || res.errors || [];
            set({ validationIssues: issues, saveStatus: "error", saveError: "保存未通过校验，请修正检查器中的错误后重试。" });
            get().setNotice(`有 ${issues.length} 个问题，已在右栏列出`);
          } else {
            set({ saveStatus: "error", saveError: res.error || "保存失败，请重试或下载分镜源文件。" });
            get().setNotice(`保存失败: ${res.error}`);
          }
          return false;
        }
      } catch (err: any) {
        if (get().activePageId === pageId) {
          set({ hasUnsavedChanges: true, saveStatus: "error", saveError: err.message || "无法连接保存服务" });
          persistCurrentDraft(get());
          get().setNotice(`保存异常: ${err.message}`);
        }
      }
      return false;
    };

    const promise = drain().finally(() => {
      if (get().savePromise === promise) set({ savePromise: null, isSaving: false });
    });
    set({ savePromise: promise, isSaving: true, saveStatus: "saving", saveError: null });
    return promise;
  },

  triggerAutoSave: () => {
    const state = get();
    set({ hasUnsavedChanges: true, editRevision: state.editRevision + 1, saveStatus: state.saveStatus === "error" || state.saveStatus === "conflict" ? state.saveStatus : "dirty" });
    persistCurrentDraft(get());
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
    if (!state.activePageId) return false;
    const pageId = state.activePageId;
    const revision = state.editRevision;
    const requestedVersion = state.currentVersion;
    const requestSequence = pageLoadSequence;
    const reloadSequence = ++pageReloadSequence;
    try {
      const { page, version } = await apiGetPage(pageId);
      if (requestSequence !== pageLoadSequence || reloadSequence !== pageReloadSequence || get().activePageId !== pageId || get().editRevision !== revision || get().currentVersion !== requestedVersion) return false;
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
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return false;
        set({
          sketchGeometry: geo,
          sketchGeometryUnavailable: !geo
        });
      }).catch(() => {
        if (get().activePageId !== pageId || get().currentVersion !== version || get().editRevision !== revision) return false;
        set({
          sketchGeometry: null,
          sketchGeometryUnavailable: true
        });
      });

      apiGetRenders(pageId).then((r) => {
        if (get().activePageId !== pageId || get().currentVersion !== version) return false;
        let selectedUrl: string | null = null;
        if (r.selected_render) {
          const matched = r.renders.find((x) => x.path === r.selected_render);
          selectedUrl = matched?.url || `/api/files/${r.selected_render}`;
        }
        set({ renders: r, selectedRenderUrl: selectedUrl });
      }).catch(console.error);
      return true;
    } catch (err: any) {
      if (requestSequence !== pageLoadSequence || reloadSequence !== pageReloadSequence || get().activePageId !== pageId) return false;
      get().setNotice(`重新载入失败: ${err.message}`);
    }
    return false;
  },

  resolveConflictLoadLatest: async () => {
    if (!(await get().reloadCurrentPage())) return false;
    set({ conflictModal: null, saveStatus: "saved", saveError: null });
    get().setNotice("已载入服务端最新版本");
    return true;
  },

  closeConflictModal: () => {
    set({ conflictModal: null });
  },

  // Layout Modal & Apply
  openLayoutModal: async () => {
    const state = get();
    if (!state.activePageId) return false;
    const pageId = state.activePageId;
    if (!(await get().saveCurrentPage()) || get().activePageId !== pageId) return false;
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
      if (get().activePageId !== pageId || get().currentVersion !== version) return false;
      set({
        layoutModal: {
          open: true,
          candidates: res.candidates,
          loading: false
        }
      });
      return true;
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
    return false;
  },

  closeLayoutModal: () => {
    set({ layoutModal: { open: false, candidates: [], loading: false } });
  },

  applyLayoutCandidate: async (candidateId: string) => {
    if (Object.values(get().objectFlags).some(flag => flag.locked)) {
      get().setNotice("页面里有已锁定对象，请解锁后再替换整页版式"); return false;
    }
    const pageId = get().activePageId;
    if (!pageId) return false;
    // A clean PUT still replaces the file and changes its mtime-based ETag,
    // invalidating the candidate created for the current saved version.
    if ((get().hasUnsavedChanges || get().savePromise) && !(await get().saveCurrentPage())) return false;
    if (get().activePageId !== pageId) return false;
    const state = get();
    const revision = state.editRevision;
    const snapshot = {
      project: JSON.parse(JSON.stringify(state.project)),
      sodaPage: projectPageToSodaPage(state.project.pages[0], state.sodaPage!, state.dirtyPanelIds, state.dirtyBubbleIds)
    };

    try {
      const res = await apiLayoutApply(pageId, candidateId, state.currentVersion);
      if (get().activePageId !== pageId) return false;
      if (get().editRevision !== revision) {
        set({ currentVersion: res.version, layoutModal: { open: false, candidates: [], loading: false } });
        get().setNotice("应用版式期间有新的编辑，已保留你的修改；请重新选择版式");
        return false;
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
      return true;
    } catch (err: any) {
      get().setNotice(`应用版式失败: ${err.message}`);
    }
    return false;
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
    const state = get();
    const pageId = state.activePageId;
    if (!pageId || state.compileModal?.loading) return false;
    const loadSequence = pageLoadSequence;
    const pending = { open: true, loading: true, moss: null, path: "", paths: [] as string[] };
    set({ compileModal: pending });

    const isCurrentRequest = () => get().compileModal === pending;
    const isCurrentPage = () => get().activePageId === pageId && pageLoadSequence === loadSequence;
    const fail = (error: string) => {
      if (!isCurrentRequest()) return false;
      if (!isCurrentPage()) set({ compileModal: null });
      else {
        set({ compileModal: { ...pending, loading: false, error } });
        get().setNotice(error);
      }
      return false;
    };

    try {
      if (!(await get().saveCurrentPage())) return fail(get().saveError || "保存失败，尚未编译。请检查保存提示后重试。");
      if (!isCurrentRequest()) return false;
      if (!isCurrentPage()) return fail("");
      if (get().hasUnsavedChanges) return fail("保存期间出现新的编辑，请重试以导出当前内容。");
      const revision = get().editRevision;
      const version = get().currentVersion;
      const res = await apiCompilePage(pageId, { with_ids: true, slant_mode: "cut" });
      if (!isCurrentRequest()) return false;
      if (!isCurrentPage()) return fail("");
      if (get().editRevision !== revision || get().currentVersion !== version || get().hasUnsavedChanges) {
        return fail("编译期间分镜已变化，请重试以导出当前内容。");
      }
      set({
        compileModal: {
          open: true,
          loading: false,
          moss: res.moss,
          path: res.path,
          paths: res.paths?.length ? res.paths : [res.path]
        }
      });
      return true;
    } catch (err: any) {
      return fail(`导出/编译失败: ${err?.message || "无法连接服务，请重试。"}`);
    }
  },

  closeCompileModal: () => {
    if (get().compileModal?.loading) return;
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
    if (!state.activePageId) return false;
    const pageId = state.activePageId;

    set({ generateModal: { ...state.generateModal, loading: true, error: undefined } });

    try {
      if (!(await get().saveCurrentPage()) || get().activePageId !== pageId) {
        set({ generateModal: { ...get().generateModal, loading: false, error: "页面尚未保存，请先处理保存提示后重试" } });
        return false;
      }
      const job = await apiGeneratePage(pageId, options);
      if (get().activePageId !== pageId) return false;
      set({
        activeJob: job,
        generateModal: { ...state.generateModal, open: false, loading: false }
      });
      get().setNotice(`出图任务已提交 (${job.message || "排队中"})`);
      return true;
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
    return false;
  },

  pickRender: async (renderPath: string) => {
    const state = get(), pageId = state.activePageId;
    if (!pageId) return false;
    try {
      let job = await apiPickRender(pageId, renderPath);
      set((latest) => ({ activeJob: latest.activeJob?.id === job.id && ["completed", "failed", "cancelled"].includes(latest.activeJob.status) ? latest.activeJob : job }));
      for (let attempt = 0; attempt < 60; attempt++) {
        if (get().activePageId !== pageId) return false;
        const observed = get().activeJob;
        if (observed?.id === job.id && ["completed", "failed", "cancelled"].includes(observed.status)) job = observed;
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || job.message || "选用任务未完成");
        if (job.status === "completed") {
          const renders = await apiGetRenders(pageId);
          if (get().activePageId !== pageId) return false;
          if (renders.selected_render !== renderPath) throw new Error("选用结果尚未写入，请稍后重试");
          set({ renders, selectedRenderUrl: renders.renders.find(item => item.path === renderPath)?.url || "/api/files/" + renderPath });
          get().setNotice("已选用这张出图"); return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        job = await apiGetJob(job.id);
        if (get().activePageId === pageId) set({ activeJob: job });
      }
      get().setNotice("选用任务仍在运行，完成后会自动更新"); return false;
    } catch (error) {
      get().setNotice("选择底图失败：" + (error as Error).message); return false;
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

// Older single-object actions and direct integration fixtures may still update
// only selection. Keep the new collection synchronized without changing callers.
useEditorStore.subscribe((state, previous) => {
  if (state.selection !== previous.selection && state.selections === previous.selections) {
    useEditorStore.setState({ selections: state.selection ? [state.selection] : [] });
  }
});
