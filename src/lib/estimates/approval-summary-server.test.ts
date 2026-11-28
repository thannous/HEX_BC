import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi, type InMemoryRestRequest } from "@/test/in-memory-rest-api";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/affaires/register-gate-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/affaires/register-gate-server")>()),
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

import { getEstimateApprovalSummary } from "@/lib/estimates/approval-summary-server";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-gate-server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Characterises what the approval panel reader answers and writes on each branch of the summary
// projection: a stored summary still current, a version that is no longer a draft, a draft without
// the service-role client (outside and inside production) and a draft whose summary is projected.

type Row = Record<string, unknown>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const RULE_ID = "99999999-9999-4999-8999-999999999999";
const ENTRY_ID = "abababab-abab-4bab-8bab-abababababab";
const NOW = "2026-03-07T08:00:00.000Z";
const STORED_EVALUATED_AT = "2026-03-05T07:30:00.000Z";
const THRESHOLD_MESSAGE =
  "Montant HT 2 500 € au-dessus du seuil de validation 1 000 €. Approbation requise.";

function membership(userId: string, role: string, isDefault: boolean): Row {
  return {
    id: `m-${userId}`,
    tenant_id: TENANT_ID,
    user_id: userId,
    role,
    is_default: isDefault,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
    tenants: { is_active: true, name: "Tenant test" },
    // The fixture filters on flat columns: the active-tenant join filter reads this key.
    "tenants.is_active": true,
  };
}

function versionRow(overrides: Row = {}): Row {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    status: "draft",
    updated_at: "2026-03-01T09:00:00.000Z",
    content_revision: 1,
    calc_engine_version: 1,
    calc_snapshot_content_revision: null,
    calc_snapshot_context: null,
    version_number: 3,
    project_id: PROJECT_ID,
    title: "Version test",
    total_ht_cents: 250000,
    margin_bp: 1200,
    margin_multiplier: 1,
    margin_mode: null,
    discount_bp: 0,
    discount_amount_cents: null,
    gross_ht_cents: null,
    discount_applied_cents: null,
    approval_status: "not_required",
    approval_summary: null,
    approval_evaluated_at: null,
    estimate_projects: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Affaire test",
      client_name: "Client A",
    },
    ...overrides,
  };
}

const RULE_ROW: Row = {
  id: RULE_ID,
  created_at: "2026-03-01T09:00:00.000Z",
  updated_at: "2026-03-01T09:00:00.000Z",
  tenant_id: TENANT_ID,
  rule_type: "require_approval",
  scope_type: "global",
  scope_id: null,
  threshold_value: 100000,
  action: "require_approval",
  is_active: true,
};

const REASON = {
  ruleId: RULE_ID,
  label: "Seuil montant HT",
  signalKey: "total_ht_cents",
  thresholdValue: 100000,
  actualValue: 250000,
  sourceState: "ready",
  message: THRESHOLD_MESSAGE,
  action: "require_approval",
  approvalStatus: "missing",
  approvalId: null,
  approvalCreatedAt: null,
  approvalDecidedAt: null,
};

/** The summary as the version stores it once projected. */
const STORED_SUMMARY = {
  requiresApproval: true,
  reasons: [REASON],
  latestDecision: null,
  unavailableSignals: [],
};

const REGISTER_ALERT = {
  id: "register:open_questions_pending",
  label: "Registre affaire",
  message: "Questions ouvertes: Des hypothèses restent ouvertes avant validation. Hypothèse : Hauteur sous plafond à confirmer",
  category: "register",
  actionLabel: "Ouvrir le registre",
  actionHref: `/dashboard/affaires/${PROJECT_ID}?registerStatus=open&registerKind=assumption&registerFocus=${ENTRY_ID}`,
};

/** The whole panel the reader answers for this fixture, the evaluation time aside. */
function expectedPanel(evaluatedAt: string) {
  return {
    approvalStatus: "required",
    requiresApproval: true,
    evaluatedAt,
    reasons: [REASON],
    latestDecision: null,
    unavailableSignals: [],
    permissions: { canPrepareRequest: true, canRequest: true, canDecide: false },
    activeCycle: null,
    reviewHistory: [],
    availableReviewers: [
      { userId: REVIEWER_ID, fullName: "Camille Reviewer", workEmail: "reviewer@example.com" },
      { userId: USER_ID, fullName: "Nadia Martin", workEmail: "nadia@example.com" },
    ],
    submissionReadiness: { blockers: [], alerts: [REGISTER_ALERT] },
    correctionChecklist: null,
    changesSinceLastCycle: null,
    commentTargets: {
      project: { scopeType: "project", scopeId: null, label: "Affaire test" },
      lots: [],
      lines: [],
      exceptions: [],
      hypotheses: [],
      approvalRules: [{ scopeType: "approval_rule", scopeId: RULE_ID, label: "Seuil montant HT" }],
    },
  };
}

