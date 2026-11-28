// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/reference-data-client", () => ({
  createEstimateLaborRole: vi.fn(),
  updateEstimateLaborRole: vi.fn(),
}));

vi.mock("@/lib/estimates/v3-editor-writer", () => ({
  recomputeEstimateV3AfterLaborRate: vi.fn(),
}));

import { useEstimateEditorLaborRolesController } from "@/hooks/useEstimateEditorLaborRolesController";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { createEstimateLaborRole, updateEstimateLaborRole } from "@/lib/estimates/reference-data-client";
import { recomputeEstimateV3AfterLaborRate } from "@/lib/estimates/v3-editor-writer";

// Characterises the labor roles edited from the settings drawer: the refusals met before any
// request, in their order, the role list after a creation, and the v1/v2 repricing of the lines of
// a role whose hourly rate changed (the lines merged back by id, then their writes queued in order).

type Item = Record<string, unknown> & { id: string };
type Input = Parameters<typeof useEstimateEditorLaborRolesController>[0];

const ROLE_ID = "role-r";
const OTHER_ROLE_ID = "role-o";

function line(id: string, overrides: Record<string, unknown> = {}): Item {
  return {
    id,
    item_type: "line",
    title: `Ligne ${id}`,
    labor_role_id: ROLE_ID,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 2,
    h_mo_majoration: null,
    k_mo: 1,
    pu_ht_cents: 0,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: 0,
    line_tax_cents: 0,
    line_total_ttc_cents: 0,
    ...overrides,
  };
}

function setup(overrides: Partial<Input> = {}, items: Item[] = []) {
  const setActionError = vi.fn();
  const setLaborRoles = vi.fn();
  const setItems = vi.fn();
  const enqueueBufferedItemUpdate = vi.fn();
  const computeLineValuesWithLaborContext = vi.fn(
    (item: Item, options: { taxRateBp: number; hourlyRateCents: number }) => ({
      lineInput: { tax_rate_bp: options.taxRateBp, k_fo: 1.1, h_mo: item.h_mo, k_mo: 1.2 },
      lineValues: {
        puHtCents: options.hourlyRateCents + Number(item.quantity),
        saleLineCents: options.hourlyRateCents * Number(item.quantity),
        taxLineCents: 7,
        ttcLineCents: 11,
      },
    })
  );
  const isCurrent = vi.fn(() => true);
  const input = {
    editorDocument: { isCurrent } as never,
    documentScope: {} as never,
    settingsSaveGuardRef: { current: { isBlocked: false, message: "Réglages en cours d'enregistrement." } },
    isReadOnly: false,
    readOnlyActionErrorMessage: "Lecture seule.",
    isConflictLocked: false,
    conflictState: null,
    profile: { id: "user-1" } as never,
    laborRoles: [
      { id: ROLE_ID, position: 4 },
      { id: OTHER_ROLE_ID, position: 2 },
    ] as never,
    setLaborRoles,
    version: { id: "version-1", updated_at: "2026-11-01T10:00:00.000Z" } as never,
    getVersionSnapshot: () => null,
    itemsRef: { current: items } as never,
    setItems,
    isV3: false,
    settings: { tax_rate_bp: 2000, margin_multiplier: 1.25, contractor_role: "subcontractor" } as never,
    computeLineValuesWithLaborContext: computeLineValuesWithLaborContext as never,
    enqueueBufferedItemUpdate,
    setActionError,
    ...overrides,
  } satisfies Input;
  const { result } = renderHook(() => useEstimateEditorLaborRolesController(input));
  return {
    result,
    isCurrent,
    setActionError,
    setLaborRoles,
    setItems,
    enqueueBufferedItemUpdate,
    computeLineValuesWithLaborContext,
  };
}

beforeEach(() => {
  vi.mocked(createEstimateLaborRole).mockReset();
  vi.mocked(updateEstimateLaborRole).mockReset();
  vi.mocked(updateEstimateLaborRole).mockResolvedValue(undefined);
  vi.mocked(recomputeEstimateV3AfterLaborRate).mockReset();
});

afterEach(() => {
  cleanup();
});

const HANDLERS = [
  { name: "createRole", run: (actions: ReturnType<typeof useEstimateEditorLaborRolesController>) =>
    actions.createRole({ name: "Chef", hourly_rate_cents: 5200 }) },
  { name: "updateRole", run: (actions: ReturnType<typeof useEstimateEditorLaborRolesController>) =>
    actions.updateRole(ROLE_ID, { hourly_rate_cents: 5200 }) },
];

