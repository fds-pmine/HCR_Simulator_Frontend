import { create } from 'zustand';

/**
 * The width below which the stage stops being a canvas with panels floating
 * over it and becomes a column of rows — see the narrow-stage block at the
 * foot of `styles.css`, which must stay in step with this number.
 */
export const NARROW_STAGE = '(max-width: 980px)';

/**
 * Whether the stage is currently laid out as a column.
 *
 * Read at call time rather than subscribed to: the two things it decides —
 * which panels start open, and whether opening one closes the other — are
 * answered when a panel is toggled, and a viewport that changes in between
 * should not reach back and shut a panel the learner opened on purpose.
 *
 * Guarded because jsdom has no `matchMedia`; a test environment without one
 * gets the desktop answer, which is the one its assertions were written for.
 */
function narrowStage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(NARROW_STAGE).matches
  );
}

interface WorkbenchUiState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  logOpen: boolean;
  showTarget: boolean;
  showCutterGrid: boolean;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  /**
   * Give the scene the stage back, if it does not already have it.
   *
   * A phone shows one work surface at a time, so a run that starts behind the
   * program panel is a run nobody watches. No-op on a desktop, where the
   * scene was never covered in the first place.
   */
  revealStage: () => void;
  toggleLog: () => void;
  toggleTarget: () => void;
  toggleCutterGrid: () => void;
}

export const useWorkbenchStore = create<WorkbenchUiState>((set) => ({
  // A phone opens on the robot, not on an empty Blockly canvas: the panels are
  // one tap away in the topbar, and the lesson's first instruction is usually
  // to look at the arm.
  leftPanelOpen: !narrowStage(),
  rightPanelOpen: !narrowStage(),
  logOpen: false,
  showTarget: true,
  showCutterGrid: true,
  toggleLeftPanel: () =>
    set((state) => {
      const leftPanelOpen = !state.leftPanelOpen;
      return leftPanelOpen && narrowStage()
        ? { leftPanelOpen, rightPanelOpen: false }
        : { leftPanelOpen };
    }),
  toggleRightPanel: () =>
    set((state) => {
      const rightPanelOpen = !state.rightPanelOpen;
      return rightPanelOpen && narrowStage()
        ? { rightPanelOpen, leftPanelOpen: false }
        : { rightPanelOpen };
    }),
  revealStage: () =>
    set((state) =>
      narrowStage() && (state.leftPanelOpen || state.rightPanelOpen)
        ? { leftPanelOpen: false, rightPanelOpen: false }
        : // The same object, not an empty one: zustand compares the return
          // against the current state and skips notifying when they are
          // identical, so a desktop Run does not re-render the workbench to
          // say nothing changed.
          state,
    ),
  toggleLog: () => set((state) => ({ logOpen: !state.logOpen })),
  toggleTarget: () =>
    set((state) => ({ showTarget: !state.showTarget })),
  toggleCutterGrid: () =>
    set((state) => ({ showCutterGrid: !state.showCutterGrid })),
}));
