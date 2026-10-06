import { filesCount, fileRows, driveArchiveDocuments, DRIVE_ARCHIVE_HREF } from "../../../../lib/paperwork/paperwork";
import { DriveStatus } from "../../drive-forms";
import { DriveArchiveDocuments } from "../../drive-views";
import { FileCards } from "../../file-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";

// REQ-153's Drive half: Google Drive's archive. The Archived folder is
// the archive File, holding documents archived on their own; Drive Files
// archived whole sit in it as folders and are listed with it. It has
// nothing to manage: no rename, delete, archive, category or label.
export default async function DriveArchivePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const viewer = await paperworkViewer();
  const rows = fileRows(
    viewer.files.filter((file) => file.is_drive && file.status === "archived"),
    viewer.categories,
    viewer.papers,
    viewer.drive,
  );
  const loose = driveArchiveDocuments(viewer.drive);

  return (
    <PaperworkScreen viewer={viewer} here={DRIVE_ARCHIVE_HREF} query={q} crumbs={[{ name: "Google Drive · Archived" }]}>
      {viewer.drive.connection ? <DriveStatus syncedAt={viewer.drive.connection.synced_at} /> : null}
      <Section id="archived-files" title="Archived files" aside={filesCount(rows.length)}>
        {rows.length === 0 ? <p className={styles.empty}>No archived files in Google Drive.</p> : <FileCards rows={rows} />}
      </Section>
      <Section id="archived-documents" title="Archive · Google Drive" aside={`${loose.length}`}>
        <DriveArchiveDocuments viewer={viewer} documents={loose} />
      </Section>
    </PaperworkScreen>
  );
}
