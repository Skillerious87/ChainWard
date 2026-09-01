"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="global-error-page">
          <section className="route-error" role="alert">
            <span className="route-error__icon"><ShieldAlert size={24} /></span>
            <p className="eyebrow">Protected recovery</p>
            <h1>Chainward could not open safely.</h1>
            <p>No operation was applied. Retry the page, or return to the public home screen and reconnect.</p>
            {error.digest && <code>Reference {error.digest}</code>}
            <div>
              <button type="button" className="button button--primary" onClick={retry}><RefreshCw size={15} /> Try again</button>
              <Link className="button button--secondary" href="/">Return home</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
