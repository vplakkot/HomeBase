"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "../../components/button";
import { documentsCount, fileFolderId, type CategoryFileFolder } from "../../lib/paperwork/paperwork";
import styles from "./paperwork.module.css";
import band from "../../components/band.module.css";

// REQ-204: a category's File Folders, every one collapsed to start. Tapping
// the ID or label name opens the File Folder; Expand lists its documents
// under it, and Collapse hides them again.
export function CategoryFileFolders({ items, categoryName }: { items: CategoryFileFolder[]; categoryName: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <ul className={styles.folderList} aria-label={`${categoryName} File Folders`}>
      {items.map(({ row, place, archived, documents }) => {
        const { fileFolder } = row;
        const expanded = open.has(fileFolder.id);
        const listId = `docs-${fileFolder.id}`;
        return (
          <li key={fileFolder.id} className={styles.folderItem}>
            <div className={styles.folderHead}>
              <Link href={`/paperwork/file-folders/${fileFolder.id}`} className={styles.folderTitle}>
                <span className={`${styles.rowName} ${band.band}`}>{fileFolderId(fileFolder)}</span>
                {fileFolder.label ? <span>{fileFolder.label}</span> : <span className={styles.noLabel}>No label</span>}
              </Link>
              <span className={styles.folderMeta}>
                {archived ? <span>Archived</span> : null}
                <span>{place.name}</span>
                <span>{documentsCount(row.count)}</span>
              </span>
              <button
                type="button"
                className={buttonClass}
                aria-expanded={expanded}
                aria-controls={listId}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${fileFolderId(fileFolder)}`}
                onClick={() => toggle(fileFolder.id)}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            </div>
            {expanded ? (
              <ul id={listId} className={styles.folderDocs} aria-label={`Documents in ${fileFolderId(fileFolder)}`}>
                {documents.length === 0 ? (
                  <li>
                    <p className={styles.empty}>No documents in it yet.</p>
                  </li>
                ) : (
                  documents.map((document) => (
                    <li key={document.key}>
                      <Link
                        href={document.href}
                        className={`${styles.row} ${styles.items}`}
                        {...(document.external ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        <span className={`${styles.rowName} ${band.band}`}>{document.name}</span>
                        <span className={styles.rowCell}>{document.owner}</span>
                        <span className={styles.rowCell}>
                          {document.documentDate ? `Dated ${document.documentDate}` : "No date"}
                        </span>
                        <span className={styles.rowCell}>{document.keepUntil ? `Keep until ${document.keepUntil}` : "Keep"}</span>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
