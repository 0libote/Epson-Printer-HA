import {
  FileText,
  FolderOpen,
  History,
  Printer,
  ScanLine,
  Settings,
  Wifi,
} from "lucide-react";
import type { WorkspaceView } from "../lib/navigation";

const views = [
  { id: "print", label: "Print", icon: Printer },
  { id: "scan", label: "Scan", icon: ScanLine },
  { id: "scans", label: "Saved scans", icon: FolderOpen },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Brand() {
  return (
    <a href="#print" className="app-brand" aria-label="Print Room home">
      <span className="brand-symbol" aria-hidden="true">
        <FileText size={25} strokeWidth={1.5} />
        <span className="brand-inks">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
      <span>
        Print Room<small>Your home printer</small>
      </span>
    </a>
  );
}

export function WorkspaceNavigation({
  view,
  displayName,
  printerIp,
  queueCount,
  build,
}: {
  view: WorkspaceView;
  displayName: string;
  printerIp: string;
  queueCount: number;
  build?: number;
}) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <Brand />
      </div>
      <nav aria-label="Main navigation" className="workspace-navigation">
        {views.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={19} strokeWidth={1.7} />
            <span>{label}</span>
            {id === "print" && queueCount > 0 ? (
              <span className="nav-count" aria-hidden="true">
                {queueCount}
              </span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a href="#settings" className="sidebar-device">
          <Printer size={19} />
          <span>
            <strong title={displayName}>{displayName}</strong>
            <small>
              <Wifi size={11} /> {printerIp || "Not connected"}
            </small>
          </span>
        </a>
        <div className="sidebar-build">
          <span className="local-dot" /> Local network
          <span>{build ? `Build ${build}` : "Print Room"}</span>
        </div>
      </div>
    </aside>
  );
}
