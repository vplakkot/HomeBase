import Link from "next/link";
import { categoryCards, documentsCount, filesCount } from "../../../lib/paperwork/paperwork";
import { PaperworkScreen, Section, paperworkViewer } from "../frame";
import styles from "../paperwork.module.css";

// The Categories tab (REQ-105): one card per category with its files and
// documents, for everyone. Managing categories is the admin's, behind the
// settings gear (REQ-88).
export default async function CategoriesPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const { q = "" } = (await searchParams) ?? {};
  const viewer = await paperworkViewer();
  const cards = categoryCards(viewer.categories, viewer.files, viewer.papers);

  return (
    <PaperworkScreen viewer={viewer} here="/paperwork/categories" query={q} tab="Categories">
      <Section
        id="categories"
        title="Categories"
        aside={cards.length === 1 ? "1 category" : `${cards.length} categories`}
      >
        {cards.length === 0 ? (
          <p className={styles.empty}>
            No categories yet. {viewer.canManagePaperwork ? "Add them in Paperwork settings." : "An admin sets them."}
          </p>
        ) : (
          <ul className={styles.grid}>
            {cards.map(({ category, files, documents }) => (
              <li key={category.id}>
                <Link href={`/paperwork/categories/${category.id}`} className={styles.linkCard}>
                  <span className={styles.cardTitle}>{category.name}</span>
                  <span className={styles.cardDetail}>
                    {filesCount(files)} · {documentsCount(documents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PaperworkScreen>
  );
}
