export type CanvasPreset = "A4" | "A3" | "custom";

export type CanvasConfig = {
  width: number;
  height: number;
  preset?: CanvasPreset;
  dpi?: number;
};

export type CropConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type PanelImage = {
  original: string;
  crop?: CropConfig;
  naturalWidth?: number;
  naturalHeight?: number;
  mimeType?: string;
  preserveTransparency?: boolean;
};

export type PanelShape = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
  /** Actual quad vertices in panel-relative units; resize applies one affine transform. */
  points?: [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
};

// OpenKoma canvas panel representation
export type Panel = {
  id: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: PanelShape;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  gap: number;
  image?: PanelImage;
  parentId?: string;
  // Raw fields from SodaPanel to ensure zero loss
  sodaData: SodaPanel;
};

export type BubbleType = "rect" | "rounded" | "circle";
export type BubbleDirection = "horizontal" | "vertical";

export type Bubble = {
  id: string;
  type: BubbleType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  direction: BubbleDirection;
  sourceDirection?: BubbleDirection;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  background: string;
  borderColor: string;
  borderWidth: number;
  tailTip?: [number, number] | null;
  // Raw fields from SodaText
  sodaData?: SodaText;
};

export type ProjectPage = {
  id: string;
  name: string;
  canvas: CanvasConfig;
  panels: Panel[];
  bubbles: Bubble[];
};

export type Project = {
  id: string;
  name: string;
  pages: ProjectPage[];
  activePageId: string;
};

export type Selection =
  | { kind: "panel"; id: string }
  | { kind: "figure"; id: string; panelId: string }
  | { kind: "text"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "object"; id: string }
  | { kind: "bubble"; id: string };

export type ObjectFlags = { locked: boolean; hidden: boolean };
export type SelectionAlignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom" | "distribute-x" | "distribute-y";
export type SelectionStylePatch = {
  text?: Partial<SodaText>;
  panel?: Partial<SodaPanel>;
  figure?: Omit<Partial<Figure>, "editor"> & { editor?: Partial<FigureEditor> };
};
export type RecoveryDraft = {
  format: "soda-editor-recovery-v1";
  projectIdentity: string;
  pageId: string;
  baseVersion: string;
  savedAt: number;
  page: SodaPage;
};

// ==========================================
// Soda Storyboard API Types
// ==========================================

export type ReadingDirection = "rtl" | "ltr";
export type DialogueMode = "moss_text" | "lettering";
export type TextDirection = "vertical" | "horizontal";
export type ColorMode = "color" | "monochrome";

export type ShotType =
  | "extreme_long"
  | "long"
  | "full"
  | "medium"
  | "close_up"
  | "extreme_close_up";

export type AngleType =
  | "eye"
  | "high"
  | "low"
  | "bird"
  | "worm"
  | "dutch";

export type FigurePose =
  | "stand"
  | "walk"
  | "run"
  | "sit"
  | "crouch"
  | "wave"
  | "point"
  | "arms_up"
  | "hands_clasped"
  | "hand_on_chin"
  | "lie"
  | "back_view"
  | "handshake"
  | "hug";

export type FigureFacing = "left" | "right" | "front" | "back";
export type FigureFraming = "full" | "waist" | "bust" | "face" | null;

export type FigureJointName =
  | "head" | "neck" | "hip"
  | "lElbow" | "lHand" | "rElbow" | "rHand"
  | "lKnee" | "lFoot" | "rKnee" | "rFoot";

/** Panel-local foot anchor; joints use a 100-unit standing height, with feet at y=0. */
export type FigureEditor = {
  version: 1;
  x: number;
  y: number;
  size: number;
  flip: boolean;
  style: "stick" | "box" | "rough";
  view?: "front" | "side";
  break_frame: boolean;
  joints: Record<FigureJointName, [number, number]>;
};

export type Figure = {
  anonymous_character?: SodaCharacter;
  id?: string;
  editor?: FigureEditor;
  character_id: string;
  pose: FigurePose | string;
  position: "left" | "center" | "right" | number;
  facing: FigureFacing;
  framing?: FigureFraming;
};

export type RectShape = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type QuadPoint = [number, number];

