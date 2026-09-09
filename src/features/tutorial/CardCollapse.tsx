import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocalization } from '../preferences/localization';

/**
 * Folds the card down to its own title bar.
 *
 * Every teaching card sits on top of the stage it is teaching about, and at
 * 1280x720 an expanded card covers a fair part of it — including the drag
 * gestures that orbit the camera, which a section such as "orbit the view and
 * confirm the same block still moves along the same world axis" depends on.
 * Folded, the card keeps the learner's place and gives the stage back.
 */
export function CardCollapseToggle({
  collapsed,
  onToggle,
  testId,
}: {
  collapsed: boolean;
  onToggle: () => void;
  testId: string;
}) {
  const { t } = useLocalization();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? t('expandCard') : t('collapseCard')}
      data-testid={testId}
    >
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
    </button>
  );
}