function setup(input: { version?: Row; serviceRole?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    tenant_memberships: [membership(USER_ID, "admin", true), membership(REVIEWER_ID, "director", false)],
    profiles: [
      { id: USER_ID, full_name: "Nadia Martin", work_email: "nadia@example.com" },
      { id: REVIEWER_ID, full_name: "Camille Reviewer", work_email: "reviewer@example.com" },
    ],
    estimate_versions: [versionRow(input.version)],
    estimate_items: [],
    estimate_rules: [RULE_ROW],
    estimate_approvals: [],
    estimate_review_cycles: [],
  };
  const api = createInMemoryRestApi(tables, {
    "rpc/read_estimate_version_items": () => [],
  });
  const from = api.client.from.bind(api.client);
  const rpc = api.client.rpc.bind(api.client);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from,
    rpc,
  } as never);
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(
    (input.serviceRole === false ? null : { from, rpc }) as never
  );
  const writes = () =>
    api.requests
      .filter((request: InMemoryRestRequest) => request.method !== "GET" && request.method !== "HEAD")
      .map((request) => ({ to: `${request.method} ${request.table}`, body: request.body }));
  return { writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
    openQuestionsCount: 1,
    criticalOpenEntries: [],
    nonCriticalOpenEntries: [
      {
        id: ENTRY_ID,
        kind: "assumption",
        severity: "minor",
        status: "open",
        text: "Hauteur sous plafond à confirmer",
        scopeLabel: "Affaire",
      },
    ],
    clarifyWithClientEntries: [],
    openAssumptionEntries: [],
    openMissingPieceEntries: [],
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getEstimateApprovalSummary", () => {
  it("keeps the stored evaluation time and writes nothing while the stored summary is current", async () => {
    const harness = setup({
      version: {
        approval_status: "required",
        approval_summary: STORED_SUMMARY,
        approval_evaluated_at: STORED_EVALUATED_AT,
      },
    });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary).toEqual(expectedPanel(STORED_EVALUATED_AT));
    expect(harness.writes()).toEqual([]);
  });

  it("re-evaluates a stored summary that was never timed, and projects it", async () => {
    const harness = setup({
      version: { approval_status: "required", approval_summary: STORED_SUMMARY, approval_evaluated_at: null },
    });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary).toEqual(expectedPanel(NOW));
    expect(harness.writes().map((write) => write.to)).toEqual([
      "PATCH estimate_versions",
      "POST rpc/log_estimate_version_event",
    ]);
  });

  it("computes the summary of a version that is no longer a draft without writing it", async () => {
    const harness = setup({ version: { status: "sent" } });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary).toEqual(expectedPanel(NOW));
    expect(harness.writes()).toEqual([]);
  });

  it("answers the fresh summary of a draft without the service-role client outside production", async () => {
    const harness = setup({ serviceRole: false });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary).toEqual(expectedPanel(NOW));
    expect(harness.writes()).toEqual([]);
  });

  it("refuses to answer a draft without the service-role client in production", async () => {
    const harness = setup({ serviceRole: false });
    vi.stubEnv("NODE_ENV", "production");

    await expect(getEstimateApprovalSummary(VERSION_ID)).rejects.toThrow(
      new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
    );
    expect(harness.writes()).toEqual([]);
  });

  it("projects a changed summary of a draft, then answers it", async () => {
    const harness = setup();

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary).toEqual(expectedPanel(NOW));
    expect(harness.writes()).toEqual([
      {
        to: "PATCH estimate_versions",
        body: { approval_status: "required", approval_summary: STORED_SUMMARY, approval_evaluated_at: NOW },
      },
      {
        to: "POST rpc/log_estimate_version_event",
        body: {
          p_estimate_version_id: VERSION_ID,
          p_event_type: "approval_rules_evaluated",
          p_created_by: USER_ID,
          p_metadata: {
            trigger: "read",
            previousStatus: "not_required",
            approvalStatus: "required",
            evaluatedAt: NOW,
            summary: STORED_SUMMARY,
          },
          p_occurred_at: NOW,
        },
      },
      {
        to: "POST rpc/log_estimate_version_event",
        body: {
          p_estimate_version_id: VERSION_ID,
          p_event_type: "approval_status_changed",
          p_created_by: USER_ID,
          p_metadata: {
            previousStatus: "not_required",
            nextStatus: "required",
            reasons: [{ ruleId: RULE_ID, approvalStatus: "missing", message: THRESHOLD_MESSAGE }],
          },
          p_occurred_at: NOW,
        },
      },
    ]);
  });
});
