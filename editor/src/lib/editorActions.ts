import { useEditorStore } from "./store";
export type EditorAction = { id: string; label: string; shortcut?: string; keywords: string; run: () => void; disabled?: () => string | null };
export const batchActions: EditorAction[] = [
  { id: "duplicate", label: "复制选中对象", shortcut: "Ctrl+D", keywords: "duplicate clone 复制", run: () => { useEditorStore.getState().duplicateSelection(); }, disabled:()=>useEditorStore.getState().selections.length?null:"请先选择要复制的对象" },
  { id: "copy", label: "复制到剪贴板", shortcut: "Ctrl+C", keywords: "copy 复制", run: () => { void useEditorStore.getState().copySelection(); }, disabled:()=>useEditorStore.getState().selections.length?null:"请先选择要复制的对象" },
  { id: "paste", label: "粘贴对象", shortcut: "Ctrl+V", keywords: "paste 粘贴", run: () => { void useEditorStore.getState().pasteSelection(); } },
  { id: "dialogue", label: "编辑整页台词", keywords: "台词 对白 整页 dialogue", run: () => { window.dispatchEvent(new Event("soda:open-dialogue-editor")); } },
  { id: "favorites", label: "我的姿势与气泡收藏", keywords: "收藏 喜爱 favorites 姿势 气泡", run: () => { window.dispatchEvent(new Event("soda:open-favorites")); } },
  ...([ ["left", "左对齐"], ["center-x", "水平居中"], ["right", "右对齐"], ["top", "顶对齐"], ["center-y", "垂直居中"], ["bottom", "底对齐"], ["distribute-x", "水平等距分布"], ["distribute-y", "垂直等距分布"] ] as const).map(([id,label]) => ({ id: `align-${id}`, label, keywords:"批量 对齐 分布 align distribute", run:()=>useEditorStore.getState().alignSelection(id), disabled:()=>useEditorStore.getState().selections.length < (id.startsWith("distribute") ? 3 : 2) ? `至少选择 ${id.startsWith("distribute") ? 3 : 2} 个对象` : null }))
];
export const shortcutHelp = [
  ["V / P / T / C / H", "选择 / 分格 / 台词 / 人物 / 平移"], ["Space + 拖动", "临时平移画布"], ["滚轮", "围绕指针缩放"],
  ["Shift + 点击 / 空白拖框", "多选对象"], ["Alt + 拖动", "复制并移动"], ["← ↑ → ↓ / Shift", "移动 1 / 10 像素"],
  ["1 / 2 / F", "适合整页 / 适合选中 / 聚焦当前格"], ["Ctrl+\\", "切换专注画布"],
  ...batchActions.filter(a=>a.shortcut).map(a=>[a.shortcut!,a.label]), ["Ctrl+Z / Ctrl+Shift+Z", "撤销 / 重做"], ["Ctrl+S / Ctrl+K", "保存 / 命令搜索"], ["双击台词 / Ctrl+Enter", "编辑台词 / 保存文字"], ["?", "快捷键帮助"]
];