export type QuadShape = {
  type: "quad";
  points: [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
};

export type PanelShapeSpec = RectShape | QuadShape;

export type SodaPanel = {
  id: string;
  order: number;
  shape: PanelShapeSpec;
  shot: ShotType | string;
  angle: AngleType | string;
  character_ids: string[];
  description: string;
  caption_en: string;
  use_custom_caption?: boolean;
  caption_auto_en?: { text: string; source_hash: string; translated_at: string } | null;
  figures: Figure[];
  dialogue?: any[];
  sfx?: string[];
  importance?: number;
  status?: string;
  [key: string]: any;
};

export type TextKind = "dialogue" | "narration" | "sfx" | "title" | "caption_tag";
export type BubbleStyle = "speech" | "shout" | "thought" | "box" | "none";

export type SodaText = {
  id: string;
  text: string;
  kind: TextKind;
  panel_id: string | null;
  speaker_id: string | null;
  direction: TextDirection | null;
  bubble: BubbleStyle;
  bbox: RectShape | null;
  style_hint?: string | null;
  tail_tip?: [number, number] | null;
  [key: string]: any;
};

export type OverlayMode = "moss" | "layer";
export type OverlayStatus = "planned" | "approved";

export type SodaOverlay = {
  anonymous_character?: SodaCharacter;
  id: string;
  character_id: string;
  rect: RectShape;
  panel_id?: string | null;
  z_index?: number;
  description: string;
  status?: OverlayStatus | string;
  image_path?: string | null;
  mode?: OverlayMode | string;
  [key: string]: any;
};

export type SodaPage = {
  format: "soda-storyboard-page-v1" | string;
  id: string;
  canvas_width: number;
  canvas_height: number;
  reading_direction: ReadingDirection;
  panel_gap: number;
  dialogue_mode: DialogueMode;
  text_direction: TextDirection;
  color_mode: ColorMode;
  description: string;
  style_prefix?: string;
  legacy_caption_en?: boolean;
  caption_language?: "en" | "zh";
  lora_character?: string;
  style_prompt?: string | null;
  tags?: string[];
  text_font_size?: number;
  text_max_chars?: number;
  panels: SodaPanel[];
  texts: SodaText[];
  overlays?: SodaOverlay[];
  objects?: SodaObject[];
  canvas_mode?: "single" | "panels";
  [key: string]: any;
};

export type SodaObject = {
  id: string;
  rect: RectShape;
  caption: string;
  label?: "object" | "character";
  panel_id?: string | null;
  [key: string]: any;
};

export type PageSummary = {
  id: string;
  description: string;
  panel_count: number;
  version: string;
};

export type CharacterSummary = {
  id: string;
  display_name: string;
  has_lora: boolean;
  figure_hint?: string;
  sketch_color?: string;
};

export type SodaCharacter = {
  format: string;
  id: string;
  display_name: string;
  trigger_words?: string[];
  clothing?: string[];
  reference_images?: string[];
  approved_images?: string[];
  appearance?: {
    zh?: string;
    en?: string;
    [key: string]: any;
  };
  age?: string;
  figure_hint?: string;
  sketch_color?: string;
  appearance_profile?: AppearanceProfile;
  lora?: {
    path: string;
    strength: number;
  };
  [key: string]: any;
};

export type BilingualText = { zh?: string; en?: string; [key: string]: any };
export type AppearanceProfile = {
  version: 1;
  mode: "structured" | "text";
  hair?: { style?: BilingualText; color?: BilingualText; [key: string]: any };
  eyes?: BilingualText;
  outfit?: Array<{ id: string; style?: BilingualText; color?: BilingualText; detail?: BilingualText; [key: string]: any }>;
  signatures?: BilingualText[];
  extra?: BilingualText;
  [key: string]: any;
};

export type SodaProject = {
  format: string;
  name: string;
  default_style_prefix?: string;
  default_canvas_width: number;
  default_canvas_height: number;
  reading_direction: ReadingDirection;
  default_dialogue_mode: DialogueMode;
  text_direction: TextDirection;
  color_mode: ColorMode;
  style_prompt?: string;
  tags?: string[];
  caption_language?: "en" | "zh";
  glossary?: Record<string, string>;
  lora_policy?: "single" | "none";
  [key: string]: any;
};

export type RenderMeta = {
  preset?: string;
  lora?: string | null;
  [key: string]: any;
};

export type RenderItem = {
  path: string;
  seed?: string;
  meta?: RenderMeta;
  url: string;
};

export type RenderListResponse = {
  renders: RenderItem[];
  metadata?: any[];
  selected_render: string | null;
  candidate_sheet: { path: string; url: string } | null;
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type Job = {
  id: string;
  operation: string;
  page_id: string;
  status: JobStatus;
  message: string;
  progress?: {
    args?: any[];
    message?: string;
    [key: string]: any;
  } | null;
  cancel_requested: boolean;
  result?: any;
  error?: string | null;
};

export type LayoutCandidatePanel = {
  type: "rect" | "quad";
  x: number;
  y: number;
  w: number;
  h: number;
  order: number;
  points?: QuadPoint[];
};

export type LayoutCandidate = {
  id: string;
  candidate_id: string;
  template_id: string;
  name: string;
  name_zh: string;
  name_ja?: string;
  description: string;
  preview_url: string;
  score?: number;
  panels: LayoutCandidatePanel[];
  panel_count: number;
  supported_panel_counts?: number[];
  [key: string]: any;
};

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  panel_id?: string | null;
  field?: string | null;
};

export type ValidationResult = {
  valid: boolean;
  exit_code: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos?: ValidationIssue[];
  issues: ValidationIssue[];
};

export type SseEvent =
  | { type: "character_operation"; data: { operation_id: string; action: string; affected_files: string[]; character_id?: string; target_id?: string | null } }
  | { type: "ready"; data: { refresh: boolean } }
  | { type: "resync"; data: { message: string } }
  | {
      type: "file_changed";
      data: {
        path: string;
        change: "modified" | "added" | "deleted";
        page_id: string | null;
        character_id?: string | null;
        version: string | null;
        source?: string;
        client_id?: string;
        message: string;
      };
    }
  | { type: "job"; data: Job };

// ==========================================
// Sketch Geometry Types (P4c Item 1)
// ==========================================

export type Primitive =
  | { type: "circle"; cx: number; cy: number; r: number; width?: number; fill?: string | null }
  | { type: "line"; points: [number, number][]; width: number }
  | { type: "polygon"; points: [number, number][]; fill: string | null; stroke?: string; width?: number };

export type SketchFigure = {
  figure_id?: string;
  break_frame?: boolean;
  character_id: string;
  label: string;
  color: string;
  primitives: Primitive[];
  label_at: [number, number];
};

export type SketchPanel = {
  panel_id: string;
  clip: [number, number][];
  figures: SketchFigure[];
};

export type SketchGeometry = {
  version: string;
  canvas: [number, number];
  panels: SketchPanel[];
};

