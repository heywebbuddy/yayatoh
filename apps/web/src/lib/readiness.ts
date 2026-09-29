/**
 * Readiness engine v1 (M1.4/M1.4f, profile checklists M4.2a). It lives in the command-center
 * module since M3.2 (the Command Center's readiness score reads the same rules); this re-export
 * keeps the web imports.
 */
export {
  PLACEHOLDER_SECTIONS,
  READINESS_KEYS,
  type ReadinessFacts,
  type ReadinessRule,
  readinessPercent,
  readinessRules,
} from '@yayatoh/command-center/client';
