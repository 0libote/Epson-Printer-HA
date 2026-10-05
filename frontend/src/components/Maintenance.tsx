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
 return <Card><h2>Maintenance</h2>
  {caps.nozzleCheck ? <button disabled={running} onClick={() => run("nozzle-check")}>Nozzle Check</button> : null}
  {caps.headCleaning ? <button disabled={running} onClick={() => run("head-clean")}>Head Cleaning</button> : null}
  <p role="status">{message || "Available"}</p>
 </Card>;
}
