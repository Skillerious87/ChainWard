"use client";

import Image from "next/image";
import { isNativeApp } from "@/lib/is-native-app";

interface PageLoadingCoreProps {
  title: string;
  hint: string;
}

/**
 * The full-page loading mark, shown on every in-app view switch (see
 * RouteProgress) as well as the view/workspace loading fallbacks that share
 * this same component. The web/desktop mark is one spinning ring around the
 * still brand chip; inside the Capacitor Android shell it's a small trio of
 * isometric cubes hopping in sequence instead - a purpose-built native
 * treatment, requested to be Android-only, that has no equivalent on the
 * marketing site or desktop browser tab. Both share the exact same title/hint
 * copy treatment below. IsometricLoader is intentionally NOT nested inside
 * page-loading-core__mark - that class carries a fixed 72x72px box sized for
 * the ring+chip, which silently broke the cubes' centering by constraining a
 * wider element into a box it didn't fit.
 */
export function PageLoadingCore({ title, hint }: PageLoadingCoreProps) {
  return (
    <div className="page-loading-core" role="status" aria-live="polite" aria-label={`${title}. ${hint}.`}>
      {isNativeApp() ? <IsometricLoader /> : (
        <div className="page-loading-core__mark" aria-hidden="true">
          <span className="page-loading-core__ring" />
          <span className="page-loading-core__chip">
            <Image src="/icons/android-chrome-192x192.png?v=2" alt="" width={48} height={48} priority />
          </span>
        </div>
      )}
      <div className="page-loading-core__copy">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

/**
 * Three isometric cubes hopping in a staggered wave, each with its own
 * ground shadow (scaling/fading opposite the hop - big and dark when
 * grounded, small and faint at the peak) and a brief glint sweep across the
 * top face. Real SVG polygons at exact 2:1 dimetric coordinates, not
 * `clip-path` on flat divs - clip-path shapes stacked under a `transform`
 * animation were the likely reason the previous version rendered as static,
 * un-animated boxes. Each cube is a plain HTML `<span>` animating its own
 * `transform`; the SVG inside it never animates anything itself, which
 * sidesteps any SVG-nested-transform composition risk entirely.
 */
function IsometricLoader() {
  return (
    <div className="iso-loader3d" aria-hidden="true">
      {[0, 1, 2].map((index) => {
        const delay = `${index * 0.16}s`;
        return (
          <span className="iso-cube-slot" key={index} style={{ animationDelay: delay }}>
            <i className="iso-cube-shadow" style={{ animationDelay: delay }} />
            <svg className="iso-cube-svg" viewBox="0 0 34 32" width="34" height="32">
              <polygon className="iso-face iso-face--right" points="17,17 34,8.5 34,23.5 17,32" />
              <polygon className="iso-face iso-face--left" points="0,8.5 17,17 17,32 0,23.5" />
              <polygon className="iso-face iso-face--top" points="17,0 34,8.5 17,17 0,8.5" />
              <polygon className="iso-face iso-face--glint" points="17,4.25 25.5,8.5 17,12.75 8.5,8.5" style={{ animationDelay: `${index * 0.16 + 0.25}s` }} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}
