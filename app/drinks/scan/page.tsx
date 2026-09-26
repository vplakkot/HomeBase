import { DrinksScreen, drinksViewer } from "../frame";
import { CancelScan } from "../scan-button";
import { ScanFlow } from "./flow";

// Scan a label (REQ-25) or use a photo already taken (REQ-26), on a
// screen of its own (REQ-122): Cancel instead of the header's buttons.
export default async function ScanPage() {
  const viewer = await drinksViewer();
  return (
    <DrinksScreen viewer={viewer} section="Scan" actions={<CancelScan />}>
      <ScanFlow />
    </DrinksScreen>
  );
}
