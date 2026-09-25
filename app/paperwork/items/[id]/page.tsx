import { notFound } from "next/navigation";
import cards from "../../../../components/cards.module.css";
import { fileId, placeOf } from "../../../../lib/paperwork/paperwork";
import { removePaper } from "../../actions";
import { PaperForm } from "../../forms";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { FileItButton } from "../../sheets";

// One paper's details (REQ-97, REQ-100): change any field, move it to
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
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{paper.name}</h2>
        <span className={styles.count}>Logged {paper.logged_on}</span>
      </div>
      <div className={styles.fileButtons}>
        <FileItButton paper={paper} choices={choices} moving={file !== undefined} />
      </div>
      <section className={cards.card} aria-labelledby="details">
        <header className={cards.head}>
          <h2 id="details" className={cards.name}>
            Details
          </h2>
        </header>
        <div className={cards.addBlock}>
          <PaperForm {...choices} paper={paper} />
          <form action={removePaper} className={cards.form}>
            <input type="hidden" name="id" value={paper.id} />
            <input type="hidden" name="fileId" value={paper.file_id ?? ""} />
            <button type="submit" className={cards.quiet} aria-label={`Remove ${paper.name}`}>
              Remove the paperwork
            </button>
          </form>
        </div>
      </section>
    </PaperworkScreen>
  );
}
