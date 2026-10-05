import { Component, type ReactNode } from "react";
export class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
 state = { failed: false };
 static getDerivedStateFromError() { return { failed: true }; }
 render() {
  if (this.state.failed) return <div className="section-loading" role="alert">
   <p>This view couldn’t be opened. Reload to get the latest version.</p>
   <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>Reload page</button>
  </div>;
  return this.props.children;
 }
}
