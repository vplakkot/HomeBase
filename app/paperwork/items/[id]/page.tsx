import { notFound } from "next/navigation";
import { buttonClass } from "../../../../components/button";
import { fileId, placeOf } from "../../../../lib/paperwork/paperwork";
import { removePaper } from "../../actions";
import { PaperForm } from "../../forms";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { FileItButton } from "../../sheets";

// One document's details (REQ-97, REQ-100): change any field, move it to
// another file, or remove it.
export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" } = {}] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { files, storage, choices } = viewer;
  const paper = viewer.papers.find((row) => row.id === id);
  if (!paper) notFound();
  const file = files.find((row) => row.id === paper.file_id);
  const crumbs = file
    ? [
        { name: placeOf(file, storage).name, href: placeOf(file, storage).href },
        { name: fileId(file), href: `/paperwork/files/${file.id}` },
        { name: paper.name },
      ]
    : [{ name: "Unfiled", href: "/paperwork/unfiled" }, { name: paper.name }];

  return (
    <PaperworkScreen viewer={viewer} here={`/paperwork/items/${paper.id}`} query={q} crumbs={crumbs}>
      <Section
        id="details"
        title={paper.name}
        aside={`Logged ${paper.logged_on}`}
        action={<FileItButton paper={paper} choices={choices} moving={file !== undefined} />}
      >
        <div className={styles.card}>
          <PaperForm {...choices} paper={paper} />
          <form action={removePaper}>
            <input type="hidden" name="id" value={paper.id} />
            <input type="hidden" name="fileId" value={paper.file_id ?? ""} />
            <button type="submit" className={buttonClass} aria-label={`Remove ${paper.name}`}>
              Remove the document
            </button>
          </form>
        </div>
      </Section>
    </PaperworkScreen>
  );
}
