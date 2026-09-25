import Link from "next/link";
import { ownerName, unfiled } from "../../../lib/paperwork/paperwork";
import { PaperworkScreen, paperworkViewer } from "../frame";
import styles from "../paperwork.module.css";
import { FileItButton } from "../sheets";

// REQ-100's fifth screen: paperwork waiting on the desk, which is where
// Home's "N unfiled paperwork" item and the Locations banner lead. Filing
// one is the "done" (REQ-97): it drops off here and off Home's count.
export default async function UnfiledPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const { q = "" } = (await searchParams) ?? {};
  const viewer = await paperworkViewer();
  const waiting = unfiled(viewer.papers);

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork/unfiled" query={q} crumbs={[{ name: "Unfiled" }]}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>On your desk</h2>
        <span className={styles.count}>{waiting.length} to file</span>
      </div>
      {waiting.length === 0 ? (
        <p className={styles.empty}>Everything is filed.</p>
      ) : (
        <ul className={styles.table} aria-label="Unfiled paperwork">
          <li className={`${styles.tableHead} ${styles.unfiled}`} aria-hidden="true">
            <span>Paperwork</span>
            <span>Owner</span>
            <span>Logged</span>
            <span />
          </li>
          {waiting.map((paper) => (
            <li key={paper.id}>
              <div className={`${styles.row} ${styles.unfiled}`}>
                <Link href={`/paperwork/items/${paper.id}`} className={styles.rowName}>
                  {paper.name}
                </Link>
                <span className={styles.rowCell}>{ownerName(paper, viewer.people)}</span>
                <span className={styles.rowCell}>Logged {paper.logged_on}</span>
                {viewer.categories.length === 0 ? null : (
                  <span className={styles.rowAction}>
                    <FileItButton paper={paper} choices={viewer.choices} />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PaperworkScreen>
  );
}
