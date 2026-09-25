import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { householdToday, listPeople } from "../../lib/finances/budget-year";
import {
  documentsCount,
  fileId,
  fileRows,
  filesCount,
  labelText,
  officeLocations,
  placeOf,
  readPaperwork,
  search,
} from "../../lib/paperwork/paperwork";
import { readStorage } from "../../lib/storage/storage";
import { createClient } from "../../lib/supabase/server";
import styles from "./paperwork.module.css";
import { HeaderTools } from "./sheets";

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

// Every Paperwork screen (REQ-100, DESIGN.md §11): the module header
// with the one search, the settings gear (admin) and Log document; the
// tabs, Overview, Unfiled and Categories, with `tab` the one you're under
// (Settings highlights none); and a breadcrumb below the top level. With
// a search typed, the results take the screen's place; clearing it
// brings the screen back.
export function PaperworkScreen({
  viewer,
  here,
  query,
  tab,
  crumbs = [],
  children,
}: {
  viewer: PaperworkViewer;
  here: string;
  query: string;
  tab?: "Unfiled" | "Categories" | "Settings";
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const searching = query.trim() !== "";
  const trail: Crumb[] = searching
    ? [{ name: "Paperwork", href: "/paperwork" }, { name: `Results for “${query.trim()}”` }]
    : [{ name: "Paperwork", href: "/paperwork" }, ...crumbs];
  return (
    <ModuleFrame
      slug="paperwork"
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      section={tab}
      context={tab === "Settings" ? "Settings" : undefined}
      actions={<HeaderTools here={here} query={query} choices={viewer.choices} settings={viewer.canManagePaperwork} />}
    >
      <div className={styles.screen}>
        {/* Below the top level only: there it would just say Paperwork. */}
        {trail.length > 1 ? (
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
        ) : null}
        {searching ? <SearchResults viewer={viewer} query={query} /> : children}
      </div>
    </ModuleFrame>
  );
}

// A section of a Paperwork screen: its heading above, with a count or
// note and any button on the right, then whatever it holds.
export function Section({
  id,
  title,
  aside,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  aside?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {aside ? <span className={styles.count}>{aside}</span> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

// One number in a summary card: "Files", 16.
export function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

// REQ-100's search: files by ID, label name or category, and documents by
// name, grouped. Each document says which file it's in and where that is.
function SearchResults({ viewer, query }: { viewer: PaperworkViewer; query: string }) {
  const { files, categories, papers, storage } = viewer;
  const found = search(fileRows(files, categories, papers), papers, query, null);
  const fileOf = (id: string | null) => files.find((file) => file.id === id);
  return (
    <>
      <Section id="found-files" title="Files" aside={filesCount(found.files.length)}>
        {found.files.length === 0 ? (
          <p className={styles.empty}>No files match.</p>
        ) : (
          <ul className={styles.grid}>
            {found.files.map(({ file, category, count }) => (
              <li key={file.id}>
                <Link href={`/paperwork/files/${file.id}`} className={styles.linkCard}>
                  <span className={styles.cardTitle}>{labelText(file, category)}</span>
                  <span className={styles.cardDetail}>
                    {[file.label, placeOf(file, storage).name, documentsCount(count)].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="found-documents" title="Documents" aside={documentsCount(found.papers.length)}>
        {found.papers.length === 0 ? (
          <p className={styles.empty}>No documents match.</p>
        ) : (
          <ul className={styles.table}>
            <li className={`${styles.tableHead} ${styles.found}`} aria-hidden="true">
              <span>Document</span>
              <span>File</span>
              <span>Where</span>
            </li>
            {found.papers.map((paper) => {
              const file = fileOf(paper.file_id);
              return (
                <li key={paper.id}>
                  <Link href={`/paperwork/items/${paper.id}`} className={`${styles.row} ${styles.found}`}>
                    <span className={styles.rowName}>{paper.name}</span>
                    <span className={styles.rowCell}>{file ? fileId(file) : "Unfiled"}</span>
                    <span className={styles.rowCell}>{file ? placeOf(file, storage).name : "Your desk"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
