import { notFound } from "next/navigation";
import { filesCount, places } from "../../../../lib/paperwork/paperwork";
import { FileCards } from "../../file-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { ManageLocation, NewFile } from "../../sheets";

// REQ-100's second screen for a location: every file kept there, and
// (REQ-179) a menu to rename it or, once it's empty, delete it. A file that
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
  const { office } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage, viewer.locations);
  const place = office.find((card) => card.href === `/paperwork/locations/${id}`);
  if (!place) notFound();
  const filesHere = viewer.files.filter((file) => file.location_id === id).length;

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <Section
        id="files"
        title={place.name}
        aside={filesCount(place.files.length)}
        action={
          <div className={styles.fileButtons}>
            <NewFile location={id} choices={viewer.choices} />
            <ManageLocation location={location} files={filesHere} />
          </div>
        }
      >
        {place.files.length === 0 ? <p className={styles.empty}>No files here yet.</p> : <FileCards rows={place.files} />}
      </Section>
    </PaperworkScreen>
  );
}
