/**
 * Order the offline providers draw in.
 *
 * Both offline paths used to hand out a fixed sequence: solo practice ran the
 * lessons in the order they were written, and an unpinned round always opened
 * on the head of the catalog. In a classroom that is one sequence the whole
 * room memorises — the second session teaches nothing the first did not, and
 * the neighbour's screen is a spoiler rather than a distraction.
 *
 * Shuffling is the whole fix. Nothing here needs to be unpredictable to an
 * adversary, only different from last time, so `Math.random` is enough and a
 * seeded generator would only add a knob nobody turns.
 */

/** A copy of `items` in random order. Fisher–Yates, so every order is equally likely. */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const held = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = held;
  }
  return copy;
}

/**
 * A fresh shuffle that will not deal `avoid` first.
 *
 * Drawing from a bag and reshuffling when it empties gives every item a turn
 * before any item gets a second one — except across the seam, where an
 * independent shuffle can hand back the item just played. One round repeated
 * back to back is the single case a player reads as "it is not shuffling", so
 * the offending item is moved to the end rather than left where it fell.
 */
export function reshuffledAfter<T>(items: readonly T[], avoid: T | undefined): T[] {
  const bag = shuffled(items);
  if (bag.length > 1 && bag[0] === avoid) {
    bag.push(bag.shift() as T);
  }
  return bag;
}
