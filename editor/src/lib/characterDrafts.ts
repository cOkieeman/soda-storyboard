import { create } from "zustand";
import { ApiError, createCharacter, duplicateCharacter, getCharacter, patchCharacter, validateCharacter, type CharacterValidation } from "./api";
import { useEditorStore } from "./store";
import type { AppearanceProfile, SodaCharacter } from "../types";
import { getFigureId } from "./figureRig";
import { resolvedFigures } from "./figures";

export type InspectorTarget = { kind: "canvas" } | { kind: "character"; id: string } | { kind: "new-character"; draftId: string };
export type CharacterDraft = {
  key: string; value: SodaCharacter; baseline: SodaCharacter | null; version: string;
  dirty: boolean; revision: number; saving: boolean; error?: string; conflict?: boolean;
  validation?: CharacterValidation; validationError?: string; externalChanged?: boolean;
  identityEditing?: boolean;
  sourceId?: string; sourceVersion?: string; source?: SodaCharacter;
  copyOptions: { copy_lora: boolean; copy_trigger_words: boolean; copy_reference_images: boolean };
  assignTo?: { pageId: string; panelId: string; figureId: string };
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const copyDefaults = () => ({ copy_lora: false, copy_trigger_words: false, copy_reference_images: true });
export const emptyAppearanceProfile = (): AppearanceProfile => ({ version: 1, mode: "structured", hair: { style: { zh: "" }, color: { zh: "" } }, eyes: { zh: "" }, outfit: [{ id: "garment_1", style: { zh: "" }, color: { zh: "" }, detail: { zh: "" } }], signatures: [], extra: { zh: "" } });
export const characterAppearanceText = (value: SodaCharacter, language: "zh" | "en"): string => value[`appearance_${language}`] || (typeof value.appearance === "string" ? language === "zh" ? value.appearance : "" : value.appearance?.[language] || (language === "zh" ? value.appearance?.cn : "")) || "";
/** Read all supported raw LoRA forms without changing the saved card until edited. */
export function characterLora(value: SodaCharacter): { path: string; strength: number; [key: string]: any } | null {
  const raw: unknown = value.lora;
  if (typeof raw === "string" && raw) return { path: raw, strength: 1 };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const fields = raw as Record<string, any>;
    return { ...fields, path: fields.path ?? fields.model ?? fields.file ?? "", strength: fields.strength ?? 1 };
  }
  return value.lora_path ? { path: value.lora_path, strength: value.lora_strength ?? 1 } : null;
}

/** Immediate local text preview; the server remains the canonical composer and validator. */
export function composeAppearanceZh(profile: AppearanceProfile): string {
  return [
    [profile.hair?.color?.zh, profile.hair?.style?.zh].filter(Boolean).map(value => value!.trim()).join(""),
    profile.eyes?.zh,
    ...(profile.outfit || []).map(item => [item.color?.zh, item.style?.zh, item.detail?.zh].filter(Boolean).map(value => value!.trim()).join("")),
    ...(profile.signatures || []).map(item => item.zh), profile.extra?.zh
  ].map(value => value?.trim()).filter(Boolean).join("，");
}

export function characterPatch(baseline: SodaCharacter, value: SodaCharacter): Partial<SodaCharacter> {
  const patch: Partial<SodaCharacter> = {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(value)])) {
    if (key !== "id" && key !== "display_name" && JSON.stringify(baseline[key]) !== JSON.stringify(value[key])) patch[key] = value[key] === undefined ? null : clone(value[key]);
  }
  return patch;
}

export function activeCharacterDraft(state: Pick<CharacterDraftState, "target" | "drafts">): CharacterDraft | undefined {
  return state.target.kind === "canvas" ? undefined : state.drafts[state.target.kind === "character" ? state.target.id : state.target.draftId];
}
export const hasCharacterDraftChanges = (state: Pick<CharacterDraftState, "drafts">) => Object.values(state.drafts).some(draft => draft.dirty || draft.saving);
export const isCharacterScope = (target: InspectorTarget) => target.kind !== "canvas";

type CharacterDraftState = {
  target: InspectorTarget; drafts: Record<string, CharacterDraft>; loading: string | null; loadError: string | null;
  showCanvas: () => void; open: (id: string) => Promise<void>;
  create: (assignTo?: CharacterDraft["assignTo"]) => string;
  duplicate: (id: string) => Promise<void>;
  edit: (key: string, patch: Partial<SodaCharacter>) => void;
  setCopyOption: (key: string, option: keyof CharacterDraft["copyOptions"], value: boolean) => void;
  validate: (key: string, signal?: AbortSignal) => Promise<void>;
  save: (key?: string) => Promise<boolean>; reload: (key: string) => Promise<void>;
  discard: (key: string) => void; checkExternal: (versions: Record<string, string>) => void;
};

