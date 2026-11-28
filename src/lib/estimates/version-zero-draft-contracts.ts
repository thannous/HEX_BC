import type { VersionZeroDraftSummary } from "@/lib/estimates/editor-read-contracts";
import type {
  VersionZeroDraftStatus,
  VersionZeroLineReviewStatus,
  VersionZeroLotStatus,
} from "@/lib/estimates/schemas";
import type { VersionZeroLineOrigin } from "@/lib/estimates/version-zero-utils";

/** The review of a V0 draft, as the server answers it and the editor reads it. Types only. */

type VersionZeroDraftCounts = NonNullable<
  VersionZeroDraftSummary["activeDraft"]
>["counts"];

export type VersionZeroReviewLine = {
  id: string;
  lotId: string;
  order: number;
  reviewStatus: VersionZeroLineReviewStatus;
  generationOrigin: VersionZeroLineOrigin | null;
  confidence: number;
  confidenceLabel: "elevee" | "moyenne" | "faible";
  proposed: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  edited: {
    title: string | null;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  effective: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  materializedEstimateItemId: string | null;
};

export type VersionZeroReviewLot = {
  id: string;
  key: string;
  label: string;
  order: number;
  status: VersionZeroLotStatus;
  confidence: number | null;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  lines: VersionZeroReviewLine[];
};

export type VersionZeroReview = {
  draft: {
    id: string;
    versionId: string;
    projectId: string;
    briefId: string | null;
    status: VersionZeroDraftStatus;
    createdAt: string;
    updatedAt: string;
    materializedAt: string | null;
    selectedLots: string[];
    summaryText: string | null;
    generationMetadata: Record<string, unknown>;
    counts: VersionZeroDraftCounts;
  };
  lots: VersionZeroReviewLot[];
};
