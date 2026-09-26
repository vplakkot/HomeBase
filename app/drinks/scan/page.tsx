import { DrinksScreen, drinksViewer } from "../frame";
import { ScanFlow } from "./flow";

// Scan a label (REQ-25) or use a photo already taken (REQ-26).
export default async function ScanPage() {
  const viewer = await drinksViewer();
  return (
    <DrinksScreen viewer={viewer} crumb="Scan a label">
      <ScanFlow />
    </DrinksScreen>
  );
}
