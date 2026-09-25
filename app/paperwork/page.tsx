import Link from "next/link";
import { places, unfiled, type PlaceCard } from "../../lib/paperwork/paperwork";
import { filesCount, itemsCount } from "./file-cards";
import { PaperworkScreen, paperworkViewer } from "./frame";
import styles from "./paperwork.module.css";

// Paperwork's first screen (REQ-100): the filing cabinet from the
// outside. A card per office location, then a card per storage box that
// holds archived files, and a banner while paperwork waits on the desk.
export default async function PaperworkPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await paperworkViewer();
  const { q = "" } = await searchParams;
  const { office, archived } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const waiting = unfiled(viewer.papers).length;

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork" query={q}>
      {waiting > 0 ? (
        <Link href="/paperwork/unfiled" className={styles.banner}>
          <DeskIcon />
          <span>{waiting} unfiled on your desk</span>
          File {waiting === 1 ? "it" : "them"} ›
        </Link>
      ) : null}
      <section className={styles.group} aria-labelledby="office">
        <h2 id="office" className={styles.groupTitle}>
          Where your files are
        </h2>
        {office.length === 0 ? (
          <p className={styles.empty}>No files yet. Log paperwork and choose New file… to make the first.</p>
        ) : (
          <Places cards={office} icon={<CabinetIcon />} />
        )}
      </section>
      {archived.length > 0 ? (
        <section className={styles.group} aria-labelledby="archived">
          <h2 id="archived" className={styles.groupTitle}>
            Archived in storage
          </h2>
          <Places cards={archived} icon={<BoxIcon />} />
        </section>
      ) : null}
    </PaperworkScreen>
  );
}

function Places({ cards, icon }: { cards: PlaceCard[]; icon: React.ReactNode }) {
  return (
    <ul className={styles.grid}>
      {cards.map((card) => (
        <li key={card.href}>
          <Link href={card.href} className={styles.card}>
            <span className={styles.cardIcon}>{icon}</span>
            <span className={styles.cardText}>
              <span className={styles.cardTitle}>{card.name}</span>
              <span className={styles.cardDetail}>
                {filesCount(card.files.length)} · {itemsCount(card.items)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const CabinetIcon = () => (
  <Svg>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 12h16M10 7.5h4M10 16.5h4" />
  </Svg>
);
const BoxIcon = () => (
  <Svg>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4M12 11v10" />
  </Svg>
);
const DeskIcon = () => (
  <Svg>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </Svg>
);