describe.each(HANDLERS)("$name refusals", ({ run }) => {
  it("does nothing for a document that is no longer current", async () => {
    const harness = setup();
    harness.isCurrent.mockReturnValue(false);

    await act(() => run(harness.result.current));

    expect(harness.setActionError).not.toHaveBeenCalled();
    expect(createEstimateLaborRole).not.toHaveBeenCalled();
    expect(updateEstimateLaborRole).not.toHaveBeenCalled();
  });

  it("puts the settings save guard before read-only, and read-only before the conflict", async () => {
    const all = setup({
      settingsSaveGuardRef: { current: { isBlocked: true, message: "Réglages en cours d'enregistrement." } },
      isReadOnly: true,
      isConflictLocked: true,
      conflictState: { message: "Conflit de version." } as never,
    });
    await act(() => run(all.result.current));
    expect(all.setActionError.mock.calls).toEqual([[null], ["Réglages en cours d'enregistrement."]]);

    const readOnly = setup({
      isReadOnly: true,
      isConflictLocked: true,
      conflictState: { message: "Conflit de version." } as never,
    });
    await act(() => run(readOnly.result.current));
    expect(readOnly.setActionError.mock.calls).toEqual([[null], ["Lecture seule."]]);

    const conflict = setup({ isConflictLocked: true, conflictState: { message: "Conflit de version." } as never });
    await act(() => run(conflict.result.current));
    expect(conflict.setActionError.mock.calls).toEqual([[null], ["Conflit de version."]]);

    const defaultConflict = setup({ isConflictLocked: true, conflictState: null });
    await act(() => run(defaultConflict.result.current));
    expect(defaultConflict.setActionError.mock.calls).toEqual([[null], [ESTIMATE_VERSION_CONFLICT_MESSAGE]]);

    expect(createEstimateLaborRole).not.toHaveBeenCalled();
    expect(updateEstimateLaborRole).not.toHaveBeenCalled();
  });

  it("refuses without a version", async () => {
    const harness = setup({ version: null });

    await act(() => run(harness.result.current));

    expect(harness.setActionError.mock.calls).toEqual([[null], ["Version introuvable."]]);
  });
});

describe("createRole", () => {
  it("asks for the profile before the version", async () => {
    const harness = setup({ profile: null, version: null });

    await act(() => harness.result.current.createRole({ name: "Chef", hourly_rate_cents: 5200 }));

    expect(harness.setActionError.mock.calls).toEqual([[null], ["Impossible de charger votre profil."]]);
  });

  it("creates the role after the last position and keeps the roles sorted by position", async () => {
    const harness = setup();
    vi.mocked(createEstimateLaborRole).mockResolvedValue({ id: "role-new", position: 5 } as never);

    await act(() => harness.result.current.createRole({ name: "Chef", hourly_rate_cents: 5200 }));

    expect(createEstimateLaborRole).toHaveBeenCalledWith("version-1", {
      name: "Chef",
      hourly_rate_cents: 5200,
      is_active: true,
      position: 5,
    });
    const update = harness.setLaborRoles.mock.calls[0]![0] as (roles: unknown[]) => unknown[];
    expect(update([{ id: "a", position: 3 }, { id: "b", position: 1 }])).toEqual([
      { id: "b", position: 1 },
      { id: "a", position: 3 },
      { id: "role-new", position: 5 },
    ]);
  });

  it("reports a failed creation", async () => {
    const harness = setup();
    vi.mocked(createEstimateLaborRole).mockRejectedValue("refus");

    await act(() => harness.result.current.createRole({ name: "Chef", hourly_rate_cents: 5200 }));

    expect(harness.setActionError.mock.calls).toEqual([[null], ["Impossible de créer le rôle."]]);
    expect(harness.setLaborRoles).not.toHaveBeenCalled();
  });
});

