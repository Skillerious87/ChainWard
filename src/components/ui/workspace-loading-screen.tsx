import { PageLoadingCore } from "./page-loading-core";

interface WorkspaceLoadingScreenProps {
  className?: string;
  title?: string;
  hint?: string;
}

/**
 * A document-level handoff used while the protected shell is being assembled.
 * Keeping this identical on both sides of login prevents a blank frame or a
 * visual jump while the fresh authenticated document request resolves.
 */
export function WorkspaceLoadingScreen({
  className,
  title = "Opening secure workspace",
  hint = "Verifying your session and assembling the command centre",
}: WorkspaceLoadingScreenProps) {
  return (
    <div className={`workspace-loading-screen${className ? ` ${className}` : ""}`}>
      <span className="workspace-loading-screen__grid" aria-hidden="true" />
      <span className="workspace-loading-screen__halo" aria-hidden="true" />
      <div className="workspace-loading-screen__content">
        <PageLoadingCore title={title} hint={hint} />
        <p className="workspace-loading-screen__assurance"><i /> Secure session handoff</p>
      </div>
    </div>
  );
}
