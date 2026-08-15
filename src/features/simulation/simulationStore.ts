import { create } from 'zustand';

interface WorkbenchUiState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  logOpen: boolean;
  showTarget: boolean;
  showCutterGrid: boolean;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleLog: () => void;
  toggleTarget: () => void;
  toggleCutterGrid: () => void;
}

export const useWorkbenchStore = create<WorkbenchUiState>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: true,
  logOpen: false,
  showTarget: true,
  showCutterGrid: true,
  toggleLeftPanel: () =>
    set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () =>
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleLog: () => set((state) => ({ logOpen: !state.logOpen })),
  toggleTarget: () =>
    set((state) => ({ showTarget: !state.showTarget })),
  toggleCutterGrid: () =>
    set((state) => ({ showCutterGrid: !state.showCutterGrid })),
}));
