import { notFound } from "next/navigation";
import { buttonClass } from "../../../../components/button";
import { archiveName, boxName, fileId, placeOf } from "../../../../lib/paperwork/paperwork";
import { boxes } from "../../../../lib/storage/storage";
import { bringBackPaper, removePaper } from "../../actions";
import { PaperForm } from "../../forms";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { ArchivePaperButton, FileItButton } from "../../sheets";

// One document's details (REQ-97, REQ-100): change any field, move it to
// another file, archive it to a storage box (REQ-153) or bring it back
// from one, or remove it.
export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" } = {}] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { files, storage, locations, archives, choices } = viewer;
  const paper = viewer.papers.find((row) => row.id === id);
  if (!paper) notFound();
  const file = files.find((row) => row.id === paper.file_id);
  const archive = archives.find((row) => row.id === paper.archive_id);
  const box = storage.find((entry) => entry.id === archive?.storage_entry_id);
  const crumbs = file
    ? [
        { name: placeOf(file, storage, locations).name, href: placeOf(file, storage, locations).href },
        { name: fileId(file), href: `/paperwork/files/${file.id}` },
        { name: paper.name },
      ]
    : archive
      ? [
          { name: box ? boxName(box) : "A storage box", href: `/paperwork/boxes/${archive.storage_entry_id}` },
          { name: archiveName(box), href: `/paperwork/archives/${archive.id}` },
          { name: paper.name },
        ]
      : [{ name: "Unfiled", href: "/paperwork/unfiled" }, { name: paper.name }];

  return (
    <PaperworkScreen viewer={viewer} here={`/paperwork/items/${paper.id}`} query={q} crumbs={crumbs}>
      <Section
        id="details"
        title={paper.name}
        aside={`Logged ${paper.logged_on}`}
        action={
          <div className={styles.fileButtons}>
            {archive ? null : <FileItButton paper={paper} choices={choices} moving={file !== undefined} />}
            {archive ? (
              <form action={bringBackPaper}>
                <input type="hidden" name="id" value={paper.id} />
                <button type="submit" className={buttonClass}>
                  Bring back
                </button>
              </form>
            ) : (
              <ArchivePaperButton paper={paper} boxes={boxes(storage)} />
            )}
          </div>
        }
      >
        <div className={styles.card}>
          <PaperForm {...choices} paper={paper} />
          <form action={removePaper}>
            <input type="hidden" name="id" value={paper.id} />
            <input type="hidden" name="fileId" value={paper.file_id ?? ""} />
            <input type="hidden" name="boxId" value={archive?.storage_entry_id ?? ""} />
            <button type="submit" className={buttonClass} aria-label={`Remove ${paper.name}`}>
              Remove the document
            </button>
          </form>
        </div>
      </Section>
    </PaperworkScreen>
  );
}
