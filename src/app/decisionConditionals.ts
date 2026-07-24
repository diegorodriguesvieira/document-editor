// Reference CONSUMER-side normalizer for the EOR "conditionals" catalog.
//
// The EOR backend exposes a flat list of decision flags in its own shape
// ({ key, label, providedBy }). The editor knows nothing about that shape —
// this module is the boundary that absorbs it: validate the raw payload and
// re-express each decision as a ConditionFlag, fed to the editor via
// `<DocumentVariablesProvider conditions={…}>`. The provider is what stamps
// the boolean type and the condition-only scope — the consumer never handles
// those fields. A real consumer keeps this next to its HTTP client.
import type { ConditionFlag } from '../features'

/** One entry of the backend catalog, as the EOR service ships it. */
export interface BackendConditional {
  key: string
  label: string
  providedBy: string
}

/**
 * Backend catalog → ConditionFlag list. The catalog carries no grouping, so
 * none is invented — the entries render as a flat list in the condition
 * builder.
 *
 * Defensive on purpose — the payload belongs to another team: non-array
 * payloads normalize to [], entries without a usable key/label are dropped
 * and duplicate keys keep the first occurrence (both warned, so a broken
 * deploy upstream is visible instead of silently shrinking the picker).
 */
export function normalizeConditionals(payload: unknown): ConditionFlag[] {
  if (!Array.isArray(payload)) {
    console.warn('[decisionConditionals] expected an array, got:', typeof payload)
    return []
  }
  const seen = new Set<string>()
  const flags: ConditionFlag[] = []
  for (const entry of payload as Array<Partial<BackendConditional> | null | undefined>) {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : ''
    const label = typeof entry?.label === 'string' ? entry.label.trim() : ''
    if (!key || !label) {
      console.warn('[decisionConditionals] dropped malformed entry:', entry)
      continue
    }
    if (seen.has(key)) {
      console.warn(`[decisionConditionals] dropped duplicate key: ${key}`)
      continue
    }
    seen.add(key)
    flags.push({ id: key, label })
  }
  return flags
}

/**
 * Representative sample of the real EOR payload (the full catalog is ~150
 * entries; the normalizer takes it whole). Covers every key family
 * (EC_/EA_/VC_/IC_).
 */
export const RAW_CONDITIONALS: BackendConditional[] = [
  { key: 'EC_DECISION_FULLTIME', label: 'If contract is full-time', providedBy: 'EOR' },
  { key: 'EC_DECISION_PARTTIME', label: 'If contract is part-time', providedBy: 'EOR' },
  { key: 'EC_DECISION_INDEFINITE', label: 'If contract is indefinite', providedBy: 'EOR' },
  { key: 'EC_DECISION_HAS_PROBATION', label: 'If there is probation period', providedBy: 'EOR' },
  { key: 'EC_DECISION_HAS_SIGNING_BONUS', label: 'If contract has signing bonus', providedBy: 'EOR' },
  { key: 'EC_DECISION_ENROLLED_HEALTH_INSURANCE', label: 'If health insurance is offered', providedBy: 'EOR' },
  { key: 'EA_DECISION_CLIENT_AMENDS_SALARY', label: 'If client amends salary', providedBy: 'EOR' },
  { key: 'EA_DECISION_CLIENT_AMENDS_JOB_TITLE', label: 'If client amends job title', providedBy: 'EOR' },
  { key: 'VC_DECISION_IS_RECURRING_BONUS', label: 'If variable compensation category is recurring bonus', providedBy: 'EOR' },
  { key: 'VC_DECISION_IS_SINGLE_RATE', label: 'If variable compensation category is single rate', providedBy: 'EOR' },
  { key: 'IC_CLIENT_IS_COMPANY', label: 'If client is company', providedBy: 'EOR' },
  { key: 'IC_CONTRACTOR_IS_INDIVIDUAL', label: 'If contractor is individual', providedBy: 'EOR' },
]
