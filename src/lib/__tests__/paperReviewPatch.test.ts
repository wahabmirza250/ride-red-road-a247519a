import { describe, expect, it } from "vitest";
import { patchPaperReview } from "../paperReviewPatch";

describe("paper bill review confirmations", () => {
  it.each([['identityReviewed', 'twoLegsVerified'], ['twoLegsVerified', 'identityReviewed']])("keeps both boxes selected in either order: %s then %s", (first, second) => {
    let draft = { identityReviewed: false, twoLegsVerified: false, l2p: "167615", l2d: "167629" };
    draft = patchPaperReview(draft, { [first]: true });
    draft = patchPaperReview(draft, { [second]: true });
    expect(draft.identityReviewed && draft.twoLegsVerified).toBe(true);
    expect(patchPaperReview(draft, {twoLegsVerified: false}).identityReviewed).toBe(true);
  });
  it("requires fresh review after changing trip details", () => {
    const draft = patchPaperReview({identityReviewed:true,twoLegsVerified:true,l2d:'167629'}, {l2d:'167630'});
    expect(draft).toEqual({identityReviewed:false,twoLegsVerified:false,l2d:'167630'});
  });
});