let draftSequence = 0;
const freshDraft = (key: string, value: SodaCharacter, baseline: SodaCharacter | null = null, version = ""): CharacterDraft => ({ key, value: clone(value), baseline: baseline ? clone(baseline) : null, version, dirty: !baseline, revision: 0, saving: false, copyOptions: copyDefaults() });
const uniqueId = (prefix: string, drafts: Record<string, CharacterDraft>) => {
  const ids = new Set([...useEditorStore.getState().characters.map(item => item.id), ...Object.values(drafts).map(item => item.value.id)]);
  let candidate = prefix, index = 2;
  while (ids.has(candidate)) candidate = `${prefix}_${index++}`;
  return candidate;
};

export const useCharacterDraftStore = create<CharacterDraftState>((set, get) => ({
  target: { kind: "canvas" }, drafts: {}, loading: null, loadError: null,
  showCanvas: () => set({ target: { kind: "canvas" } }),
  open: async id => {
    set({ target: { kind: "character", id }, loadError: null });
    if (get().drafts[id]) return;
    set({ loading: id });
    try {
      const result = await getCharacter(id);
      set(state => ({ drafts: state.drafts[id] ? state.drafts : { ...state.drafts, [id]: freshDraft(id, result.character, result.character, result.version) } }));
    } catch (error) { set({ loadError: (error as Error).message }); }
    finally { if (get().loading === id) set({ loading: null }); }
  },
  create: assignTo => {
    const key = `new:${++draftSequence}`;
    const value: SodaCharacter = { format: "soda-storyboard-character-v1", id: uniqueId("character_01", get().drafts), display_name: "", appearance: { zh: "", en: "" }, appearance_profile: emptyAppearanceProfile(), clothing: [], trigger_words: [] };
    set(state => ({ target: { kind: "new-character", draftId: key }, loadError: null, drafts: { ...state.drafts, [key]: { ...freshDraft(key, value), assignTo } } }));
    return key;
  },
  duplicate: async id => {
    set({ loading: id, loadError: null });
    try {
      const snapshot = await getCharacter(id), key = `new:${++draftSequence}`;
      const value = clone(snapshot.character);
      value.id = uniqueId(`${id}_copy`, get().drafts); value.display_name = `${value.display_name || value.name || id} 副本`;
      delete value.lora; delete value.lora_path; delete value.lora_strength;
      value.trigger_words = []; delete value.triggers; value.approved_images = []; delete value.approved_reference_images;
      set(state => ({ target: { kind: "new-character", draftId: key }, drafts: { ...state.drafts, [key]: { ...freshDraft(key, value), sourceId: id, sourceVersion: snapshot.version, source: snapshot.character } } }));
    } catch (error) { set({ loadError: (error as Error).message }); useEditorStore.getState().setNotice(`复制角色失败：${(error as Error).message}`); }
    finally { set({ loading: null }); }
  },
  edit: (key, patch) => set(state => {
    const draft = state.drafts[key]; if (!draft) return state;
    const value = { ...draft.value, ...patch };
    if (value.appearance_profile?.mode === "structured" && "appearance_profile" in patch) {
      value.appearance = { ...value.appearance, zh: composeAppearanceZh(value.appearance_profile) };
    }
    if (value.appearance && ("appearance" in patch || ("appearance_profile" in patch && value.appearance_profile?.mode === "structured"))) {
      for (const language of ["zh", "en"] as const) {
        if (`appearance_${language}` in value && value.appearance[language] !== undefined) value[`appearance_${language}`] = value.appearance[language];
      }
      if ("cn" in value.appearance && value.appearance.zh !== undefined) value.appearance = { ...value.appearance, cn: value.appearance.zh };
    }
    const copyOptions = draft.sourceId ? { ...draft.copyOptions, ...("lora" in patch ? { copy_lora: Boolean(value.lora) } : {}), ...("trigger_words" in patch ? { copy_trigger_words: Boolean(value.trigger_words?.length) } : {}) } : draft.copyOptions;
    return { drafts: { ...state.drafts, [key]: { ...draft, value, copyOptions, dirty: !draft.baseline || JSON.stringify(value) !== JSON.stringify(draft.baseline), revision: draft.revision + 1, error: undefined, validation: undefined, validationError: undefined } } };
  }),
  setCopyOption: (key, option, enabled) => {
    const draft = get().drafts[key]; if (!draft?.source) return;
    const source = draft.source, value = clone(draft.value);
    if (option === "copy_lora") {
      value.lora = enabled ? characterLora(source) as any : null as any;
      // edit() merges partial fields, so absence would leave a previously opted-in LoRA behind.
      if ("lora_path" in value) value.lora_path = null;
      if ("lora_strength" in value) value.lora_strength = null;
    }
    if (option === "copy_trigger_words") { value.trigger_words = enabled ? clone(source.trigger_words || source.triggers || []) : []; delete value.triggers; }
    if (option === "copy_reference_images") { value.reference_images = enabled ? clone(source.reference_images || source.references || []) : []; delete value.references; }
    get().edit(key, value);
    set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], copyOptions: { ...state.drafts[key].copyOptions, [option]: enabled } } } }));
  },
  validate: async (key, signal) => {
    const draft = get().drafts[key]; if (!draft) return;
    try {
      const validation = await validateCharacter(draft.value, useEditorStore.getState().getEditableSource(), signal);
      if (!signal?.aborted && get().drafts[key]?.revision === draft.revision) set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], validation, validationError: undefined } } }));
    } catch (error) {
      if (!signal?.aborted && get().drafts[key]?.revision === draft.revision) set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], validationError: (error as Error).message } } }));
    }
  },
  save: async requestedKey => {
    const draft = requestedKey ? get().drafts[requestedKey] : activeCharacterDraft(get());
    if (!draft || draft.saving || !draft.dirty || draft.conflict) return false;
    const key = draft.key;
    set(state => ({ drafts: { ...state.drafts, [key]: { ...draft, saving: true, error: undefined } } }));
    try {
      const result = draft.sourceId
        ? await duplicateCharacter(draft.sourceId, draft.value, draft.sourceVersion!, draft.copyOptions)
        : draft.baseline ? await patchCharacter(draft.baseline.id, characterPatch(draft.baseline, draft.value), draft.version) : await createCharacter(draft.value);
      const latest = get().drafts[key];
      const saved = latest?.revision === draft.revision ? freshDraft(result.character.id, result.character, result.character, result.version) : { ...latest!, key: result.character.id, baseline: result.character, version: result.version, saving: false, dirty: true, sourceId: undefined, sourceVersion: undefined };
      set(state => {
        const drafts = { ...state.drafts }; delete drafts[key]; drafts[result.character.id] = saved;
        const selected = activeCharacterDraft(state)?.key === key;
        return { drafts, ...(selected ? { target: { kind: "character" as const, id: result.character.id } } : {}) };
      });
      useEditorStore.getState().acceptCharacter(result.character);
      if (draft.assignTo) {
        const state = useEditorStore.getState(), target = draft.assignTo;
        if (state.activePageId === target.pageId && state.sodaPage?.panels.some(panel => panel.id === target.panelId && resolvedFigures(panel, state.sodaPage?.reading_direction).some((figure, index) => getFigureId(figure, index) === target.figureId))) {
          state.updateFigureById(target.panelId, target.figureId, { character_id: result.character.id });
        } else state.setNotice("角色已创建；原人物已变化，请在人物检查器中重新指派。");
      }
      void useEditorStore.getState().refreshCharacters().catch(() => useEditorStore.getState().setNotice("角色已保存，角色列表刷新失败，请重试刷新。"));
      return true;
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409 && (!error.data?.reason || ["character_version_conflict", "source_version_conflict", "version_conflict"].includes(error.data.reason));
      set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], saving: false, conflict, error: conflict ? "服务器角色已改变。本地草稿已保留，请核对后重新载入；不会覆盖其他修改。" : (error as Error).message } } }));
      // An occupied ID on creation can be corrected without reloading a source.
      if (!draft.baseline && !draft.sourceId) set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], conflict: false } } }));
      return false;
    }
  },
  reload: async key => {
    const draft = get().drafts[key]; if (!draft || draft.saving) return;
    if (!draft.baseline && !draft.sourceId) return;
    try {
      const snapshot = await getCharacter(draft.sourceId || draft.baseline!.id);
      const latest = get().drafts[key];
      if (!latest || latest.saving || latest.version !== draft.version || latest.sourceVersion !== draft.sourceVersion) return;
      if (latest.revision !== draft.revision) {
        set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], externalChanged: true } } }));
        return;
      }
      if (draft.sourceId) {
        const value = clone(snapshot.character); value.id = draft.value.id; value.display_name = draft.value.display_name;
        delete value.lora; delete value.lora_path; delete value.lora_strength; value.trigger_words = []; delete value.triggers; value.approved_images = []; delete value.approved_reference_images;
        set(state => ({ drafts: { ...state.drafts, [key]: { ...freshDraft(key, value), sourceId: draft.sourceId, sourceVersion: snapshot.version, source: snapshot.character } } }));
      } else set(state => ({ drafts: { ...state.drafts, [key]: freshDraft(key, snapshot.character, snapshot.character, snapshot.version) } }));
    } catch (error) { set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], error: (error as Error).message } } })); }
  },
  discard: key => set(state => {
    const draft = state.drafts[key]; if (!draft || draft.saving) return state;
    const drafts = { ...state.drafts };
    if (draft.baseline) drafts[key] = freshDraft(key, draft.baseline, draft.baseline, draft.version); else delete drafts[key];
    return { drafts, ...(!draft.baseline && activeCharacterDraft(state)?.key === key ? { target: { kind: "canvas" as const } } : {}) };
  }),
  checkExternal: versions => {
    for (const [key, draft] of Object.entries(get().drafts)) {
      const id = draft.sourceId || draft.baseline?.id, version = draft.sourceVersion || draft.version;
      if (!id || versions[id] === version) continue;
      if (draft.dirty || draft.saving || draft.identityEditing) set(state => ({ drafts: { ...state.drafts, [key]: { ...state.drafts[key], externalChanged: true } } }));
      else void get().reload(key);
    }
  }
}));
