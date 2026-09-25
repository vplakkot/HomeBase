import Link from "next/link";
import { notFound } from "next/navigation";
import { documentsByYear, fileId, ownerName, placeOf } from "../../../../lib/paperwork/paperwork";
import { Fact, PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";

// One category (REQ-105): its files, documents and keep-until default,
// then every document in it, whatever file or place it's in, by the year
// of its document date, newest first. A year with nothing between the
// oldest and the newest reads "Nothing logged for [year]" in the module
// colour, so a missing year's taxes stand out; undated documents go last.
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" } = {}] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { files, papers, people, storage } = viewer;
  const category = viewer.categories.find((row) => row.id === id);
  if (!category) notFound();
  const inCategory = files.filter((file) => file.category_id === category.id);
  const documents = papers.filter((paper) => inCategory.some((file) => file.id === paper.file_id));
  const years = documentsByYear(documents);
  const fileOf = (fileIdOf: string | null) => inCategory.find((file) => file.id === fileIdOf)!;

  return (
    <PaperworkScreen
      viewer={viewer}
      here={`/paperwork/categories/${category.id}`}
      query={q}
      tab="Categories"
      crumbs={[{ name: "Categories", href: "/paperwork/categories" }, { name: category.name }]}
    >
      <section className={styles.card} aria-label={`${category.name} summary`}>
        <dl className={styles.summary}>
          <Fact label="Files" value={inCategory.length} />
          <Fact label="Documents" value={documents.length} />
          {category.keep_years === null ? null : (
            <Fact label="Keep for" value={category.keep_years === 1 ? "1 year" : `${category.keep_years} years`} />
          )}
        </dl>
      </section>

      <Section id="by-year" title="Documents by year" aside="Newest first">
        {years.length === 0 ? (
          <p className={styles.empty}>No documents in {category.name} yet.</p>
        ) : (
          <ul className={`${styles.card} ${styles.rows}`}>
            <li className={`${styles.tableHead} ${styles.yearHead}`} aria-hidden="true">
              <span>Year</span>
              <span>
                <span>Document</span>
                <span>Owner</span>
                <span>File · location</span>
              </span>
            </li>
            {years.map(({ year, papers: inYear }) =>
              inYear.length === 0 ? (
                <li key={year} className={`${styles.yearRow} ${styles.gap}`}>
                  <span className={styles.year}>{year}</span>
                  <span className={styles.rowCell}>Nothing logged for {year}</span>
                </li>
              ) : (
                <li key={year ?? "none"} className={styles.yearRow}>
                  <span className={styles.year}>{year ?? "No date"}</span>
                  <ul className={styles.yearDocs}>
                    {inYear.map((paper) => {
                      const file = fileOf(paper.file_id);
                      return (
                        <li key={paper.id}>
                          <Link href={`/paperwork/items/${paper.id}`} className={styles.doc}>
                            <span className={styles.rowName}>{paper.name}</span>
                            <span className={styles.rowCell}>{ownerName(paper, people)}</span>
                            <span className={styles.rowCell}>
                              {fileId(file)} · {placeOf(file, storage).name}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>
    </PaperworkScreen>
  );
}
