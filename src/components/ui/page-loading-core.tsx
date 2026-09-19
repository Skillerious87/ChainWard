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
 * isometric cubes bouncing in sequence instead - a purpose-built native
 * treatment, requested to be Android-only, that has no equivalent on the
 * marketing site or desktop browser tab. Both share the exact same title/hint
 * copy treatment below.
 */
export function PageLoadingCore({ title, hint }: PageLoadingCoreProps) {
  return (
    <div className="page-loading-core" role="status" aria-live="polite" aria-label={`${title}. ${hint}.`}>
      {isNativeApp() ? (
        <div className="page-loading-core__mark page-loading-core__mark--iso" aria-hidden="true">
          <IsometricLoader />
        </div>
      ) : (
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
 * Three flat-shaded isometric cubes bouncing in a staggered wave - each face
 * is a `clip-path` polygon on a plain div, using the same 2:1 dimetric
 * projection (top/left/right faces) as the rest of the app's isometric
 * artwork, not a CSS skew trick or 3D perspective transform (both render
 * inconsistently across WebView versions at this size).
 */
function IsometricLoader() {
  return (
    <div className="iso-loader">
      {[0, 1, 2].map((index) => (
        <span className="iso-loader__cube" key={index} style={{ animationDelay: `${index * 0.15}s` }}>
          <i className="iso-loader__face iso-loader__face--top" />
          <i className="iso-loader__face iso-loader__face--left" />
          <i className="iso-loader__face iso-loader__face--right" />
        </span>
      ))}
    </div>
  );
}
