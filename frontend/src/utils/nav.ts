import type { IconType } from 'react-icons';
import { FiActivity, FiBarChart2, FiCheckSquare, FiClock, FiGrid, FiTruck } from 'react-icons/fi';
import type { Role } from '../context/AuthContext';

export interface NavItem {
  to: string;
  label: string;
  icon: IconType;
}

const GATE: NavItem = { to: '/guard', label: 'Gate', icon: FiActivity };
const REVIEW: NavItem = { to: '/review-queue', label: 'Plate review', icon: FiCheckSquare };
const HISTORY: NavItem = { to: '/alert-history', label: 'Alert history', icon: FiClock };

/** Every page a role can reach, in menu order. The first is where they land. */
export const NAV: Record<Role, NavItem[]> = {
  admin: [
    { to: '/admin', label: 'Dashboard', icon: FiGrid },
    GATE,
    REVIEW,
    HISTORY,
    { to: '/analytics', label: 'Analytics', icon: FiBarChart2 },
  ],
  guard: [GATE, REVIEW, HISTORY],
  user: [{ to: '/user', label: 'My vehicles', icon: FiTruck }],
};

/** Where a role starts after signing in. */
export const homeFor = (role: Role | undefined): string => (role ? NAV[role][0].to : '/');
