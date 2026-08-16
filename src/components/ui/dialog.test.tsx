import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("gives the native dialog an accessible name and description", () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        title="Restore workspace?"
        description="Review the selected backup before continuing."
        confirmLabel="Restore"
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}">Restore workspace?</h2>`);
    expect(html).toContain(`<p id="${describedBy}">Review the selected backup before continuing.</p>`);
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });

  it("does not reference a missing description", () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        title="Confirm action"
        confirmLabel="Continue"
        hideCancel
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).not.toContain("aria-describedby");
  });
});
