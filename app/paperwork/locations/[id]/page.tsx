import { notFound } from "next/navigation";
import { fileFoldersCount, places } from "../../../../lib/paperwork/paperwork";
import { FileFolderCards } from "../../file-folder-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { ManageLocation, NewFileFolder } from "../../sheets";

// REQ-100's second screen for a location: every File Folder kept there, and
// (REQ-179) a menu to rename it or, once it's empty, delete it. A File Folder that
// is archived in storage still counts as being in its location, so it must
// move before the location can go.
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const location = viewer.locations.find((row) => row.id === id);
  if (!location) notFound();
  const { office } = places(viewer.fileFolders, viewer.categories, viewer.papers, viewer.storage, viewer.locations, [], viewer.drive);
  const place = office.find((card) => card.href === `/paperwork/locations/${id}`);
  if (!place) notFound();
  const fileFoldersHere = viewer.fileFolders.filter((fileFolder) => fileFolder.location_id === id).length;

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <Section
        id="fileFolders"
        title={place.name}
        aside={fileFoldersCount(place.fileFolders.length)}
        action={
          <div className={styles.fileFolderButtons}>
            <NewFileFolder location={id} choices={viewer.choices} />
            {location.built_in ? null : <ManageLocation location={location} fileFolders={fileFoldersHere} />}
          </div>
        }
      >
        {place.fileFolders.length === 0 ? <p className={styles.empty}>No File Folders here yet.</p> : <FileFolderCards rows={place.fileFolders} />}
      </Section>
    </PaperworkScreen>
  );
}
