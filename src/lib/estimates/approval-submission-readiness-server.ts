import type { Supabase, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, EvaluateRulesResult, EstimateApprovalSubmissionSignal, EstimateRuleViolation, EstimateRuleUnavailableSignal } from "@/lib/estimates/approval-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAffaireRegisterHubHref, type AffaireRegisterEntryKind, type AffaireRegisterEntrySeverity, type AffaireRegisterEntryStatus } from "@/lib/affaires/register";
import { buildAffaireRegisterSubmissionSignalMessage, fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-gate-server";
import type { V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import type { CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import type { EstimateReadinessCategory } from "@/lib/estimates/readiness";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";
import type { Database } from "@/types/database";
import { isApprovalWorkflowSignal, resolveApprovalSummaryLabel } from "@/lib/estimates/rule-evaluation";
import { evaluateRules } from "@/lib/estimates/rule-evaluation-server";

function toSubmissionReadinessSignal(input: {
  id: string;
  label: string;
  message: string;
  category?: EstimateReadinessCategory;
  actionLabel?: string;
  actionHref?: string;
}): EstimateApprovalSubmissionSignal {
  return {
    id: input.id,
    label: input.label,
    message: input.message,
    category: input.category,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref,
  };
}

function dedupeSubmissionSignals(
  signals: EstimateApprovalSubmissionSignal[]
) {
  return [...new Map(signals.map((signal) => [signal.id, signal])).values()];
}

export function buildSubmissionReadinessFromRulesEvaluation(input: {
  rulesEvaluation: EvaluateRulesResult;
}): {
  blockers: EstimateApprovalSubmissionSignal[];
  alerts: EstimateApprovalSubmissionSignal[];
} {
  const fromViolation = (violation: EstimateRuleViolation) =>
    toSubmissionReadinessSignal({
      id: `rule:${violation.rule_id}`,
      label: resolveApprovalSummaryLabel(violation.rule_type),
      message: violation.message,
      category: "approvals",
    });
  const fromUnavailableSignal = (signal: EstimateRuleUnavailableSignal) =>
    toSubmissionReadinessSignal({
      id: `signal:${signal.rule_id}`,
      label: resolveApprovalSummaryLabel(signal.rule_type),
      message: signal.message,
      category: "approvals",
    });

  const blockers = [
    ...input.rulesEvaluation.blockingViolations
      .filter(
        (violation) =>
          !isApprovalWorkflowSignal({
            action: violation.action,
            ruleType: violation.rule_type,
          })
      )
      .map((violation) => fromViolation(violation)),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action === "block")
      .map((signal) => fromUnavailableSignal(signal)),
  ];

  const alerts = [
    ...input.rulesEvaluation.warningViolations.map((violation) => fromViolation(violation)),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action !== "block")
      .map((signal) => fromUnavailableSignal(signal)),
  ];

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
}

export async function loadSubmissionReadinessRegisterContext(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
}) {
  const [registerSummary, versionZeroSummary] = await Promise.all([
    fetchAffaireRegisterGateSummary({
      supabase: input.supabase,
      projectId: input.projectId,
      versionId: input.versionId,
    }),
    fetchVersionZeroDraftSummary({ versionId: input.versionId }).catch(() => null),
  ]);
  return { registerSummary, versionZeroSummary };
}

async function enrichSubmissionReadinessWithAffaireRegister(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
}) {
  return applySubmissionReadinessRegisterContext({
    ...input,
    ...(await loadSubmissionReadinessRegisterContext(input)),
  });
}

/**
 * The register signals of a submission, in the order they are added: the two critical lists block
 * it, the open and client lists only alert.
 */
