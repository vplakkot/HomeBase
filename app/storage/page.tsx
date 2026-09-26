import { EntryCards, Section, StorageScreen, storageViewer } from "./frame";

// Storage's home (REQ-87, REQ-107): everything in the basement, boxes
// first, then what isn't in a box, each group with its count. Any member
// sees it all.
export default async function StoragePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await storageViewer();
  const { q = "" } = await searchParams;
  const boxed = viewer.entries.filter((entry) => entry.is_box);
  const loose = viewer.entries.filter((entry) => !entry.is_box);

  return (
    <StorageScreen viewer={viewer} here="/storage" query={q}>
      <Section id="boxes" title="Boxes" count={boxed.length}>
        <EntryCards viewer={viewer} entries={boxed} none="No boxes yet. Add to storage to log one." />
      </Section>
      <Section id="loose" title="Not in a box" count={loose.length}>
        <EntryCards viewer={viewer} entries={loose} none="Nothing loose logged." />
      </Section>
    </StorageScreen>
  );
}
