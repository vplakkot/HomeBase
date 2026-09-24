import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { householdToday, listPeople } from "../../lib/finances/budget-year";
import {
  fileRows,
  labelText,
  officeLocations,
  placeOf,
  readPaperwork,
  search,
} from "../../lib/paperwork/paperwork";
import { readStorage } from "../../lib/storage/storage";
import { createClient } from "../../lib/supabase/server";
import styles from "./paperwork.module.css";
import { Toolbar } from "./sheets";

// Who is looking at a Paperwork page, what they may do there, and
// everything Paperwork holds, with Storage's entries for the boxes files
// are archived in (REQ-98). Signed-out visitors go to sign-in.
export async function paperworkViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, canManagePaperwork, account, people, paperwork, storage] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "manage_paperwork"),
    readAccount(data.claims),
    listPeople(supabase),
    readPaperwork(supabase),
    readStorage(supabase),
  ]);
  const choices = {
    people,
    files: paperwork.files,
    categories: paperwork.categories,
    locations: officeLocations(paperwork.files),
    today: householdToday(),
  };
  return { canManageMembers, canManagePaperwork, account, people, ...paperwork, storage, choices };
}

export type PaperworkViewer = Awaited<ReturnType<typeof paperworkViewer>>;

// One step of the breadcrumb: a place above, with its link, or (the last,
// with none) the screen you're on.
export type Crumb = { name: string; href?: string };

// Every Paperwork screen (REQ-100): the module's header, the toolbar with
// the one search, and a breadcrumb below the top level. With a search
// typed, the results take the screen's place; clearing it brings the
// screen back.
export function PaperworkScreen({
  viewer,
  here,
  query,
  crumbs = [],
  children,
}: {
  viewer: PaperworkViewer;
  here: string;
  query: string;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const searching = query.trim() !== "";
  const trail: Crumb[] = searching
    ? [{ name: "Paperwork", href: "/paperwork" }, { name: `Results for “${query.trim()}”` }]
    : crumbs.length > 0
      ? [{ name: "Paperwork", href: "/paperwork" }, ...crumbs]
      : [{ name: "Paperwork" }];
  return (
    <ModuleFrame
      slug="paperwork"
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      section={trail.at(-1)?.name === "Paperwork" ? undefined : trail.at(-1)?.name}
    >
      <div className={styles.screen}>
        <Toolbar
          here={here}
          query={query}
          canManagePaperwork={viewer.canManagePaperwork}
          choices={viewer.choices}
        />
        <nav aria-label="Breadcrumb">
          <ol className={styles.crumbs}>
            {trail.map((crumb, index) => (
              <li key={`${crumb.name}-${index}`}>
                {index > 0 ? <span aria-hidden="true">› </span> : null}
                {crumb.href && index < trail.length - 1 ? (
                  <Link href={crumb.href}>{crumb.name}</Link>
                ) : (
                  <span aria-current="page">{crumb.name}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {searching ? <SearchResults viewer={viewer} query={query} /> : children}
      </div>
    </ModuleFrame>
  );
}

// REQ-100's search: files by ID, label name or category, and paperwork by
// name, grouped. Each paper says which file it's in and where that is.
function SearchResults({ viewer, query }: { viewer: PaperworkViewer; query: string }) {
  const { files, categories, papers, storage } = viewer;
  const found = search(fileRows(files, categories, papers), papers, query, null);
  const fileOf = (id: string | null) => files.find((file) => file.id === id);
  const categoryOf = (id: string) => categories.find((row) => row.id === id);
  return (
    <>
      <section className={styles.group} aria-labelledby="found-files">
        <h2 id="found-files" className={styles.groupTitle}>
          Files · {found.files.length}
        </h2>
        {found.files.length === 0 ? (
          <p className={styles.empty}>No files match.</p>
        ) : (
          <ul className={styles.grid}>
            {found.files.map(({ file, category, count }) => (
              <li key={file.id}>
                <Link href={`/paperwork/files/${file.id}`} className={styles.card}>
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>{labelText(file, category)}</span>
                    <span className={styles.cardDetail}>
                      {[file.label, placeOf(file, storage).name, count === 1 ? "1 item" : `${count} items`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.group} aria-labelledby="found-paperwork">
        <h2 id="found-paperwork" className={styles.groupTitle}>
          Paperwork · {found.papers.length}
        </h2>
        {found.papers.length === 0 ? (
          <p className={styles.empty}>No paperwork matches.</p>
        ) : (
          <ul className={styles.table}>
            <li className={`${styles.tableHead} ${styles.found}`} aria-hidden="true">
              <span>Paperwork</span>
              <span>In file</span>
              <span>Where</span>
            </li>
            {found.papers.map((paper) => {
              const file = fileOf(paper.file_id);
              return (
                <li key={paper.id}>
                  <Link href={`/paperwork/items/${paper.id}`} className={`${styles.row} ${styles.found}`}>
                    <span className={styles.rowName}>{paper.name}</span>
                    <span className={styles.rowCell}>
                      {file ? labelText(file, categoryOf(file.category_id)) : "Unfiled"}
                    </span>
                    <span className={styles.rowCell}>{file ? placeOf(file, storage).name : "Your desk"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
