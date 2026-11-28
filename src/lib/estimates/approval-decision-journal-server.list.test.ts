import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi, type InMemoryRestHandler } from "@/test/in-memory-rest-api";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

import { listEstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal-server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Characterises the approval decision journal: its events, newest first, the author filter, the
// authors offered by the filter whatever it selects, and which read's refusal the reader reports
// when its events, its authors or both cannot be read.

type Row = Record<string, unknown>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VERSION_ID = "34343434-3434-4343-8343-343434343434";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function event(input: {
  id: string;
  versionId?: string;
  eventType?: string;
  createdBy: string | null;
  authorName?: string;
  occurredAt: string;
  createdAt?: string;
  metadata?: Row;
}): Row {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    estimate_version_id: input.versionId ?? VERSION_ID,
    event_type: input.eventType ?? "approval_decided",
    metadata: input.metadata ?? {},
    created_by: input.createdBy,
    occurred_at: input.occurredAt,
    created_at: input.createdAt ?? input.occurredAt,
    profiles: input.authorName ? { full_name: input.authorName } : null,
  };
}

const EVENTS = [
  event({
    id: "e-1",
    createdBy: USER_ID,
    authorName: "Nadia Martin",
    occurredAt: "2026-03-02T10:00:00.000Z",
    metadata: {
      decision: "approved_with_reservations",
      cycleId: "cycle-1",
      cycleNumber: 1,
      comments: [{ scopeType: "lot", scopeId: "lot-1", scopeLabel: " Lot CFO ", comment: " Sous réserve. " }],
    },
  }),
  event({
    id: "e-2",
    createdBy: REVIEWER_ID,
    authorName: "Camille Reviewer",
    occurredAt: "2026-03-04T10:00:00.000Z",
    metadata: {
      decision: "changes_requested",
      cycleNumber: 2,
      rulesTriggered: [
        { ruleId: "rule-1", label: "Seuil montant HT", signalKey: "total_ht_cents", message: "Au-dessus du seuil.", thresholdValue: 100000, actualValue: 250000, approvalStatus: "pending" },
      ],
    },
  }),
  event({ id: "e-3", createdBy: null, occurredAt: "2026-03-03T10:00:00.000Z", metadata: { approvalOutcome: "rejected" } }),
  event({ id: "e-4", createdBy: USER_ID, authorName: "Nadia Martin", occurredAt: "2026-03-03T10:00:00.000Z", createdAt: "2026-03-03T11:00:00.000Z" }),
  event({ id: "e-5", eventType: "approval_rules_evaluated", createdBy: USER_ID, authorName: "Nadia Martin", occurredAt: "2026-03-05T10:00:00.000Z" }),
  event({ id: "e-6", versionId: OTHER_VERSION_ID, createdBy: REVIEWER_ID, authorName: "Camille Reviewer", occurredAt: "2026-03-05T10:00:00.000Z" }),
];

function signIn(handlers: Record<string, InMemoryRestHandler> = {}) {
  const tables: Record<string, Row[]> = {
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
    estimate_versions: [
      {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        status: "draft",
        estimate_projects: { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: USER_ID, name: "Affaire test", client_name: "Client A" },
      },
    ],
    estimate_version_events: EVENTS,
  };
  const api = createInMemoryRestApi(tables, handlers);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    from: api.client.from.bind(api.client),
    rpc: api.client.rpc.bind(api.client),
  } as never);
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null);
  return api;
}

/** Refuses the journal's events read, its authors read, or both; a refusal is answered without retry. */
function refusing(input: { events: boolean; authors: boolean }): Record<string, InMemoryRestHandler> {
  return {
    estimate_version_events: (url) => {
      const isEventsRead = (url.searchParams.get("select") ?? "").includes("occurred_at");
      if (isEventsRead ? input.events : input.authors) {
        const refusal = new Error("lecture refusée");
        refusal.name = "AbortError";
        throw refusal;
      }
      return [];
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listEstimateApprovalDecisionJournal", () => {
  it("lists the version's decisions newest first, with the authors sorted by name", async () => {
    signIn();

    const journal = await listEstimateApprovalDecisionJournal({ versionId: VERSION_ID });

    expect(journal.events.map((entry) => entry.id)).toEqual(["e-2", "e-4", "e-3", "e-1"]);
    expect(journal.events[0]).toEqual({
      id: "e-2",
      estimateVersionId: VERSION_ID,
      occurredAt: "2026-03-04T10:00:00.000Z",
      createdAt: "2026-03-04T10:00:00.000Z",
      actorUserId: REVIEWER_ID,
      actorName: "Camille Reviewer",
      decision: "changes_requested",
      approvalOutcome: "rejected",
      cycleId: null,
      cycleNumber: 2,
      commentCount: 0,
      scopeCount: 0,
      perimeterLabel: "Seuil montant HT",
      scopes: [],
      comments: [],
      rulesTriggered: [
        {
          ruleId: "rule-1",
          label: "Seuil montant HT",
          signalKey: "total_ht_cents",
          message: "Au-dessus du seuil.",
          thresholdValue: 100000,
          actualValue: 250000,
          sourceState: "ready",
          approvalStatus: "pending",
        },
      ],
    });
    expect(journal.events[2]).toMatchObject({ id: "e-3", actorUserId: null, actorName: null, decision: "changes_requested" });
    expect(journal.events[3]).toMatchObject({
      id: "e-1",
      decision: "approved_with_reservations",
      cycleId: "cycle-1",
      perimeterLabel: "Lot CFO",
      scopes: [{ scopeType: "lot", scopeId: "lot-1", scopeLabel: "Lot CFO" }],
      comments: [{ scopeType: "lot", scopeId: "lot-1", scopeLabel: "Lot CFO", comment: "Sous réserve." }],
    });
    expect(journal.availableAuthors).toEqual([
      { userId: REVIEWER_ID, actorName: "Camille Reviewer" },
      { userId: USER_ID, actorName: "Nadia Martin" },
    ]);
    expect(journal.filters).toEqual({ actorUserId: null, decision: null });
  });

  it("filters the events by author but still offers every author", async () => {
    signIn();

    const journal = await listEstimateApprovalDecisionJournal({ versionId: VERSION_ID, actorUserId: USER_ID });

    expect(journal.events.map((entry) => entry.id)).toEqual(["e-4", "e-1"]);
    expect(journal.availableAuthors.map((author) => author.userId)).toEqual([REVIEWER_ID, USER_ID]);
    expect(journal.filters).toEqual({ actorUserId: USER_ID, decision: null });
  });

  it("reports the events refusal first when both reads are refused", async () => {
    signIn(refusing({ events: true, authors: true }));

    await expect(listEstimateApprovalDecisionJournal({ versionId: VERSION_ID })).rejects.toMatchObject({
      status: 400,
      message: "Impossible de charger le journal de décision.",
    });
  });

  it("reports the events refusal alone", async () => {
    signIn(refusing({ events: true, authors: false }));

    await expect(listEstimateApprovalDecisionJournal({ versionId: VERSION_ID })).rejects.toMatchObject({
      status: 400,
      message: "Impossible de charger le journal de décision.",
    });
  });

  it("reports the authors refusal when only the authors cannot be read", async () => {
    signIn(refusing({ events: false, authors: true }));

    await expect(listEstimateApprovalDecisionJournal({ versionId: VERSION_ID })).rejects.toMatchObject({
      status: 400,
      message: "Impossible de charger les auteurs du journal de décision.",
    });
  });
});
