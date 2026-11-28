import { describe, expect, it } from "vitest";

import { applySubmissionReadinessRegisterContext } from "@/lib/estimates/approval-submission-readiness-server";

// Characterises the register and V0 signals added to a submission readiness: which list each
// one feeds, their order, and every field the approval panel reads (label, message, category,
// action label and the register link with its status, severity, kind and focused entry).

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

type Kind = "missing_piece" | "assumption";

function entry(id: string, kind: Kind, text: string) {
  return { id, kind, severity: "critical", status: "open", text, scopeLabel: "Affaire" } as const;
}

const RULE_BLOCKER = { id: "rule:r1", label: "Seuil", message: "Bloquant de règle.", category: "approvals" as const };
const RULE_ALERT = { id: "rule:r2", label: "Marge", message: "Alerte de règle.", category: "approvals" as const };

function registerSummary(overrides: Partial<Record<
  "criticalOpenEntries" | "nonCriticalOpenEntries" | "clarifyWithClientEntries",
  ReturnType<typeof entry>[]
>> = {}) {
  return {
    openQuestionsCount: 0,
    criticalOpenEntries: [],
    nonCriticalOpenEntries: [],
    clarifyWithClientEntries: [],
    openAssumptionEntries: [],
    openMissingPieceEntries: [],
    ...overrides,
  };
}

function hub(query: string) {
  return `/dashboard/affaires/${PROJECT_ID}?${query}`;
}

describe("applySubmissionReadinessRegisterContext", () => {
  it("adds the six register signals and the V0 blocker after the rule signals, in order", () => {
    const readiness = applySubmissionReadinessRegisterContext({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      submissionReadiness: { blockers: [RULE_BLOCKER], alerts: [RULE_ALERT] },
      registerSummary: registerSummary({
        criticalOpenEntries: [
          entry("c1", "missing_piece", "Plan réseau"),
          entry("c2", "assumption", "Charge au sol"),
          entry("c3", "missing_piece", "Note de calcul"),
        ],
        nonCriticalOpenEntries: [
          entry("n1", "assumption", "Hauteur sous plafond"),
          entry("n2", "missing_piece", "Carnet de détails"),
        ],
        clarifyWithClientEntries: [
          entry("k1", "missing_piece", "Plan de masse"),
          entry("k2", "assumption", "Phasage"),
        ],
      }) as never,
      versionZeroSummary: { activeDraft: { counts: { pending: 2 } } } as never,
    });

    expect(readiness).toEqual({
      blockers: [
        RULE_BLOCKER,
        {
          id: "register:critical_missing_pieces",
          label: "Documents",
          message:
            "Documents critiques manquants: Des pièces critiques restent manquantes avant soumission. " +
            "Pièce manquante : Plan réseau · Pièce manquante : Note de calcul",
          category: "documents",
          actionLabel: "Ouvrir les documents manquants",
          actionHref: hub("registerStatus=open&registerSeverity=critical&registerKind=missing_piece&registerFocus=c1"),
        },
        {
          id: "register:critical_open_questions",
          label: "Registre affaire",
          message: "Questions critiques ouvertes: Des questions critiques restent ouvertes. Hypothèse : Charge au sol",
          category: "register",
          actionLabel: "Ouvrir le registre",
          actionHref: hub("registerStatus=open&registerSeverity=critical&registerKind=assumption&registerFocus=c2"),
        },
        {
          id: "version-zero:review_pending",
          label: "V0 IA",
          message: "La V0 IA comporte encore 2 ligne(s) en attente de validation humaine.",
          category: "estimate_quality",
          actionLabel: undefined,
          actionHref: undefined,
        },
      ],
      alerts: [
        RULE_ALERT,
        {
          id: "register:missing_pieces_pending",
          label: "Documents",
          message:
            "Documents manquants: Des pièces manquantes restent ouvertes avant validation. Pièce manquante : Carnet de détails",
          category: "documents",
          actionLabel: "Ouvrir les documents manquants",
          actionHref: hub("registerStatus=open&registerKind=missing_piece&registerFocus=n2"),
        },
        {
          id: "register:open_questions_pending",
          label: "Registre affaire",
          message: "Questions ouvertes: Des hypothèses restent ouvertes avant validation. Hypothèse : Hauteur sous plafond",
          category: "register",
          actionLabel: "Ouvrir le registre",
          actionHref: hub("registerStatus=open&registerKind=assumption&registerFocus=n1"),
        },
        {
          id: "register:client_missing_documents_required",
          label: "Documents",
          message:
            "Documents attendus du client: Des pièces restent à demander au client avant envoi externe. " +
            "Pièce manquante : Plan de masse",
          category: "documents",
          actionLabel: "Ouvrir les documents attendus",
          actionHref: hub("registerStatus=clarify_with_client&registerKind=missing_piece&registerFocus=k1"),
        },
        {
          id: "register:client_clarification_required",
          label: "Registre affaire",
          message:
            "Clarifications client: Des points restent à clarifier avec le client avant envoi externe. Hypothèse : Phasage",
          category: "register",
          actionLabel: "Ouvrir le registre",
          actionHref: hub("registerStatus=clarify_with_client&registerKind=assumption&registerFocus=k2"),
        },
      ],
    });
  });

  it("adds no signal for a register without entries of a kind, and asks to settle an idle V0", () => {
    const readiness = applySubmissionReadinessRegisterContext({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      submissionReadiness: { blockers: [], alerts: [RULE_ALERT] },
      registerSummary: registerSummary({
        criticalOpenEntries: [entry("c2", "assumption", "Charge au sol")],
        clarifyWithClientEntries: [entry("k1", "missing_piece", "Plan de masse")],
      }) as never,
      versionZeroSummary: { activeDraft: { counts: { pending: 0 } } } as never,
    });

    expect(readiness.blockers.map((signal) => signal.id)).toEqual([
      "register:critical_open_questions",
      "version-zero:review_pending",
    ]);
    expect(readiness.blockers[1]?.message).toBe(
      "Une V0 IA active doit être matérialisée ou abandonnée avant soumission."
    );
    expect(readiness.alerts.map((signal) => signal.id)).toEqual([
      "rule:r2",
      "register:client_missing_documents_required",
    ]);
  });

  it("returns the rule signals alone, deduplicated by id, without register entries or V0", () => {
    const duplicate = { ...RULE_BLOCKER, message: "Second bloquant de la même règle." };
    const readiness = applySubmissionReadinessRegisterContext({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      submissionReadiness: { blockers: [RULE_BLOCKER, duplicate], alerts: [] },
      registerSummary: registerSummary() as never,
      versionZeroSummary: null,
    });

    expect(readiness).toEqual({ blockers: [duplicate], alerts: [] });
  });
});
