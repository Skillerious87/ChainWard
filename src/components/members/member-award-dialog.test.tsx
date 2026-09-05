import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MEMBER_BADGES } from "@/lib/members/member-badges";
import type { MemberAward } from "@/lib/members/member-profile-store";

vi.mock("@/app/(platform)/members/actions", () => ({ addMemberAward: vi.fn() }));
import { MemberAwardDialog } from "./member-award-dialog";
import { MemberAwardCard } from "./member-award-card";

const award: MemberAward = {
  id: "award-1", tornUserId: 123, memberName: "Member", badgeId: "CHAIN_SENTINEL",
  citation: "Protected the final chain window with a careful handover.",
  awardedAt: "2026-09-05T12:00:00.000Z", awardedByName: "Manager", awardedByTornUserId: 456,
  revokedAt: null, revokedByName: null, revokedByTornUserId: null, revokeReason: null,
};

function render(awards: MemberAward[] = []) {
  return renderToStaticMarkup(<MemberAwardDialog member={{ name: "Member", tornId: 123 }} factionId={999} awards={awards} onClose={() => {}} onSaved={() => {}} />);
}

describe("award presentation", () => {
  it("offers the full catalogue and labelled citation with a recipient preview", () => {
    const html = render();
    expect(html.match(/type="radio"/g)).toHaveLength(MEMBER_BADGES.length);
    expect(html).toContain('aria-label="Search distinctions"');
    expect(html).toContain('aria-label="Award preview"');
    expect(html).toContain("Presented to");
    expect(html).toContain("TORN ID 123");
    expect(html).toContain('maxLength="600"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Award Chain Sentinel<\/button>/);
  });

  it("disables active awards and selects an available distinction instead", () => {
    const html = render([award]);
    const sentinel = html.match(/<input[^>]*value="CHAIN_SENTINEL"[^>]*>/)?.[0];
    expect(sentinel).toContain('disabled=""');
    expect(sentinel).not.toContain('checked=""');
    expect(html).toContain("Already on this member&#x27;s record");
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="VANGUARD"/);
  });

  it("allows a revoked distinction to be earned again", () => {
    const html = render([{ ...award, revokedAt: "2026-09-06T12:00:00.000Z" }]);
    const sentinel = html.match(/<input[^>]*value="CHAIN_SENTINEL"[^>]*>/)?.[0];
    expect(sentinel).toContain('checked=""');
    expect(sentinel).not.toContain('disabled=""');
  });

  it("explains when the member already holds every available distinction", () => {
    const html = render(MEMBER_BADGES.map((badge) => ({ ...award, id: badge.id, badgeId: badge.id })));
    expect(html).toContain("already holds every available distinction");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>All distinctions awarded<\/button>/);
    expect((html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).every((input) => input.includes('disabled=""'))).toBe(true);
  });

  it("displays safely escaped citations and attribution without management controls for viewers", () => {
    const html = renderToStaticMarkup(<MemberAwardCard award={{ ...award, citation: "Helped <script>alert('unsafe')</script>" }} canManage={false} onRevoke={() => {}} />);
    expect(html).toContain("Chain Sentinel");
    expect(html).toContain("Manager");
    expect(html).toContain("5 Sept 2026");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Revoke");
  });
});