const REGISTER_SUBMISSION_SIGNALS: ReadonlyArray<{
  list: "blockers" | "alerts";
  source: "criticalOpenEntries" | "nonCriticalOpenEntries" | "clarifyWithClientEntries";
  kind: AffaireRegisterEntryKind;
  status: AffaireRegisterEntryStatus;
  severity?: AffaireRegisterEntrySeverity;
  id: string;
  label: string;
  messageLabel: string;
  intro: string;
  category: EstimateReadinessCategory;
  actionLabel: string;
}> = [
  {
    list: "blockers",
    source: "criticalOpenEntries",
    kind: "missing_piece",
    status: "open",
    severity: "critical",
    id: "register:critical_missing_pieces",
    label: "Documents",
    messageLabel: "Documents critiques manquants",
    intro: "Des pièces critiques restent manquantes avant soumission.",
    category: "documents",
    actionLabel: "Ouvrir les documents manquants",
  },
  {
    list: "blockers",
    source: "criticalOpenEntries",
    kind: "assumption",
    status: "open",
    severity: "critical",
    id: "register:critical_open_questions",
    label: "Registre affaire",
    messageLabel: "Questions critiques ouvertes",
    intro: "Des questions critiques restent ouvertes.",
    category: "register",
    actionLabel: "Ouvrir le registre",
  },
  {
    list: "alerts",
    source: "nonCriticalOpenEntries",
    kind: "missing_piece",
    status: "open",
    id: "register:missing_pieces_pending",
    label: "Documents",
    messageLabel: "Documents manquants",
    intro: "Des pièces manquantes restent ouvertes avant validation.",
    category: "documents",
    actionLabel: "Ouvrir les documents manquants",
  },
  {
    list: "alerts",
    source: "nonCriticalOpenEntries",
    kind: "assumption",
    status: "open",
    id: "register:open_questions_pending",
    label: "Registre affaire",
    messageLabel: "Questions ouvertes",
    intro: "Des hypothèses restent ouvertes avant validation.",
    category: "register",
    actionLabel: "Ouvrir le registre",
  },
  {
    list: "alerts",
    source: "clarifyWithClientEntries",
    kind: "missing_piece",
    status: "clarify_with_client",
    id: "register:client_missing_documents_required",
    label: "Documents",
    messageLabel: "Documents attendus du client",
    intro: "Des pièces restent à demander au client avant envoi externe.",
    category: "documents",
    actionLabel: "Ouvrir les documents attendus",
  },
  {
    list: "alerts",
    source: "clarifyWithClientEntries",
    kind: "assumption",
    status: "clarify_with_client",
    id: "register:client_clarification_required",
    label: "Registre affaire",
    messageLabel: "Clarifications client",
    intro:
      "Des points restent à clarifier avec le client avant envoi externe.",
    category: "register",
    actionLabel: "Ouvrir le registre",
  },
];

export function applySubmissionReadinessRegisterContext(input: {
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
} & Awaited<ReturnType<typeof loadSubmissionReadinessRegisterContext>>) {
  const { registerSummary, versionZeroSummary } = input;
  const blockers = [...input.submissionReadiness.blockers];
  const alerts = [...input.submissionReadiness.alerts];
  REGISTER_SUBMISSION_SIGNALS.forEach((signal) => {
    const entries = registerSummary[signal.source].filter(
      (entry) => entry.kind === signal.kind
    );
    if (entries.length === 0) return;
    (signal.list === "blockers" ? blockers : alerts).push(
      toSubmissionReadinessSignal({
        id: signal.id,
        label: signal.label,
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries,
          label: signal.messageLabel,
          intro: signal.intro,
        }),
        category: signal.category,
        actionLabel: signal.actionLabel,
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: signal.status,
          severity: signal.severity,
          kind: signal.kind,
          focusEntryId: entries[0]?.id ?? null,
        }),
      })
    );
  });

  if (versionZeroSummary?.activeDraft) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "version-zero:review_pending",
        label: "V0 IA",
        message:
          versionZeroSummary.activeDraft.counts.pending > 0
            ? `La V0 IA comporte encore ${versionZeroSummary.activeDraft.counts.pending} ligne(s) en attente de validation humaine.`
            : "Une V0 IA active doit être matérialisée ou abandonnée avant soumission.",
        category: "estimate_quality",
        actionLabel: isEstimateAiDraftEnabled() ? "Ouvrir la V0" : undefined,
        actionHref: isEstimateAiDraftEnabled()
          ? `/dashboard/estimates/${input.versionId}/edit?openVersionZero=1`
          : undefined,
      })
    );
  }

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
}

export async function evaluateSubmissionReadiness(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
}) {
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
    fixedDiscountEvidence: input.fixedDiscountEvidence,
    v3MarginEvidence: input.v3MarginEvidence,
  });

  return enrichSubmissionReadinessWithAffaireRegister({
    supabase: input.supabase,
    projectId: input.project.id,
    versionId: input.version.id,
    submissionReadiness: buildSubmissionReadinessFromRulesEvaluation({
      rulesEvaluation,
    }),
  });
}
