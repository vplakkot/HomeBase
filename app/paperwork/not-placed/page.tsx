import { fileFoldersCount, NOT_PLACED_HREF, places } from "../../../lib/paperwork/paperwork";
import { FileFolderCards } from "../file-folder-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../frame";
import styles from "../paperwork.module.css";

// REQ-206: the File Folders made before anyone knew where they would live.
// Each gets its place from Manage File Folder, and drops off this list when
// it does. It isn't a location: it has nothing to rename or delete.
export default async function NotPlacedPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const viewer = await paperworkViewer();
  const { notPlaced } = places(viewer.fileFolders, viewer.categories, viewer.papers, viewer.storage, viewer.locations, [], viewer.drive);

  return (
    <PaperworkScreen viewer={viewer} here={NOT_PLACED_HREF} query={q} crumbs={[{ name: "Not placed" }]}>
      <Section id="fileFolders" title="Not placed" aside={fileFoldersCount(notPlaced?.fileFolders.length ?? 0)}>
        {notPlaced ? (
          <FileFolderCards rows={notPlaced.fileFolders} />
        ) : (
          <p className={styles.empty}>Every File Folder has a place.</p>
        )}
      </Section>
    </PaperworkScreen>
  );
}
