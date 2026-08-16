/**
 * Workspace appearance lives in localStorage, which server rendering cannot
 * read. Without this the first paint always uses the default accent and an
 * expanded sidebar, then snaps to the saved layout once React hydrates. Running
 * the same reconciliation synchronously before first paint removes that jump.
 *
 * Keep the applied properties in sync with `applyAppearancePreferences`.
 */
const bootScript = `(function(){try{
var p=JSON.parse(localStorage.getItem("chainward:appearance:v1")||"null")||{};
var r=document.documentElement;
var accents=["#91e653","#59c7f3","#f0b85a","#b58cff","#f07178"];
var accent=accents.indexOf(p.accent)>=0?p.accent:accents[0];
var n=parseInt(accent.slice(1),16);
var rgb=((n>>16)&255)+", "+((n>>8)&255)+", "+(n&255);
r.style.setProperty("--accent",accent);
r.style.setProperty("--accent-strong",accent);
r.style.setProperty("--accent-rgb",rgb);
r.style.setProperty("--accent-soft","rgba("+rgb+", 0.1)");
r.classList.toggle("density-compact",p.compact===true);
r.classList.toggle("high-contrast",p.highContrast===true);
r.classList.toggle("reduced-motion",p.reducedEffects===true);
r.dataset.sidebar=p.sidebarCollapsed===true?"collapsed":"expanded";
}catch(e){}})();`;

export function AppearanceBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: bootScript }} />;
}
