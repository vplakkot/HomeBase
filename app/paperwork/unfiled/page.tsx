import Link from "next/link";
import { ownerName, unfiled } from "../../../lib/paperwork/paperwork";
import { PaperworkScreen, Section, paperworkViewer } from "../frame";
import styles from "../paperwork.module.css";
import { FileItButton } from "../sheets";

// REQ-100's fifth screen: documents waiting on the desk, which is where
// Home's "N documents unfiled" item and the Overview's action item lead. Filing
// one is the "done" (REQ-97): it drops off here and off Home's count.
export default async function UnfiledPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const { q = "" } = (await searchParams) ?? {};
  const viewer = await paperworkViewer();
  const waiting = unfiled(viewer.papers);

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork/unfiled" query={q} tab="Unfiled" crumbs={[{ name: "Unfiled" }]}>
      <Section id="desk" title="On your desk" aside={`${waiting.length} to file`}>
        {waiting.length === 0 ? (
          <p className={styles.empty}>Everything is filed.</p>
        ) : (
          <ul className={styles.table} aria-label="Unfiled documents">
            <li className={`${styles.tableHead} ${styles.unfiled}`} aria-hidden="true">
              <span>Document</span>
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
                    <span>
                      <FileItButton paper={paper} choices={viewer.choices} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PaperworkScreen>
  );
}
