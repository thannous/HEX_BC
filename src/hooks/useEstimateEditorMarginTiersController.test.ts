// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/reference-data-client", () => ({
  createMarginTier: vi.fn(),
  updateMarginTier: vi.fn(),
  deleteMarginTier: vi.fn(),
}));

import { useEstimateEditorMarginTiersController } from "@/hooks/useEstimateEditorMarginTiersController";
import { createMarginTier, deleteMarginTier, updateMarginTier } from "@/lib/estimates/reference-data-client";

// Characterises the margin tiers edited from the settings drawer: the saving flag and the error
// around each request, the confirmed and draft settings rewritten with the saved tiers, and a
// document replaced while a request runs.

type Tier = { id: string; threshold_cents: number; multiplier: number };
type Settings = { margin_multiplier: number; margin_tiers?: Tier[] } | null;

const LOW: Tier = { id: "t-low", threshold_cents: 1000, multiplier: 1.3 };
const HIGH: Tier = { id: "t-high", threshold_cents: 9000, multiplier: 1.1 };

function setup() {
  let current = true;
  const confirmed: Settings[] = [];
  const draft: Settings[] = [];
  let confirmedSettings: Settings = { margin_multiplier: 1.2, margin_tiers: [HIGH, LOW] };
  let draftSettings: Settings = { margin_multiplier: 1.4 };
  const editorDocument = {
    isCurrent: vi.fn(() => current),
    transaction: vi.fn((run: () => void) => run()),
    setConfirmedSettings: vi.fn((update: (previous: Settings) => Settings) => {
      confirmedSettings = update(confirmedSettings);
      confirmed.push(confirmedSettings);
    }),
    setDraftSettings: vi.fn((update: (previous: Settings) => Settings) => {
      draftSettings = update(draftSettings);
      draft.push(draftSettings);
    }),
  };
  const { result } = renderHook(() =>
    useEstimateEditorMarginTiersController({ editorDocument: editorDocument as never, documentScope: {} as never })
  );
  return {
    result,
    editorDocument,
    confirmed,
    draft,
    replaceDocument: () => {
      current = false;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(createMarginTier).mockReset();
  vi.mocked(updateMarginTier).mockReset();
  vi.mocked(deleteMarginTier).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorMarginTiersController", () => {
  it("saves a new tier: flag up during the request, settings sorted by threshold, flag down", async () => {
    const harness = setup();
    const request = deferred<Tier>();
    vi.mocked(createMarginTier).mockReturnValue(request.promise as never);

    let saving!: Promise<void>;
    act(() => {
      saving = harness.result.current.createTier({ threshold_cents: 5000, multiplier: 1.2 });
    });
    expect(harness.result.current.isSaving).toBe(true);
    expect(harness.result.current.error).toBeNull();
    expect(createMarginTier).toHaveBeenCalledWith({ threshold_cents: 5000, multiplier: 1.2 });

    await act(async () => {
      request.resolve({ id: "t-mid", threshold_cents: 5000, multiplier: 1.2 });
      await saving;
    });

    expect(harness.result.current.isSaving).toBe(false);
    expect(harness.result.current.error).toBeNull();
    expect(harness.editorDocument.transaction).toHaveBeenCalledOnce();
    expect(harness.confirmed).toEqual([
      { margin_multiplier: 1.2, margin_tiers: [LOW, { id: "t-mid", threshold_cents: 5000, multiplier: 1.2 }, HIGH] },
    ]);
    expect(harness.draft).toEqual([
      { margin_multiplier: 1.4, margin_tiers: [{ id: "t-mid", threshold_cents: 5000, multiplier: 1.2 }] },
    ]);
  });

  it("replaces an updated tier and keeps the tiers sorted by threshold", async () => {
    const harness = setup();
    vi.mocked(updateMarginTier).mockResolvedValue({ id: "t-high", threshold_cents: 500, multiplier: 1.5 } as never);

    await act(() => harness.result.current.updateTier("t-high", { threshold_cents: 500 }));

    expect(updateMarginTier).toHaveBeenCalledWith("t-high", { threshold_cents: 500 });
    expect(harness.confirmed).toEqual([
      { margin_multiplier: 1.2, margin_tiers: [{ id: "t-high", threshold_cents: 500, multiplier: 1.5 }, LOW] },
    ]);
    expect(harness.result.current.isSaving).toBe(false);
  });

  it("removes a deleted tier", async () => {
    const harness = setup();
    vi.mocked(deleteMarginTier).mockResolvedValue(undefined);

    await act(() => harness.result.current.deleteTier("t-high"));

    expect(deleteMarginTier).toHaveBeenCalledWith("t-high");
    expect(harness.confirmed).toEqual([{ margin_multiplier: 1.2, margin_tiers: [LOW] }]);
    expect(harness.draft).toEqual([{ margin_multiplier: 1.4, margin_tiers: [] }]);
    expect(harness.result.current.isSaving).toBe(false);
  });

  it.each([
    { name: "createTier", fallback: "Erreur création tranche.", fail: (error: unknown) =>
      vi.mocked(createMarginTier).mockRejectedValue(error),
    run: (actions: ReturnType<typeof useEstimateEditorMarginTiersController>) =>
      actions.createTier({ threshold_cents: 5000, multiplier: 1.2 }) },
    { name: "updateTier", fallback: "Erreur mise à jour tranche.", fail: (error: unknown) =>
      vi.mocked(updateMarginTier).mockRejectedValue(error),
    run: (actions: ReturnType<typeof useEstimateEditorMarginTiersController>) =>
      actions.updateTier("t-low", { multiplier: 1.6 }) },
    { name: "deleteTier", fallback: "Erreur suppression tranche.", fail: (error: unknown) =>
      vi.mocked(deleteMarginTier).mockRejectedValue(error),
    run: (actions: ReturnType<typeof useEstimateEditorMarginTiersController>) => actions.deleteTier("t-low") },
  ])("$name reports the request's error, or its own words for a non-error", async ({ fallback, fail, run }) => {
    const harness = setup();
    fail(new Error("Refus du serveur."));
    await act(() => run(harness.result.current));
    expect(harness.result.current.error).toBe("Refus du serveur.");
    expect(harness.result.current.isSaving).toBe(false);

    fail("refus");
    await act(() => run(harness.result.current));
    expect(harness.result.current.error).toBe(fallback);
    expect(harness.result.current.isSaving).toBe(false);
    expect(harness.confirmed).toEqual([]);

    act(() => harness.result.current.reset());
    expect(harness.result.current.error).toBeNull();
  });

  it("leaves a replaced document untouched, the saving flag included", async () => {
    const harness = setup();
    const request = deferred<Tier>();
    vi.mocked(createMarginTier).mockReturnValue(request.promise as never);

    let saving!: Promise<void>;
    act(() => {
      saving = harness.result.current.createTier({ threshold_cents: 5000, multiplier: 1.2 });
    });
    harness.replaceDocument();
    await act(async () => {
      request.resolve({ id: "t-mid", threshold_cents: 5000, multiplier: 1.2 });
      await saving;
    });

    expect(harness.editorDocument.transaction).not.toHaveBeenCalled();
    expect(harness.result.current.isSaving).toBe(true);

    vi.mocked(deleteMarginTier).mockRejectedValue(new Error("Refus du serveur."));
    await act(() => harness.result.current.deleteTier("t-low"));
    expect(deleteMarginTier).not.toHaveBeenCalled();
    expect(harness.result.current.error).toBeNull();
  });

  it("drops the error of a request that ends after the document was replaced", async () => {
    const harness = setup();
    const request = deferred<Tier>();
    vi.mocked(updateMarginTier).mockReturnValue(request.promise as never);

    let saving!: Promise<void>;
    act(() => {
      saving = harness.result.current.updateTier("t-low", { multiplier: 1.6 });
    });
    harness.replaceDocument();
    await act(async () => {
      request.reject(new Error("Refus du serveur."));
      await saving;
    });

    expect(harness.result.current.error).toBeNull();
    expect(harness.result.current.isSaving).toBe(true);
  });
});