describe("updateRole", () => {
  it("reports a failed update", async () => {
    const harness = setup();
    vi.mocked(updateEstimateLaborRole).mockRejectedValue(new Error("Taux refusé."));

    await act(() => harness.result.current.updateRole(ROLE_ID, { hourly_rate_cents: 5200 }));

    expect(harness.setActionError.mock.calls).toEqual([[null], ["Taux refusé."]]);
    expect(harness.setLaborRoles).not.toHaveBeenCalled();
  });

  it("merges the repriced lines back by id, first repricing of an id first, then queues their writes", async () => {
    const items = [
      { id: "s1", item_type: "section", title: "Section" },
      line("a", { quantity: 1 }),
      line("b", { labor_role_id: OTHER_ROLE_ID }),
      line("c", { quantity: 3, tax_rate_bp: 550 }),
      line("a", { quantity: 5 }),
    ];
    const harness = setup({}, items);

    await act(() => harness.result.current.updateRole(ROLE_ID, { hourly_rate_cents: 5200 }));

    expect(updateEstimateLaborRole).toHaveBeenCalledWith("version-1", ROLE_ID, { hourly_rate_cents: 5200 });
    const updateRoles = harness.setLaborRoles.mock.calls[0]![0] as (roles: unknown[]) => unknown[];
    expect(updateRoles([{ id: ROLE_ID, hourly_rate_cents: 4000 }, { id: OTHER_ROLE_ID, hourly_rate_cents: 3000 }]))
      .toEqual([{ id: ROLE_ID, hourly_rate_cents: 5200 }, { id: OTHER_ROLE_ID, hourly_rate_cents: 3000 }]);
    expect(harness.computeLineValuesWithLaborContext.mock.calls.map(([item, options]) => [item.id, options])).toEqual([
      ["a", { marginMultiplier: 1.25, taxRateBp: 2000, rateOverrideByRoleId: ROLE_ID, hourlyRateCents: 5200, vatReverseCharge: true }],
      ["c", { marginMultiplier: 1.25, taxRateBp: 2000, rateOverrideByRoleId: ROLE_ID, hourlyRateCents: 5200, vatReverseCharge: true }],
      ["a", { marginMultiplier: 1.25, taxRateBp: 2000, rateOverrideByRoleId: ROLE_ID, hourlyRateCents: 5200, vatReverseCharge: true }],
    ]);

    const repriced = (source: Item, quantity: number) => ({
      ...source,
      tax_rate_bp: 2000,
      k_fo: 1.1,
      h_mo: 2,
      k_mo: 1.2,
      pu_ht_cents: 5200 + quantity,
      line_total_ht_cents: 5200 * quantity,
      line_tax_cents: 7,
      line_total_ttc_cents: 11,
    });
    // The editor state when the update lands: another order, a line the snapshot did not have, and
    // a section sharing a repriced id.
    const previous = [
      line("c", { quantity: 3, tax_rate_bp: 550 }),
      { id: "a", item_type: "section", title: "Section homonyme" },
      line("a", { quantity: 1 }),
      line("d"),
      line("a", { quantity: 5 }),
      line("b", { labor_role_id: OTHER_ROLE_ID }),
    ];
    const merge = harness.setItems.mock.calls[0]![0] as (items: Item[]) => Item[];
    expect(merge(previous)).toEqual([
      repriced(line("c", { quantity: 3, tax_rate_bp: 550 }), 3),
      { id: "a", item_type: "section", title: "Section homonyme" },
      repriced(line("a", { quantity: 1 }), 1),
      line("d"),
      repriced(line("a", { quantity: 1 }), 1),
      line("b", { labor_role_id: OTHER_ROLE_ID }),
    ]);
    expect(harness.setItems).toHaveBeenCalledOnce();

    expect(harness.enqueueBufferedItemUpdate.mock.calls.map(([id, payload]) => [id, payload.pu_ht_cents, payload.line_total_ht_cents]))
      .toEqual([
        ["a", 5201, 5200],
        ["c", 5203, 15600],
        ["a", 5205, 26000],
      ]);
    expect(harness.enqueueBufferedItemUpdate.mock.calls[1]![1]).toMatchObject({
      title: "Ligne c",
      tax_rate_bp: 2000,
      k_fo: 1.1,
      k_mo: 1.2,
      labor_role_id: ROLE_ID,
      line_tax_cents: 7,
      line_total_ttc_cents: 11,
    });
    expect(recomputeEstimateV3AfterLaborRate).not.toHaveBeenCalled();
  });

  it("reprices nothing when no line uses the role or when the rate is unchanged", async () => {
    const noLine = setup({}, [line("b", { labor_role_id: OTHER_ROLE_ID })]);
    await act(() => noLine.result.current.updateRole(ROLE_ID, { hourly_rate_cents: 5200 }));
    expect(noLine.setItems).not.toHaveBeenCalled();
    expect(noLine.enqueueBufferedItemUpdate).not.toHaveBeenCalled();

    const renamed = setup({}, [line("a")]);
    await act(() => renamed.result.current.updateRole(ROLE_ID, { name: "Compagnon" }));
    expect(renamed.setLaborRoles).toHaveBeenCalledOnce();
    expect(renamed.setItems).not.toHaveBeenCalled();
  });

  it("recomputes a v3 version through the v3 writer instead of repricing in the editor", async () => {
    const items = [line("a")];
    const harness = setup(
      { isV3: true, getVersionSnapshot: () => ({ id: "version-1", updated_at: "2026-11-02T10:00:00.000Z" }) as never },
      items
    );
    vi.mocked(recomputeEstimateV3AfterLaborRate).mockReturnValue(Promise.reject(new Error("Calcul refusé.")));

    await act(() => harness.result.current.updateRole(ROLE_ID, { hourly_rate_cents: 5200 }));

    expect(recomputeEstimateV3AfterLaborRate).toHaveBeenCalledWith(
      "version-1",
      "2026-11-02T10:00:00.000Z",
      items,
      ROLE_ID
    );
    expect(harness.setActionError.mock.calls).toEqual([
      [null],
      ["Le taux horaire est enregistré, mais les montants du devis n'ont pas été recalculés : Calcul refusé."],
    ]);
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.enqueueBufferedItemUpdate).not.toHaveBeenCalled();
  });
});
