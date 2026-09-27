import styles from "./restaurants.module.css";

// A place's photo from Google through our own address (photo/route.ts),
// or a plain block in the module colour when Google has none (REQ-129).
export function PlacePhoto({
  photo,
  width = 400,
  className,
}: {
  photo: { name: string; credit: string | null } | null;
  width?: 400 | 800;
  className?: string;
}) {
  if (!photo) return <span className={`${styles.photo} ${styles.noPhoto} ${className ?? ""}`} aria-hidden="true" />;
  return (
    <span className={`${styles.photoFrame} ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Google's own image link, not ours to optimise */}
      <img src={`/restaurants/photo?name=${encodeURIComponent(photo.name)}&w=${width}`} alt="" className={styles.photo} />
      {/* Google asks for the photographer's credit wherever the photo shows. */}
      {photo.credit ? <span className={styles.credit}>{photo.credit}</span> : null}
    </span>
  );
}
