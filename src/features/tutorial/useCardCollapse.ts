import { useState } from 'react';

/**
 * Fold state for a teaching card that floats over the 3D stage.
 *
 * The fold belongs to the learner, not to the step: it survives Next and
 * Previous, the same way a folded panel stays folded.
 */
export function useCardCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  return { collapsed, toggleCollapsed: () => setCollapsed((folded) => !folded) };
}
