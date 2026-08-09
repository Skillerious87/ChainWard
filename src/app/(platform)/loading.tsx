export default function PlatformLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading verified workspace data</span>
      <div className="route-loading__header">
        <i className="skeleton skeleton--eyebrow" />
        <i className="skeleton skeleton--title" />
        <i className="skeleton skeleton--copy" />
      </div>
      <div className="route-loading__hero skeleton" />
      <div className="route-loading__grid">
        {Array.from({ length: 4 }, (_, index) => <i className="skeleton" key={index} />)}
      </div>
      <div className="route-loading__panel skeleton" />
    </div>
  );
}
