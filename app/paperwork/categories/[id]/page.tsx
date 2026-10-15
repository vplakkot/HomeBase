import { notFound } from "next/navigation";
import { categoryFileFolders, fileFolderRows } from "../../../../lib/paperwork/paperwork";
import { CategoryFileFolders } from "../../category-file-folders";
import { Fact, PaperworkScreen, Section, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";

// One category (REQ-105, REQ-204): its File Folders, documents and
// keep-until default, then every File Folder in it, whatever its place, each
// collapsed with its documents one tap away.
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" } = {}] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { fileFolders, papers, people, storage } = viewer;
  const category = viewer.categories.find((row) => row.id === id);
  if (!category) notFound();
  const inCategory = fileFolders.filter((fileFolder) => fileFolder.category_id === category.id);
  const rows = fileFolderRows(inCategory, [category], papers, viewer.drive);
  const items = categoryFileFolders(rows, papers, people, storage, viewer.locations, viewer.drive);
  const documents = rows.reduce((sum, row) => sum + row.count, 0);

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
          <Fact label="File Folders" value={inCategory.length} />
          <Fact label="Documents" value={documents} />
          {category.keep_years === null ? null : (
            <Fact label="Keep for" value={category.keep_years === 1 ? "1 year" : `${category.keep_years} years`} />
          )}
        </dl>
      </section>

      <Section id="file-folders" title="File Folders" aside={`${inCategory.length}`}>
        {items.length === 0 ? (
          <p className={styles.empty}>No File Folders in {category.name} yet.</p>
        ) : (
          <CategoryFileFolders items={items} categoryName={category.name} />
        )}
      </Section>
    </PaperworkScreen>
  );
}
