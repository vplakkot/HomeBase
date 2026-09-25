import Link from "next/link";
import { ButtonLink } from "../../components/button";
import { UNFILED_HREF, unfiledItem } from "../../lib/paperwork/action-items";
import { documentsCount, filesCount, places, type PlaceCard } from "../../lib/paperwork/paperwork";
import { Fact, PaperworkScreen, Section, paperworkViewer } from "./frame";
import styles from "./paperwork.module.css";

// Paperwork's Overview (REQ-100, DESIGN.md §11): the filing cabinet from
// the outside. Top to bottom: the action item while documents wait on the
// desk, a summary (locations · files · documents), a card per office
// location, then a card per storage box that holds archived files.
export default async function PaperworkPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await paperworkViewer();
  const { q = "" } = await searchParams;
  const { office, archived } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const item = unfiledItem(viewer.papers);

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork" query={q}>
      {item ? (
        <Section
          id="action-items"
          title={
            <>
              Action items <span className={styles.count}>1</span>
            </>
          }
        >
          <ul className={`${styles.card} ${styles.rows}`}>
            <li className={styles.itemRow}>
              <span className={styles.itemText}>
                <span className={styles.strong}>{item.text}</span>
                <span className={styles.note}>{item.detail}</span>
              </span>
              <ButtonLink href={UNFILED_HREF}>File it</ButtonLink>
            </li>
          </ul>
        </Section>
      ) : null}

      <section className={styles.card} aria-label="Summary">
        <dl className={styles.summary}>
          <Fact label="Locations" value={office.length + archived.length} />
          <Fact label="Files" value={viewer.files.length} />
          <Fact label="Documents" value={viewer.papers.length} />
        </dl>
      </section>

      <Section id="locations" title="Locations">
        {office.length === 0 ? (
          <p className={styles.empty}>No files yet. Log a document and choose New file… to make the first.</p>
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
            <span className={styles.cardTitle}>{card.name}</span>
            <span className={styles.cardDetail}>
              {filesCount(card.files.length)} · {documentsCount(card.items)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
