import { getRootPayload } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import type { VersionZeroDraftSummary } from "@/lib/estimates/editor-read-contracts";
import type { EstimateDraftAiRequest, VersionZeroDraftStatus, VersionZeroLineReviewStatus } from "@/lib/estimates/schemas";
import type { VersionZeroReview, VersionZeroReviewLine, VersionZeroReviewLot } from "@/lib/estimates/version-zero-draft-contracts";
import { isRecord } from "@/lib/value-guards";

export type {
  VersionZeroDraftStatus,
  VersionZeroLineReviewStatus,
  VersionZeroReview,
  VersionZeroReviewLine,
  VersionZeroReviewLot,
};

function parseVersionZeroDraftSummary(payload: unknown): VersionZeroDraftSummary {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger le résumé V0.");
  }

  return root as VersionZeroDraftSummary;
}

function parseVersionZeroReview(payload: unknown): VersionZeroReview {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger la revue V0.");
  }

  return root as VersionZeroReview;
}

export async function fetchVersionZeroDraftSummary(
  versionId: string
): Promise<VersionZeroDraftSummary> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts`,
    {
      method: "GET",
    },
    "Impossible de charger le résumé de la V0."
  );

  return parseVersionZeroDraftSummary(payload);
}

export async function generateVersionZeroDraft(
  versionId: string,
  input: {
    briefId?: string | null;
    selectedLots?: string[];
    ai: EstimateDraftAiRequest;
  }
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        briefId: input.briefId ?? null,
        selectedLots: input.selectedLots ?? [],
        ai: input.ai,
      }),
    },
    "Impossible de générer la V0."
  );

  return parseVersionZeroReview(payload);
}

export async function fetchVersionZeroReview(
  versionId: string,
  draftId: string
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}`,
    {
      method: "GET",
    },
    "Impossible de charger la revue V0."
  );

  return parseVersionZeroReview(payload);
}

export async function reviewVersionZeroLine(
  versionId: string,
  draftId: string,
  lineDraftId: string,
  input: {
    reviewStatus: Exclude<VersionZeroLineReviewStatus, "pending">;
    editedValues?: {
      title?: string | null;
      description?: string | null;
      quantity?: number | null;
      unit?: string | null;
    };
  }
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}/lines/${lineDraftId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reviewStatus: input.reviewStatus,
        editedValues: input.editedValues ?? null,
      }),
    },
    "Impossible de mettre à jour la ligne V0."
  );

  return parseVersionZeroReview(payload);
}

export async function materializeVersionZeroDraft(
  versionId: string,
  draftId: string
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}/materialize`,
    {
      method: "POST",
    },
    "Impossible de matérialiser la V0.",
    undefined,
    { mutation: { versionId: versionId, structural: true } }
  );

  return parseVersionZeroReview(payload);
}
