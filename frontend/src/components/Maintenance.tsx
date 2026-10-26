import { useState } from "react";
import { type PrinterCapabilities, runMaintenance } from "../lib/api";
import { Card } from "./ui";
export function Maintenance({ capabilities: caps, onChanged }: { capabilities?: PrinterCapabilities; onChanged: () => void }) {
 const [running, setRunning] = useState(false);
 const [message, setMessage] = useState("");
 if (!caps?.nozzleCheck && !caps?.headCleaning) return null;
 const run = async (action: "nozzle-check" | "head-clean") => {
  setRunning(true); setMessage("Maintenance running");
  try { await runMaintenance(action); setMessage("Maintenance complete"); onChanged(); }
  catch { setMessage("Maintenance failed. Check the printer and try again."); }
  finally { setRunning(false); }
 };
 return <Card className="maintenance-card"><h2>Maintenance</h2>
  {caps.nozzleCheck ? <button className="button-secondary" disabled={running} onClick={() => run("nozzle-check")}>Nozzle check</button> : null}
  {caps.headCleaning ? <button className="button-secondary" disabled={running} onClick={() => run("head-clean")}>Head cleaning</button> : null}
  <p role="status">{message || "Available"}</p>
 </Card>;
}
