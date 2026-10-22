import { Fragment, useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text, Transformer } from "react-konva";
import { useEditorStore } from "../../lib/store";
import type { Selection, SodaObject } from "../../types";

type Drag = (event: Konva.KonvaEventObject<DragEvent>) => void;
type Props = { box: SodaObject; enabled: boolean; onDragStart: (event: Konva.KonvaEventObject<DragEvent>, item: Selection) => void; onDragMove: Drag; onDragEnd: Drag };

export default function EditableObjectBox({ box, enabled, onDragStart, onDragMove, onDragEnd }: Props) {
  const group = useRef<Konva.Group>(null), transformer = useRef<Konva.Transformer>(null);
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const flags = useEditorStore(state => state.objectFlags);
  const item: Selection = { kind: "object", id: box.id };
  const selected = selections.some(item => item.kind === "object" && item.id === box.id);
  const locked = useEditorStore.getState().isObjectLocked(item), hidden = useEditorStore.getState().isObjectHidden(item);
  const editable = enabled && !locked && !hidden;
  useEffect(() => {
    transformer.current?.nodes(selected && editable && selections.length === 1 && group.current ? [group.current] : []);
  }, [selected, editable, selections.length, box.rect, flags, selection]);
  const color = box.label === "character" ? "#9a321f" : "#777067";
  return <Fragment>
    <Group ref={group} id={`object-${box.id}`} name="overlay-node object-node" x={box.rect.x} y={box.rect.y} width={box.rect.w} height={box.rect.h} visible={!hidden} listening={enabled} draggable={editable}
      onClick={event => { event.cancelBubble = true; useEditorStore.getState().selectItem(item, event.evt.shiftKey); }}
      onTap={event => { event.cancelBubble = true; useEditorStore.getState().selectItem(item); }}
      onDragStart={event => onDragStart(event, item)} onDragMove={onDragMove} onDragEnd={onDragEnd}
      onTransformEnd={() => {
        const node = group.current; if (!node) return;
        const page = useEditorStore.getState().sodaPage; if (!page) return;
        const x = Math.max(0, Math.min(page.canvas_width - 8, node.x())), y = Math.max(0, Math.min(page.canvas_height - 8, node.y()));
        const w = Math.max(8, Math.min(page.canvas_width - x, box.rect.w * node.scaleX())), h = Math.max(8, Math.min(page.canvas_height - y, box.rect.h * node.scaleY()));
        node.scale({ x: 1, y: 1 });
        useEditorStore.getState().updateObjectBox(box.id, { rect: { type: "rect", x, y, w, h } });
      }}>
      <Rect width={box.rect.w} height={box.rect.h} stroke={color} strokeWidth={2} dash={[7, 4]} fill={selected ? "rgba(154,50,31,.12)" : "rgba(120,110,90,.03)"} />
      <Text text={`${box.label === "character" ? "人物框" : "物件框"} · ${box.caption.slice(0, 28)}`} x={5} y={5} width={Math.max(10, box.rect.w - 10)} fontSize={14} fill={color} listening={false} />
    </Group>
    <Transformer ref={transformer} name="selection-transformer" rotateEnabled={false} flipEnabled={false} keepRatio={false} anchorSize={9} borderStroke={color} anchorStroke={color} anchorFill="#fbf6ec" />
  </Fragment>;
}
