import styles from "./restaurants.module.css";

// A place's photo from Google through our own address (photo/route.ts),
// or a plain block in the module colour when Google has none (REQ-129).
// Each photo Google hands out counts against the smallest free allowance
// (REQ-139), so a tile's small one loads only as it scrolls into view;
// the big one at the top of a place's page loads straight away.
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
      <img
        src={`/restaurants/photo?name=${encodeURIComponent(photo.name)}&w=${width}`}
        alt=""
        className={styles.photo}
        loading={width === 400 ? "lazy" : "eager"}
        decoding="async"
      />
      {/* Google asks for the photographer's credit wherever the photo shows. */}
      {photo.credit ? <span className={styles.credit}>{photo.credit}</span> : null}
    </span>
  );
}
