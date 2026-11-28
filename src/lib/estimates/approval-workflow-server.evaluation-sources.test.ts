import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi, type InMemoryRestHandler } from "@/test/in-memory-rest-api";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/estimates/approval-v2-snapshot", () => ({
  freezeApprovalV2DraftIfRequired: vi.fn(),
}));

vi.mock("@/lib/estimates/review-cycle-submission", () => ({
  openEstimateReviewCycle: vi.fn(),
}));

import { submitEstimateApproval } from "@/lib/estimates/approval-workflow-server";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Characterises which refusal a review submission reports when the sources of its rule evaluation
// cannot be read: the version's items come before the fixed-discount evidence of the version.

type Row = Record<string, unknown>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

const VERSION: Row = {
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
  // A fixed discount: the evaluation reads its evidence alongside the items.
  discount_amount_cents: 5000,
  gross_ht_cents: null,
  discount_applied_cents: null,
  approval_status: "not_required",
  approval_summary: null,
  approval_evaluated_at: null,
  estimate_projects: { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: USER_ID, name: "Affaire test", client_name: "Client A" },
};

function refusal() {
  // Answered at once by supabase-js, without retry.
  const error = new Error("lecture refusée");
  error.name = "AbortError";
  return error;
}

function signIn(input: { refuseItems: boolean; refuseDiscountEvidence: boolean }) {
  const handlers: Record<string, InMemoryRestHandler> = {
    "rpc/read_estimate_version_items": () => {
      if (input.refuseItems) throw refusal();
      return [];
    },
    // The access read selects its columns; the discount evidence reads the whole version.
    estimate_versions: (url, rows) => {
      if (input.refuseDiscountEvidence && url.searchParams.get("select") === "*") throw refusal();
      return rows;
    },
  };
  const api = createInMemoryRestApi({
    tenant_memberships: [
      {
        id: `m-${USER_ID}`,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: "admin",
        is_default: true,
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenants: { is_active: true, name: "Tenant test" },
        "tenants.is_active": true,
      },
    ],
    estimate_versions: [VERSION],
  }, handlers);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    from: api.client.from.bind(api.client),
    rpc: api.client.rpc.bind(api.client),
  } as never);
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(freezeApprovalV2DraftIfRequired).mockResolvedValue(false);
});

describe("submitEstimateApproval evaluation sources", () => {
  it("reports the items refusal when the items and the discount evidence are both refused", async () => {
    signIn({ refuseItems: true, refuseDiscountEvidence: true });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({ status: 400, message: "Impossible de charger les lignes." });
    expect(openEstimateReviewCycle).not.toHaveBeenCalled();
  });

  it("reports the discount evidence refusal when the items are read", async () => {
    signIn({ refuseItems: false, refuseDiscountEvidence: true });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({ status: 400, message: "Impossible de charger la preuve de remise." });
    expect(openEstimateReviewCycle).not.toHaveBeenCalled();
  });
});
