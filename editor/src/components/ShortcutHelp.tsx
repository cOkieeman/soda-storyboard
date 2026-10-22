import ModalShell from "./modals/ModalShell";
import { shortcutHelp } from "../lib/editorActions";
export default function ShortcutHelp({onClose}:{onClose:()=>void}) {
  return <ModalShell title="快捷键与画布操作" onClose={onClose}><div className="p-5 space-y-2">{shortcutHelp.map(([key,label])=><div key={key} className="flex justify-between gap-6 border-b border-[var(--line)] py-2"><span>{label}</span><kbd className="text-sm text-[var(--muted)]">{key}</kbd></div>)}</div></ModalShell>;
}
