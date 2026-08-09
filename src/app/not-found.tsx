import { ArrowLeft, Compass } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <Link href="/dashboard" aria-label="Chainward command centre"><BrandMark /></Link>
      <section>
        <span><Compass size={26} /></span>
        <p className="eyebrow">Route not found</p>
        <h1>This operation does not exist.</h1>
        <p>The address may be incomplete, or the chain record is no longer available from this route.</p>
        <Link className="button button--primary" href="/dashboard"><ArrowLeft size={15} /> Return to command centre</Link>
      </section>
    </main>
  );
}
