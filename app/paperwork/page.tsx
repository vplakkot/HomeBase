import Link from "next/link";
import { ButtonLink } from "../../components/button";
import { notPlacedItem, UNFILED_HREF, unfiledItem } from "../../lib/paperwork/action-items";
import { cardFileFolders, documentsCount, fileFoldersCount, places, type PlaceCard } from "../../lib/paperwork/paperwork";
import { DriveStatus } from "./drive-forms";
import { DriveUnfiledSection, UnlinkedFoldersSection } from "./drive-views";
import { Fact, PaperworkScreen, Section, paperworkViewer } from "./frame";
import styles from "./paperwork.module.css";
import { AddLocation } from "./sheets";
import band from "../../components/band.module.css";

// Paperwork's Overview (REQ-100, DESIGN.md §11): the filing cabinet from
// the outside. Top to bottom: the action item while documents wait on the
// desk, a summary (locations · File Folders · documents), a card per office
// location, then a card per storage box that holds archived File Folders.
export default async function PaperworkPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await paperworkViewer();
  const { q = "" } = await searchParams;
  const { office, archived, notPlaced } = places(
    viewer.fileFolders,
    viewer.categories,
    viewer.papers,
    viewer.storage,
    viewer.locations,
    viewer.archives,
    viewer.drive,
  );
  const item = unfiledItem(viewer.papers);
  const placing = notPlacedItem(viewer.fileFolders);

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork" query={q}>
      {item || placing ? (
        <Section
          id="action-items"
          title={
            <>
              Action items <span className={styles.count}>{(item ? 1 : 0) + (placing ? 1 : 0)}</span>
            </>
          }
        >
          <ul className={`${styles.card} ${styles.rows}`}>
            {item ? (
              <li className={styles.itemRow}>
                <span className={styles.itemText}>
                  <span className={`${styles.strong} ${band.band}`}>{item.text}</span>
                  <span className={styles.note}>{item.detail}</span>
                </span>
                <ButtonLink href={UNFILED_HREF}>File it</ButtonLink>
              </li>
            ) : null}
            {placing ? (
              <li className={styles.itemRow}>
                <span className={styles.itemText}>
                  <span className={`${styles.strong} ${band.band}`}>{placing.text}</span>
                  <span className={styles.note}>{placing.detail}</span>
                </span>
                <ButtonLink href={placing.href}>{placing.action}</ButtonLink>
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      <section className={styles.card} aria-label="Summary">
        <dl className={styles.summary}>
          <Fact label="Locations" value={office.length + archived.length} />
          <Fact label="File Folders" value={viewer.fileFolders.length + viewer.archives.length} />
          <Fact
            label="Documents"
            value={viewer.papers.length + viewer.drive.documents.filter((document) => !document.missing).length}
          />
        </dl>
      </section>

      {viewer.drive.connection ? <DriveStatus syncedAt={viewer.drive.connection.synced_at} /> : null}

      <DriveUnfiledSection viewer={viewer} />
      <UnlinkedFoldersSection viewer={viewer} />

      {notPlaced ? (
        <Section id="not-placed" title="Not placed">
          <Places cards={[notPlaced]} />
        </Section>
      ) : null}

      <Section id="locations" title="Locations" action={<AddLocation />}>
        {office.length === 0 ? (
          <p className={styles.empty}>No locations yet. Add one, then make a File Folder in it.</p>
        ) : (
          <Places cards={office} />
        )}
      </Section>

      {archived.length > 0 ? (
        <Section id="archived" title="Archived in storage">
          <Places cards={archived} />
        </Section>
      ) : null}
    </PaperworkScreen>
  );
}

function Places({ cards }: { cards: PlaceCard[] }) {
  return (
    <ul className={styles.grid}>
      {cards.map((card) => (
        <li key={card.href}>
          <Link href={card.href} className={styles.linkCard}>
            <span className={`${styles.cardTitle} ${band.band}`}>{card.name}</span>
            <span className={styles.cardDetail}>
              {fileFoldersCount(cardFileFolders(card))} · {documentsCount(card.items)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
