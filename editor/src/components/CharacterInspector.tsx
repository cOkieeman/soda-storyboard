import React, { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Copy, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { activeCharacterDraft, characterAppearanceText, characterLora, composeAppearanceZh, emptyAppearanceProfile, useCharacterDraftStore } from "../lib/characterDrafts";
import { useEditorStore } from "../lib/store";
import { CHARACTER_COLOR_PRESETS, characterSketchColor } from "../lib/characterColors";
import type { AppearanceProfile, BilingualText } from "../types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="inspector-section"><h3 className="text-[13px] font-semibold">{title}</h3><div className="inspector-section-content space-y-3">{children}</div></section>;
}
function Field({ label, value, onChange, placeholder, readOnly = false }: { label: string; value: string; onChange?: (value: string) => void; placeholder?: string; readOnly?: boolean }) {
  return <label className="block min-w-0"><span className="ui-label">{label}</span><input className="ui-input w-full" aria-label={label} value={value} placeholder={placeholder} readOnly={readOnly} onChange={event => onChange?.(event.target.value)} /></label>;
}

export default function CharacterInspector() {
  const state = useCharacterDraftStore();
  const draft = activeCharacterDraft(state);
  const sodaPage = useEditorStore(editor => editor.sodaPage);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  useEffect(() => { setConversionOpen(false); setTranslationStatus(""); }, [draft?.key]);
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void useCharacterDraftStore.getState().validate(draft.key, controller.signal), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft?.key, draft?.revision, sodaPage]);
  if (!draft) return <aside className="inspector-panel p-5" aria-label="角色资料"><p role={state.loadError ? "alert" : "status"}>{state.loadError || "正在载入角色资料…"}</p>{state.loadError && state.target.kind === "character" && <button className="ui-btn mt-3" onClick={() => { if (state.target.kind === "character") void state.open(state.target.id); }}>重试读取</button>}<button className="ui-btn mt-3" onClick={state.showCanvas}>返回画布</button></aside>;
  const character = draft.value;
  const appearance = typeof character.appearance === "object" ? character.appearance : {};
  const name = character.display_name || character.name || "未命名角色";
  const profile = character.appearance_profile;
  const structured = profile?.mode === "structured";
  const patch = (value: Partial<typeof character>) => state.edit(draft.key, value);
  const updateProfile = (value: Partial<AppearanceProfile>) => {
    const next = { ...profile!, ...value };
    delete next.generated;
    patch({ appearance_profile: next });
  };
  const updateHair = (key: "style" | "color", text: string) => updateProfile({ hair: { ...profile?.hair, [key]: { ...profile?.hair?.[key], zh: text } } });
  const updateText = (key: "eyes" | "extra", text: string) => updateProfile({ [key]: { ...profile?.[key], zh: text } });
  const updateAppearance = (language: "zh" | "en", text: string) => patch({ appearance: { ...(typeof character.appearance === "object" ? character.appearance : {}), zh: characterAppearanceText(character, "zh"), en: characterAppearanceText(character, "en"), [language]: text }, ...(`appearance_${language}` in character ? { [`appearance_${language}`]: text } : {}) });
  const draftValidation = draft.validation;
  const warnings = draftValidation?.warnings || [];
  const externalAppearance = warnings.some(issue => issue.code === "appearance_generated_mismatch");
  const awaitingSourceCheck = Boolean(profile?.generated && !draftValidation && !draft.validationError);
  const errors = draftValidation?.errors || [];
  const zh = structured ? draftValidation?.character.appearance?.zh ?? (characterAppearanceText(character, "zh") || composeAppearanceZh(profile!)) : characterAppearanceText(character, "zh");
  const en = characterAppearanceText(character, "en");
  const color = characterSketchColor(character);
  const lora = characterLora(character);
  const canSave = Boolean(character.id?.trim() && (character.display_name || character.name || "").trim() && draft.dirty && !draft.saving && !draft.conflict && errors.length === 0);
  const conversion = emptyAppearanceProfile();
  conversion.extra = { zh: characterAppearanceText(character, "zh") };
  if (character.clothing?.length) conversion.outfit = character.clothing.map((style, index) => ({ id: `garment_${index + 1}`, style: { zh: style }, color: { zh: "" } }));
  const copyTranslation = async () => {
    const request = `请将以下角色固定外观翻译成英文，保留发型、发色、眼睛、服装款式与颜色及标志物，不添加动作或镜头。只返回英文描述。\n角色 ID：${character.id}\n中文：${zh}\n已有英文：${en || "（空）"}`;
    try { await navigator.clipboard.writeText(request); setTranslationStatus("已复制翻译请求；交给插件 AI 后，将结果粘贴到英文外观。"); }
    catch { setTranslationStatus("无法复制，请将中文外观交给插件 AI 翻译，再粘贴英文结果。"); }
  };
  return <aside className="inspector-panel flex h-full min-h-0 flex-col" aria-label="角色资料" data-testid="character-inspector">
    <div className="inspector-heading flex shrink-0 items-center justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-[14px] font-semibold">{draft.baseline ? name : draft.sourceId ? "复制角色" : "新建角色"}</h2><p className="mt-1 text-[12px] text-[var(--ink-light)]">项目角色 · 显式保存</p></div><button className="ui-btn ui-btn-sm" onClick={state.showCanvas}><ArrowLeft size={13} />返回人物</button></div>
    <div className="inspector-content min-h-0 flex-1 overflow-y-auto">
      <p className="border-b border-[var(--line)] px-5 py-3 text-[12px] leading-relaxed text-[var(--ink-light)]">资料用于所有引用此角色的页面。人物姿势和位置仍在画布中编辑。</p>
      <fieldset disabled={draft.saving} className="min-w-0">
        <Section title="基本资料">
          <Field label="角色名称" value={character.display_name || character.name || ""} readOnly={Boolean(draft.baseline)} onChange={value => patch({ display_name: value })} placeholder="例如：妹妹" />
          <Field label="角色 ID" value={character.id} readOnly={Boolean(draft.baseline)} onChange={value => patch({ id: value })} placeholder="character_01" />
          {draft.baseline ? <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">改名、更改 ID 和删除将在第二阶段支持。</p> : <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">ID 以小写字母开头，可使用小写字母、数字、下划线和短横线。</p>}
          <Field label="英文称呼" value={character.role_en || ""} onChange={value => patch({ role_en: value })} placeholder="the younger sister" />
          <Field label="年龄" value={character.age || ""} onChange={value => patch({ age: value })} placeholder="可选" />
          <label className="block"><span className="ui-label">人物色 · {color}</span><div className="flex flex-wrap items-center gap-2">{CHARACTER_COLOR_PRESETS.map(item => <button key={item.value} type="button" className="h-7 w-7 rounded border-2" style={{ background: item.value, borderColor: item.value === color ? "var(--ink)" : "transparent" }} aria-label={`人物色 ${item.name}`} aria-pressed={item.value === color} onClick={() => patch({ sketch_color: item.value })} />)}<input aria-label="自定义人物色" type="color" value={color} onChange={event => patch({ sketch_color: event.target.value.toUpperCase() })} className="h-8 w-12 border border-[var(--line)]" /></div></label>
          <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">人物色用于分镜识别，不决定头发或衣服的实际颜色；随角色资料一起保存。</p>
          {draft.baseline && <button className="ui-btn ui-btn-sm" onClick={() => void state.duplicate(character.id)}><Copy size={13} />复制为新角色</button>}
        </Section>
        {draft.sourceId && <Section title="复制选项"><p className="text-[12px] text-[var(--ink-light)]">来源：{draft.sourceId}。批准图不复制。</p>{([['copy_lora', '复制 LoRA'], ['copy_trigger_words', '复制触发词'], ['copy_reference_images', '复制参考图']] as const).map(([option, label]) => <label key={option} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.copyOptions[option]} onChange={event => state.setCopyOption(draft.key, option, event.target.checked)} />{label}</label>)}</Section>}
        <Section title="外观描述">
          <div className="flex gap-2"><button className="ui-btn ui-btn-sm" aria-pressed={structured} disabled={structured} onClick={() => setConversionOpen(value => !value)}>结构化填写</button><button className="ui-btn ui-btn-sm" aria-pressed={!structured} disabled={!structured} onClick={() => patch({ appearance_profile: { ...profile!, mode: "text" }, appearance: { ...appearance, zh, en } })}>直接编辑文本</button></div>
          {!structured && conversionOpen && <div className="ui-notice-box space-y-2"><p className="text-[12px] leading-relaxed">转换会将旧描述保留在“其他固定特征”，附加服装迁入服装行。确认下方预览后可继续整理；原卡在保存前不会改变。</p><p className="text-[12px] whitespace-pre-wrap">{composeAppearanceZh(conversion) || "（空外观）"}</p><button className="ui-btn ui-btn-sm" onClick={() => { patch({ appearance_profile: conversion, clothing: [], appearance: { ...appearance, zh: composeAppearanceZh(conversion), en } }); setConversionOpen(false); }}>确认转换为结构化</button></div>}
          {structured && (externalAppearance || awaitingSourceCheck) ? <div className="ui-notice-box space-y-2"><p className="text-[12px] leading-relaxed">{awaitingSourceCheck ? "正在核对结构化来源与最终文本…" : "最终外观已被外部修改。请选择保留外部文本，或明确重新生成；不会自动覆盖。"}</p>{externalAppearance && <><button className="ui-btn ui-btn-sm" onClick={() => patch({ appearance_profile: { ...profile!, mode: "text" } })}>保留外部文本</button><button className="ui-btn ui-btn-sm" onClick={() => { if (window.confirm(`重新生成将替换当前中文外观为：\n${composeAppearanceZh(profile!)}\n\n确认重新生成？`)) updateProfile({}); }}>重新生成结构化外观</button></>}</div> : structured ? <>
            <div className="grid grid-cols-2 gap-3"><Field label="发型" value={profile?.hair?.style?.zh || ""} onChange={text => updateHair("style", text)} placeholder="双马尾" /><Field label="发色" value={profile?.hair?.color?.zh || ""} onChange={text => updateHair("color", text)} placeholder="粉色" /></div>
            <Field label="眼睛" value={profile?.eyes?.zh || ""} onChange={text => updateText("eyes", text)} placeholder="琥珀色眼睛" />
            <div className="space-y-3"><h4 className="ui-label">服装款式与颜色</h4>{(profile?.outfit || []).map((item, index) => <div className="space-y-2 rounded border border-[var(--line)] p-2" key={item.id}><div className="grid grid-cols-2 gap-2">{(['style', 'color'] as const).map(key => <Field key={key} label={`服装 ${index + 1} ${key === 'style' ? '款式' : '颜色'}`} value={item[key]?.zh || ""} placeholder={key === 'style' ? "宽松连帽衫" : "亮黄色"} onChange={text => updateProfile({ outfit: profile!.outfit!.map((garment, i) => i === index ? { ...garment, [key]: { ...garment[key], zh: text } } : garment) })} />)}</div><div className="flex items-end gap-2"><div className="flex-1"><Field label={`服装 ${index + 1} 细节`} value={item.detail?.zh || ""} placeholder="可选" onChange={text => updateProfile({ outfit: profile!.outfit!.map((garment, i) => i === index ? { ...garment, detail: { ...garment.detail, zh: text } } : garment) })} /></div><button className="ui-icon-btn" aria-label={`移除服装 ${index + 1}`} onClick={() => updateProfile({ outfit: profile!.outfit!.filter((_, i) => i !== index) })}><Trash2 size={14} /></button></div></div>)}<button className="ui-btn ui-btn-sm" onClick={() => updateProfile({ outfit: [...(profile?.outfit || []), { id: `garment_${Date.now()}`, style: { zh: "" }, color: { zh: "" }, detail: { zh: "" } }] })}><Plus size={13} />添加服装</button></div>
            <label className="block"><span className="ui-label">标志物（每行一项）</span><textarea aria-label="标志物" rows={2} className="ui-textarea" value={(profile?.signatures || []).map(item => item.zh || "").join("\n")} onChange={event => updateProfile({ signatures: event.target.value.split("\n").map((text, index): BilingualText => ({ ...profile?.signatures?.[index], zh: text })) })} placeholder="红色星形发夹" /></label>
            <Field label="其他固定特征" value={profile?.extra?.zh || ""} onChange={text => updateText("extra", text)} placeholder="体型、物种等" />
          </> : <>
            <label className="block"><span className="ui-label">中文外观</span><textarea rows={4} className="ui-textarea" aria-label="中文外观" value={characterAppearanceText(character, "zh")} onChange={event => updateAppearance("zh", event.target.value)} /></label>
            <label className="block"><span className="ui-label">附加服装（每行一项）</span><textarea aria-label="附加服装" rows={2} className="ui-textarea" value={(character.clothing || []).join("\n")} onChange={event => patch({ clothing: event.target.value.split("\n").filter(Boolean) })} /></label>
            <p className="text-[12px] text-[var(--ink-light)]">旧角色保持原始文本，只有确认转换后才使用结构化字段。</p>
          </>}
          <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">写固定外观，避免填写本格动作、表情或镜头。头发和眼睛的颜色不能代替服装颜色。</p>
        </Section>
        <Section title="最终描述与英文">
          {structured && <label className="block"><span className="ui-label">中文外观预览</span><textarea className="ui-textarea" readOnly rows={3} aria-label="中文外观预览" value={zh} placeholder="填写结构化字段后自动生成" /></label>}
          <label className="block"><span className="ui-label">英文外观（可选）</span><textarea className="ui-textarea" rows={3} aria-label="英文外观" value={en} onChange={event => updateAppearance("en", event.target.value)} placeholder="可手填，或留空后交给插件 AI 翻译" /></label>
          <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">英文可以留空保存。可复制请求，交给插件 AI 翻译后粘贴回来；编辑器不会自动连接模型。修改中文后请同步检查已有英文。</p>
          <button className="ui-btn ui-btn-sm" onClick={() => void copyTranslation()}>复制插件 AI 翻译请求</button>{translationStatus && <p className="text-[12px]" role="status">{translationStatus}</p>}
        </Section>
        <Section title="描述检查"><div className="space-y-2 text-[12px] leading-relaxed" aria-live="polite" data-testid="character-warnings">{draft.validationError && <p role="alert">检查暂时失败：{draft.validationError}</p>}{!draft.validation && !draft.validationError && <p>正在检查外观…</p>}{errors.map((issue, index) => <p key={`error-${index}`} role="alert" className="text-[var(--error)]">{issue.message}</p>)}{warnings.map((issue, index) => <p key={issue.code + index} className="ui-notice-box" data-code={issue.code}>{issue.message}</p>)}{draft.validation && !warnings.length && !errors.length && <p>服装描述检查通过。</p>}<p className="text-[var(--ink-light)]">提醒不会阻止保存待完善角色。同页相似服装可以是合理设定，请结合标志物判断。</p></div></Section>
        <Section title="LoRA（可选）">
          <label className="flex items-center gap-2 text-[13px]"><input aria-label="为角色配置 LoRA" type="checkbox" checked={Boolean(lora)} onChange={event => patch({ lora: event.target.checked ? { path: "", strength: 1 } : null as any, ...(!event.target.checked && "lora_path" in character ? { lora_path: null, lora_strength: null } : {}) })} />为角色配置 LoRA</label>
          {lora && <><Field label="LoRA 文件" value={lora.path || ""} onChange={value => patch({ lora: { ...lora, path: value } })} placeholder="character.safetensors" /><label className="block"><span className="ui-label">LoRA 强度</span><input aria-label="LoRA 强度" className="ui-input" type="number" step="0.05" value={lora.strength} onChange={event => { if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) patch({ lora: { ...lora, strength: event.target.valueAsNumber } }); }} /></label></>}
          <Field label="触发词（逗号分隔）" value={(character.trigger_words || character.triggers || []).join(",")} onChange={value => patch({ trigger_words: value ? value.split(/[,，]/).map(item => item.trim()) : [] })} />
          <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">每页最多使用一个角色 LoRA，其余角色依靠外观描述保持一致；配置 LoRA 也需要填写外观。项目或页面可以禁用 LoRA。</p>
        </Section>
      </fieldset>
    </div>
    <div className="shrink-0 space-y-2 border-t border-[var(--line)] px-4 py-3" role="status">
      {(draft.error || draft.externalChanged) && <p className="text-[12px] leading-relaxed text-[var(--error)]" role="alert">{draft.error || "角色已在外部更新。本地草稿保留，保存时将检查打开时的版本。"}</p>}
      {(draft.conflict || draft.externalChanged) && <button className="ui-btn ui-btn-sm" disabled={draft.saving} onClick={() => { if (window.confirm("放弃这个角色的本地草稿，并载入服务器最新资料？")) void state.reload(draft.key); }}><RefreshCw size={13} />放弃草稿并载入最新</button>}
      <p className="text-[12px] text-[var(--ink-light)]">{draft.saving ? "正在保存角色…" : draft.dirty ? "角色有未保存修改 · Ctrl+S 保存角色" : "角色已保存"}</p>
      <div className="flex flex-wrap gap-2"><button className="ui-btn ui-btn-sm" disabled={draft.saving || !draft.dirty} onClick={() => { if (window.confirm("放弃这个角色的未保存修改？")) state.discard(draft.key); }}>放弃修改</button><button className="ui-btn ui-btn-sm ui-btn-primary" disabled={!canSave} onClick={() => void state.save(draft.key)}><Save size={13} />{draft.baseline ? "保存角色" : draft.sourceId ? "创建副本" : draft.assignTo ? "创建并指派角色" : "创建角色"}</button></div>
    </div>
  </aside>;
}
