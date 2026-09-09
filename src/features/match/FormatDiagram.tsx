/**
 * A round format, drawn.
 *
 * "Crews", "Co-op" and "Two weakest" are three words that do not explain
 * themselves, and a host picks between them in front of a waiting room. So the
 * picture is the rule rather than an ornament beside it: every diagram uses one
 * vocabulary — a player is a bar, its height is their score, and gold is what
 * counts toward the result. Once that reads, all five choices read.
 *
 * Bars rather than figures because the subject is already a lattice: the hair
 * is a grid of cubes and the workbench is full of them, so a column of squares
 * is the app's own handwriting rather than an icon set borrowed from elsewhere.
 */

/** One player, as a share of the diagram's height. Stable across all diagrams. */
const PLAYERS: readonly number[] = [0.86, 0.55, 1, 0.34, 0.68];

const WIDTH = 76;
const HEIGHT = 34;
const BAR = 9;
const GAP = 5;
/** Leaves room under the bars for a crew rule or a target line. */
const FLOOR = 28;

function barX(index: number): number {
  const total = PLAYERS.length * BAR + (PLAYERS.length - 1) * GAP;
  return (WIDTH - total) / 2 + index * (BAR + GAP);
}

function Bars({ counts }: { counts: (index: number) => boolean }) {
  return (
    <>
      {PLAYERS.map((share, index) => {
        const height = Math.round(share * 20) + 4;
        return (
          <rect
            key={index}
            className={counts(index) ? 'is-counted' : ''}
            x={barX(index)}
            y={FLOOR - height}
            width={BAR}
            height={height}
            rx={1.5}
          />
        );
      })}
    </>
  );
}

/** Individual standings: the tallest bar is the whole answer. */
export function SoloDiagram() {
  const best = PLAYERS.indexOf(Math.max(...PLAYERS));
  return (
    <svg className="format-diagram" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <Bars counts={(index) => index === best} />
    </svg>
  );
}

/** Crews: the same players, bracketed into groups, and a group wins. */
export function CrewsDiagram() {
  const split = 3;
  const left = PLAYERS.slice(0, split).reduce((sum, share) => sum + share, 0);
  const winningIsLeft = left > PLAYERS.slice(split).reduce((sum, share) => sum + share, 0);

  const rule = (from: number, to: number, winning: boolean) => (
    <line
      className={winning ? 'is-counted' : ''}
      x1={barX(from)}
      y1={FLOOR + 3.5}
      x2={barX(to) + BAR}
      y2={FLOOR + 3.5}
      strokeWidth={2}
      strokeLinecap="round"
    />
  );

  return (
    <svg className="format-diagram" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <Bars counts={(index) => (index < split) === winningIsLeft} />
      {rule(0, split - 1, winningIsLeft)}
      {rule(split, PLAYERS.length - 1, !winningIsLeft)}
    </svg>
  );
}

/** Co-op: a line everybody has to clear, so the shortest bar is the answer. */
export function CoopDiagram() {
  const lowest = PLAYERS.indexOf(Math.min(...PLAYERS));
  const line = FLOOR - (Math.round(Math.min(...PLAYERS) * 20) + 4) - 2;
  return (
    <svg className="format-diagram" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <Bars counts={(index) => index === lowest} />
      <line
        className="format-diagram__bar-line"
        x1={4}
        y1={line}
        x2={WIDTH - 4}
        y2={line}
        strokeWidth={1.5}
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Every member counts toward the crew's number. */
export function SumDiagram() {
  return (
    <svg className="format-diagram" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <Bars counts={() => true} />
    </svg>
  );
}

/**
 * Only the two lowest count.
 *
 * The one rule in the set that people read backwards, so the diagram states it
 * plainly: the tall bar is dimmed, which is exactly what the rule does to it.
 */
export function WeakestTwoDiagram() {
  const ranked = [...PLAYERS.keys()].sort((left, right) => PLAYERS[left] - PLAYERS[right]);
  const counted = new Set(ranked.slice(0, 2));
  return (
    <svg className="format-diagram" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <Bars counts={(index) => counted.has(index)} />
    </svg>
  );
}
