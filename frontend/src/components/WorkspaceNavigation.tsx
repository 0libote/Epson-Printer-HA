import { FolderOpen, History, Printer, Settings } from "lucide-react";
export type WorkspaceView = "overview" | "scans" | "history" | "settings";
const views = [
  { id: "overview", label: "Print & scan", icon: Printer },
  { id: "scans", label: "Saved scans", icon: FolderOpen },
  { id: "history", label: "Print history", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
export function WorkspaceNavigation({ view, onView }: {
  view: WorkspaceView; onView: (view: WorkspaceView) => void;
}) {
  return <nav aria-label="Sections" className="workspace-navigation">{views.map(({ id, label, icon: Icon }) => (
    <a key={id} href={`#${id}`} onClick={() => onView(id)} aria-current={view === id ? "page" : undefined}>
      <Icon size={17} /><span>{label}</span>
    </a>
  ))}</nav>;
}
