import { Spinner } from "./spinner";

/** Suspense removes this as soon as its content resolves. No overlay or delay. */
export function PageSpinner({ label = "Loading page", fullPage = false }: { label?: string; fullPage?: boolean }) {
  return <div className={`page-spinner${fullPage ? " page-spinner--document" : ""}`}><Spinner size={28} label={label} /></div>;
}
