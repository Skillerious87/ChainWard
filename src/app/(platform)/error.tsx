"use client";

import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function PlatformError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="route-error" role="alert">
      <span className="route-error__icon"><ShieldAlert size={24} /></span>
      <p className="eyebrow">Safe recovery mode</p>
      <h1>This workspace view could not be completed.</h1>
      <p>No operation was applied. Retry the verified read, or return to the command centre.</p>
      {error.digest && <code>Reference {error.digest}</code>}
      <div>
        <button className="button button--primary" onClick={retry}><RefreshCw size={15} /> Try again</button>
        <Link className="button button--secondary" href="/dashboard"><ArrowLeft size={15} /> Command centre</Link>
      </div>
    </section>
  );
}
