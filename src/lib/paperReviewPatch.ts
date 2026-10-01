type ReviewFlags = { identityReviewed?: boolean; twoLegsVerified?: boolean };

export function patchPaperReview<T extends ReviewFlags>(current: T, next: Partial<T>): T {
  const onlyReviewFlags = Object.keys(next).every(key => key === "identityReviewed" || key === "twoLegsVerified");
  return {
    ...current,
    ...(!onlyReviewFlags ? { identityReviewed: false, twoLegsVerified: false } : {}),
    ...next,
  };
}
