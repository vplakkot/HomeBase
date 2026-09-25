import styles from "../../../components/cards.module.css";
import { Hint } from "../../../components/hint";
import { LockIcon } from "../../../components/icons";
import { CategoryForm, RemoveCategoryForm } from "../forms";
import { PaperworkScreen, paperworkViewer } from "../frame";

const SECTION = "Categories";

// REQ-88: the admin's Paperwork settings, behind the toolbar's settings
// button (REQ-100). Categories are the household's own, none built in,
// each with an optional default keep-until in years.
export default async function CategoriesPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const { q = "" } = (await searchParams) ?? {};
  const viewer = await paperworkViewer();
  const { canManagePaperwork, categories, files } = viewer;
  const screen = { viewer, here: "/paperwork/categories", query: q, crumbs: [{ name: SECTION }] };

  if (!canManagePaperwork) {
    return (
      <PaperworkScreen {...screen}>
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="locked">
            <header className={styles.head}>
              <h2 id="locked" className={styles.name}>
                {SECTION}
              </h2>
              <p className={styles.note}>
                <LockIcon />
                Admin only. An admin sets the categories.
              </p>
            </header>
          </section>
        </div>
      </PaperworkScreen>
    );
  }

  return (
    <PaperworkScreen {...screen}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="categories">
          <header className={styles.head}>
            <h2 id="categories" className={styles.name}>
              Categories
            </h2>
            <Hint text="Keep for is optional: paperwork filed under the category gets keep-until filled in that many years on." />
          </header>
          <div className={styles.addBlock}>
            <h3 className={styles.addTitle}>New category</h3>
            <CategoryForm />
          </div>
          <div className={styles.entries}>
            {categories.length === 0 ? (
              <p className={styles.empty}>No categories yet.</p>
            ) : (
              <ul className={styles.list}>
                {categories.map((category) => {
                  const inUse = files.filter((file) => file.category_id === category.id).length;
                  return (
                    <li key={category.id} className={styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>{category.name}</span>
                        <span className={styles.chip}>
                          {category.keep_years === null ? "No default" : `Keep ${category.keep_years} yr`}
                        </span>
                      </div>
                      <p className={styles.detail}>{inUse === 1 ? "1 file" : `${inUse} files`}</p>
                      <div className={styles.actions}>
                        <details className={styles.change}>
                          <summary>Edit</summary>
                          <CategoryForm category={category} />
                        </details>
                        <details className={styles.change}>
                          <summary>Remove</summary>
                          <RemoveCategoryForm
                            category={category}
                            others={categories.filter((other) => other.id !== category.id)}
                            inUse={inUse}
                          />
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </PaperworkScreen>
  );
}
