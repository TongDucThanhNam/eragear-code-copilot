import { createContext, type ReactNode, useContext } from "react";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "./dashboard-view.contract";

const DashboardStateContext = createContext<DashboardViewState | null>(null);
const DashboardActionsContext = createContext<DashboardViewActions | null>(
  null
);

interface DashboardViewProviderProps {
  state: DashboardViewState;
  actions: DashboardViewActions;
  children: ReactNode;
}

export function DashboardViewProvider({
  state,
  actions,
  children,
}: DashboardViewProviderProps) {
  return (
    <DashboardStateContext.Provider value={state}>
      <DashboardActionsContext.Provider value={actions}>
        {children}
      </DashboardActionsContext.Provider>
    </DashboardStateContext.Provider>
  );
}

export function useDashboardState(): DashboardViewState {
  const context = useContext(DashboardStateContext);
  if (!context) {
    throw new Error(
      "useDashboardState must be used within DashboardViewProvider"
    );
  }
  return context;
}

export function useDashboardActions(): DashboardViewActions {
  const context = useContext(DashboardActionsContext);
  if (!context) {
    throw new Error(
      "useDashboardActions must be used within DashboardViewProvider"
    );
  }
  return context;
}
