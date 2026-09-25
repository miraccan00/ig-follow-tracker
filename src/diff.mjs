// Pure functions: compare two snapshots. Kept free of I/O so they are easy to test.

const byId = (list) => new Map(list.map((u) => [u.id, u]));

function setDiff(a, b) {
  const bIds = byId(b);
  return a.filter((u) => !bIds.has(u.id));
}

export function diffSnapshots(prev, curr) {
  return {
    from: prev.takenAt,
    to: curr.takenAt,
    counts: {
      followers: { before: prev.followers.length, after: curr.followers.length, delta: curr.followers.length - prev.followers.length },
      following: { before: prev.following.length, after: curr.following.length, delta: curr.following.length - prev.following.length },
    },
    // In prev.followers but not in curr.followers: they unfollowed you (or were removed / deactivated).
    unfollowedYou: setDiff(prev.followers, curr.followers),
    newFollowers: setDiff(curr.followers, prev.followers),
    youUnfollowed: setDiff(prev.following, curr.following),
    youStartedFollowing: setDiff(curr.following, prev.following),
  };
}

// Accounts you follow that don't follow you back (single snapshot).
export function notFollowingBack(snap) {
  return setDiff(snap.following, snap.followers);
}
