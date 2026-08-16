import { PageLoadingCore } from "./page-loading-core";

type ViewLoadingVariant = "grid" | "table" | "console";

/**
 * The fallback a route shows while its server components resolve.
 *
 * It retains the shape of the incoming view to prevent layout jumps, then
 * centres the shared loading mark over that subdued structure.
 */
export function ViewLoading({ variant = "grid", title = "Loading view", hint = "Fetching verified Torn data" }: { variant?: ViewLoadingVariant; title?: string; hint?: string }) {
  return (
    <div className={`view-loading view-loading--${variant}`}>
      <div className="view-loading__surface" aria-hidden="true">
        <header className="view-loading__header">
          <div>
            <span className="view-loading__eyebrow skeleton-line" />
            <span className="view-loading__title skeleton-line" />
            <span className="view-loading__hint skeleton-line" />
          </div>
          <span className="view-loading__header-action skeleton-line" />
        </header>

        {variant !== "console" && (
          <div className="view-loading__stats">
            {[0, 1, 2, 3].map((index) => (
              <div key={index}>
                <span className="view-loading__chip skeleton-line" />
                <span className="view-loading__figure skeleton-line" />
                <span className="view-loading__note skeleton-line" />
              </div>
            ))}
          </div>
        )}

        {variant === "grid" && (
          <div className="view-loading__panels">
            <div className="view-loading__panel view-loading__panel--tall" />
            <div className="view-loading__panel" />
          </div>
        )}

        {variant === "table" && (
          <div className="view-loading__table">
            <div className="view-loading__toolbar">
              <span className="skeleton-line" />
              <span className="skeleton-line" />
            </div>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <div className="view-loading__row" key={index} style={{ opacity: 1 - index * 0.11 }}>
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-line" />
              </div>
            ))}
          </div>
        )}

        {variant === "console" && (
          <div className="view-loading__console">
            <div className="view-loading__rail">
              {[0, 1, 2, 3, 4].map((index) => <span className="skeleton-line" key={index} />)}
            </div>
            <div className="view-loading__stage">
              <span className="view-loading__stage-bar skeleton-line" />
              <div className="view-loading__panel view-loading__panel--tall" />
            </div>
          </div>
        )}
      </div>
      <div className="view-loading__centre"><PageLoadingCore title={title} hint={hint} /></div>
    </div>
  );
}
