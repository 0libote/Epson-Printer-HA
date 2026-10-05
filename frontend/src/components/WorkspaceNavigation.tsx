import { ArrowUpRight, FolderOpen, History, LayoutGrid, Printer, Settings, ShieldCheck } from "lucide-react";
export type WorkspaceView = "overview" | "scans" | "history" | "settings";
const views = [
 { id: "overview", label: "Print & scan", icon: LayoutGrid },
 { id: "scans", label: "Saved scans", icon: FolderOpen },
 { id: "history", label: "Print history", icon: History },
 { id: "settings", label: "Settings", icon: Settings },
] as const;
export function WorkspaceNavigation({ view, onView, displayName, build, scanCount, historyCount }: {
 view: WorkspaceView; onView: (view: WorkspaceView) => void; displayName: string; build?: number; scanCount?: number; historyCount?: number;
}) {
 return <aside className="workspace-sidebar">
  <a href="#overview" className="workspace-brand"><span className="workspace-mark"><Printer size={23} strokeWidth={1.7} /></span><span>Print Room<small>A little less paperwork.</small></span></a>
  <div className="workspace-nav-caption">YOUR WORKSPACE</div>
  <nav aria-label="Sections" className="workspace-navigation">{views.map(({ id, label, icon: Icon }) => {
   const count = id === "scans" ? scanCount : id === "history" ? historyCount : undefined;
   return <button key={id} onClick={() => onView(id)} aria-current={view === id ? "page" : undefined}>
    <Icon size={19} strokeWidth={1.7} /><span>{label}</span>{count !== undefined && count > 0 ? <small>{count}</small> : null}
   </button>;
  })}</nav>
  <div className="workspace-sidebar-bottom">
   <a href="#settings" className="workspace-device"><span className="workspace-device-icon"><Printer size={21} /></span><strong>{displayName}</strong><span>Manage your printer <ArrowUpRight size={13} /></span></a>
   <p><ShieldCheck size={14} /> Private. Right at home.</p><small>{build ? `Build ${build}` : "Local printer workspace"}</small>
  </div>
 </aside>;
}
export function PrinterIllustration() {
 return <svg className="workspace-printer-art" viewBox="0 0 210 150" aria-hidden="true" fill="none">
  <ellipse cx="106" cy="134" rx="73" ry="8" fill="currentColor" opacity=".08" />
  <path d="M64 20h72l17 17v48H64z" fill="var(--ui-panel)" stroke="currentColor" strokeWidth="2" />
  <path d="M136 20v17h17M80 42h42M80 53h53" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35" />
  <rect x="35" y="65" width="142" height="62" rx="15" fill="var(--ui-panel)" stroke="currentColor" strokeWidth="2" />
  <path d="M35 88h142" stroke="currentColor" strokeWidth="2" opacity=".15" />
  <circle cx="157" cy="78" r="3" fill="currentColor" /><circle cx="146" cy="78" r="2" fill="currentColor" opacity=".25" />
  <path d="M65 99h81v36H65z" fill="var(--ui-panel)" stroke="currentColor" strokeWidth="2" />
  <path d="M81 112h48M81 122h31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3" />
 </svg>;
}
