"use client";

import { useCallback, useState } from "react";

import type {
  EstimateEditorDocument,
  EstimateEditorDocumentScopeToken,
} from "@/lib/estimates/editor-document-state";
import type { EstimateSettingsState } from "@/lib/estimates/editor-settings-state";
import {
  createMarginTier as createMarginTierClient,
  deleteMarginTier as deleteMarginTierClient,
  updateMarginTier as updateMarginTierClient,
} from "@/lib/estimates/reference-data-client";

/** The tenant's margin tiers, edited from the settings drawer: the document's settings take the confirmed tiers. */
export function useEstimateEditorMarginTiersController({
  editorDocument,
  documentScope,
}: {
  editorDocument: EstimateEditorDocument;
  documentScope: EstimateEditorDocumentScopeToken;
}) {
  const [isSavingMarginTiers, setIsSavingMarginTiers] = useState(false);
  const [marginTiersError, setMarginTiersError] = useState<string | null>(null);
  const resetMarginTiers = useCallback(() => {
    setIsSavingMarginTiers(false);
    setMarginTiersError(null);
  }, []);

  const applyConfirmedMarginTiers = useCallback((update: (
    tiers: NonNullable<EstimateSettingsState["margin_tiers"]>
  ) => NonNullable<EstimateSettingsState["margin_tiers"]>) => {
    if (!editorDocument.isCurrent(documentScope)) return;
    editorDocument.transaction(() => {
      editorDocument.setConfirmedSettings((previous) => previous
        ? { ...previous, margin_tiers: update(previous.margin_tiers ?? []) } : previous);
      editorDocument.setDraftSettings((current) => current
        ? { ...current, margin_tiers: update(current.margin_tiers ?? []) } : current);
    });
  }, [editorDocument, documentScope]);

  /**
   * One request of the drawer: the saving flag and the error around it, its confirmed result
   * applied as soon as it lands, its error (or the fallback words) kept for the current document.
   */
  const runTierSave = useCallback(async <T,>(
    fallbackMessage: string,
    request: () => Promise<T>,
    onSaved: (data: T) => void
  ) => {
    if (!editorDocument.isCurrent(documentScope)) return;
    setMarginTiersError(null);
    setIsSavingMarginTiers(true);
    try {
      onSaved(await request());
    } catch (error) {
      if (!editorDocument.isCurrent(documentScope)) return;
      setMarginTiersError(
        error instanceof Error ? error.message : fallbackMessage
      );
    } finally {
      if (editorDocument.isCurrent(documentScope)) setIsSavingMarginTiers(false);
    }
  }, [editorDocument, documentScope]);

  const handleCreateTier = useCallback(
    (payload: { threshold_cents: number; multiplier: number }) => runTierSave(
      "Erreur création tranche.",
      () => createMarginTierClient(payload),
      (data) => applyConfirmedMarginTiers((tiers) => [...tiers, data].sort((left, right) => left.threshold_cents - right.threshold_cents))
    ),
    [applyConfirmedMarginTiers, runTierSave]
  );

  const handleUpdateTier = useCallback(
    (
      id: string,
      updates: { threshold_cents?: number; multiplier?: number }
    ) => runTierSave(
      "Erreur mise à jour tranche.",
      () => updateMarginTierClient(id, updates),
      (data) => applyConfirmedMarginTiers((tiers) => tiers.map((tier) => tier.id === id ? data : tier)
        .sort((left, right) => left.threshold_cents - right.threshold_cents))
    ),
    [applyConfirmedMarginTiers, runTierSave]
  );

  const handleDeleteTier = useCallback((id: string) => runTierSave(
    "Erreur suppression tranche.",
    () => deleteMarginTierClient(id),
    () => applyConfirmedMarginTiers((tiers) => tiers.filter((tier) => tier.id !== id))
  ), [applyConfirmedMarginTiers, runTierSave]);

  return {
    isSaving: isSavingMarginTiers,
    error: marginTiersError,
    reset: resetMarginTiers,
    createTier: handleCreateTier,
    updateTier: handleUpdateTier,
    deleteTier: handleDeleteTier,
  };
}
