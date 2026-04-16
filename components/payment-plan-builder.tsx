"use client";

import { FormEvent, useMemo, useState } from "react";
import { Plus, Send, Trash2, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FEE_TYPES = [
  "Accommodation Fee",
  "Administration Fee",
  "Airline Ticket",
  "Airport Transfer Fee",
  "Application Fee",
  "Bond",
  "Exam Fee",
  "Date Change Fee",
  "Extension Fee",
  "Extra Fee",
  "FCE Exam Fee",
  "Health Cover",
  "i20 Fee",
  "Instalment Fee",
  "Key Deposit Fee",
  "Late Payment Fee",
  "Material Deposit",
  "Material Fee",
  "Medical Exam",
  "Placement Fee",
  "Security Deposit Fee",
  "Service Fee",
  "Swipe Card Fee",
  "Training Fee",
  "Transaction Fee",
  "Translation Fee",
  "Travel Insurance",
  "Tuition Fee",
  "Visa Counseling",
  "Visa Fee",
  "Visa Process",
  "RMA Fee",
  "Registered Migration Agent Fee",
  "Enrollment Fee"
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Installment = {
  id: string;
  installmentName: string;
  installmentDate: string;
  feeType: string;
  feeAmount: number;
  discount: number;
  discountPercentage: number;
  netFee: number;
  collected_by: "us" | "university";
  fees: FeeLine[];
};

type FeeLine = {
  id: string;
  feeType: string;
  feeAmount: number;
};

type DraftInstallment = {
  installmentName: string;
  installmentDate: string;
  fees: FeeLine[];
  overallDiscountPercentage: number;
  collected_by: "us" | "university";
};

type Props = {
  oppId: string;
  contactId: string;
  isContextLoading: boolean;
  opportunityName: string;
  clientName: string;
  studentEmail: string;
  application: string;
  programOfferId: string;
  xeroCustomerNumber: string;
  xeroTrackingCode: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createEmptyFeeLine = (): FeeLine => ({
  id: crypto.randomUUID(),
  feeType: "",
  feeAmount: 0
});

const createEmptyDraft = (): DraftInstallment => ({
  installmentName: "",
  installmentDate: "",
  fees: [createEmptyFeeLine()],
  overallDiscountPercentage: 0,
  collected_by: "us"
});

const currency = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const fmt = (n: number) => `$${currency.format(n)}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PaymentPlanBuilder({
  oppId,
  contactId,
  isContextLoading,
  opportunityName,
  clientName,
  studentEmail,
  application,
  programOfferId,
  xeroCustomerNumber,
  xeroTrackingCode
}: Props) {
  // --- Installments ---
  const [isModalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftInstallment>(createEmptyDraft);
  const [installments, setInstallments] = useState<Installment[]>([]);

  // --- Deposit ---
  const [hasDeposit, setHasDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositDue, setDepositDue] = useState("");
  const [depositCollectedBy, setDepositCollectedBy] = useState<"us" | "university">("us");

  // --- Commission ---
  const [commissionPct, setCommissionPct] = useState(0);

  // --- UI state ---
  const [isSubmitting, setSubmitting] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [responseMessage, setResponseMessage] = useState("");

  // ---------------------------------------------------------------------------
  // Derived totals
  // ---------------------------------------------------------------------------

  const installmentTotals = useMemo(() => {
    const grossFeeFromInstallments = installments.reduce((s, i) => s + i.feeAmount, 0);
    const discountFromInstallments = installments.reduce((s, i) => s + i.discount, 0);
    const netFromInstallments = installments.reduce((s, i) => s + i.netFee, 0);
    return { grossFeeFromInstallments, discountFromInstallments, netFromInstallments };
  }, [installments]);

  const planTotals = useMemo(() => {
    const depositGross = hasDeposit ? depositAmount : 0;
    const grossFee = installmentTotals.grossFeeFromInstallments + depositGross;
    const discountAmount = installmentTotals.discountFromInstallments;
    const netFee = installmentTotals.netFromInstallments + depositGross;
    const commissionAmount = Math.round(netFee * Math.max(0, commissionPct) * 10) / 1000;
    const universityPortion = Math.max(0, Math.round((netFee - commissionAmount) * 100) / 100);
    return { grossFee, discountAmount, netFee, commissionAmount, universityPortion };
  }, [installmentTotals, hasDeposit, depositAmount, commissionPct]);

  const draftTotals = useMemo(() => {
    const feeAmount = draft.fees.reduce((s, f) => s + Number(f.feeAmount || 0), 0);
    const discount = Math.max(0, (feeAmount * Number(draft.overallDiscountPercentage || 0)) / 100);
    return {
      feeAmount,
      discount,
      netFee: Math.max(0, feeAmount - discount),
      discountPercentage: feeAmount > 0 ? (discount / feeAmount) * 100 : 0
    };
  }, [draft.fees, draft.overallDiscountPercentage]);

  // ---------------------------------------------------------------------------
  // Draft handlers
  // ---------------------------------------------------------------------------

  const updateDraft = (
    field: keyof DraftInstallment,
    value: string | number | FeeLine[] | "us" | "university"
  ) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateFeeLine = (
    id: string,
    field: keyof Omit<FeeLine, "id">,
    value: string | number
  ) => {
    setDraft((prev) => ({
      ...prev,
      fees: prev.fees.map((f) => (f.id === id ? { ...f, [field]: value } : f))
    }));
  };

  const addFeeLine = () => {
    setDraft((prev) => {
      if (prev.fees.length >= 10) return prev;
      return { ...prev, fees: [...prev.fees, createEmptyFeeLine()] };
    });
  };

  const removeFeeLine = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      fees: prev.fees.length === 1 ? prev.fees : prev.fees.filter((f) => f.id !== id)
    }));
  };

  // ---------------------------------------------------------------------------
  // Add / remove installments
  // ---------------------------------------------------------------------------

  const addInstallment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft.installmentName || !draft.installmentDate) {
      setResponseMessage("Please fill in installment name and date before adding.");
      return;
    }
    if (draft.fees.some((f) => !f.feeType)) {
      setResponseMessage("Please select a fee type for every fee line.");
      return;
    }

    const row: Installment = {
      id: crypto.randomUUID(),
      installmentName: draft.installmentName.trim(),
      installmentDate: draft.installmentDate,
      feeType: draft.fees.length === 1 ? draft.fees[0].feeType : `${draft.fees.length} Fees`,
      feeAmount: draftTotals.feeAmount,
      discount: draftTotals.discount,
      discountPercentage: draftTotals.discountPercentage,
      netFee: draftTotals.netFee,
      collected_by: draft.collected_by,
      fees: draft.fees
    };

    setInstallments((prev) => [...prev, row]);
    setDraft(createEmptyDraft());
    setResponseMessage("");
    setModalOpen(false);
  };

  const removeInstallment = (id: string) => {
    setInstallments((prev) => prev.filter((i) => i.id !== id));
  };

  // ---------------------------------------------------------------------------
  // Submit — Generate & Send
  // ---------------------------------------------------------------------------

  const generateAndSend = async () => {
    if (!oppId || !contactId) {
      setResponseMessage("Missing opp_id or contact_id in URL parameters.");
      return;
    }
    if (installments.length === 0) {
      setResponseMessage("Please add at least one installment.");
      return;
    }
    if (hasDeposit && (!depositAmount || !depositDue)) {
      setResponseMessage("Please fill in deposit amount and due date.");
      return;
    }

    try {
      setSubmitting(true);
      setResponseMessage("");

      const response = await fetch("/api/process-payment-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opp_id: oppId,
          contact_id: contactId,
          // Section A
          xero_customer_number: xeroCustomerNumber,
          program_offer_id: programOfferId,
          xero_tracking_code: xeroTrackingCode,
          // Section B
          commission_pct: commissionPct,
          // Section C
          deposit:
            hasDeposit && depositAmount > 0
              ? { amount: depositAmount, due: depositDue, collected_by: depositCollectedBy }
              : null,
          // Section D
          installments
        })
      });

      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to process payment plan.");
      setResponseMessage(data.message || "Payment plan processed successfully.");
    } catch (error) {
      setResponseMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Download PDF
  // ---------------------------------------------------------------------------

  const downloadPdf = async () => {
    if (!oppId || !contactId) {
      setResponseMessage("Missing opp_id or contact_id in URL parameters.");
      return;
    }
    if (installments.length === 0) {
      setResponseMessage("Please add at least one installment.");
      return;
    }

    try {
      setDownloading(true);
      setResponseMessage("");
      const response = await fetch("/api/payment-plan-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opp_id: oppId,
          contact_id: contactId,
          deposit:
            hasDeposit && depositAmount > 0
              ? { amount: depositAmount, due: depositDue, collected_by: depositCollectedBy }
              : null,
          installments
        })
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to generate PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `payment-plan-${oppId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setResponseMessage("PDF downloaded successfully.");
    } catch (error) {
      setResponseMessage(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const loading = isContextLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-5">

      {/* ── Header card ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-7">
        <div className="mb-5 border-b border-slate-200 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
            Payment Schedule
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Opportunity:{" "}
            <span className="font-medium">
              {loading ? "Loading…" : opportunityName || oppId || "-"}
            </span>
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <CtxField label="Student" value={loading ? "Loading…" : clientName || "-"} />
          <CtxField label="Email" value={loading ? "Loading…" : studentEmail || "-"} />
          <CtxField label="Xero Customer #" value={loading ? "Loading…" : xeroCustomerNumber || "-"} />
          <CtxField label="Xero Tracking Code" value={loading ? "Loading…" : xeroTrackingCode || "-"} />
          <CtxField
            label="Application / Program Offer"
            value={loading ? "Loading…" : application || "-"}
            className="sm:col-span-2"
          />
          <CtxField
            label="Program Offer ID"
            value={loading ? "Loading…" : programOfferId || "-"}
            className="sm:col-span-2"
          />
        </div>
      </div>

      {/* ── Deposit card ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-7">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Deposit</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={hasDeposit}
              onChange={(e) => setHasDeposit(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-sky-500"
            />
            Include deposit
          </label>
        </div>

        {hasDeposit ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Amount *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={depositAmount || ""}
                onChange={(e) => setDepositAmount(Math.max(0, Number(e.target.value)))}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Due Date *
              </label>
              <input
                type="date"
                value={depositDue}
                onChange={(e) => setDepositDue(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Collected By
              </label>
              <CollectedByToggle value={depositCollectedBy} onChange={setDepositCollectedBy} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            No deposit — tick the checkbox above to add one.
          </p>
        )}
      </div>

      {/* ── Plan financials card ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-7">
        <h2 className="mb-4 text-base font-semibold text-slate-800">Plan Financials</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Gross Fee" value={planTotals.grossFee} />
          <SummaryCard label="Discount" value={planTotals.discountAmount} />
          <SummaryCard label="Net Fee" value={planTotals.netFee} highlight />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Commission %
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={commissionPct || ""}
              onChange={(e) =>
                setCommissionPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
              }
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
              placeholder="0"
            />
          </div>
          <SummaryCard label="Commission Amount" value={planTotals.commissionAmount} />
          <SummaryCard label="University Portion" value={planTotals.universityPortion} />
        </div>
      </div>

      {/* ── Installments card ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-7">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Installments</h2>
          <button
            type="button"
            onClick={() => { setDraft(createEmptyDraft()); setModalOpen(true); }}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600"
          >
            <Plus size={16} />
            Add Installment
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-sky-500/95 text-white">
              <tr>
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">INSTALLMENT</th>
                <th className="px-4 py-3 font-semibold">FEE TYPE</th>
                <th className="px-4 py-3 font-semibold">FEE</th>
                <th className="px-4 py-3 font-semibold">DISCOUNT</th>
                <th className="px-4 py-3 font-semibold">NET FEE</th>
                <th className="px-4 py-3 font-semibold">COLLECTED BY</th>
                <th className="px-4 py-3 font-semibold">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {installments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No installments added yet.
                  </td>
                </tr>
              ) : (
                installments.map((item, index) => (
                  <tr key={item.id} className="border-t border-slate-200/90 hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-700">{index + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sky-700">{item.installmentName}</p>
                      <p className="text-slate-500">{item.installmentDate}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <p>{item.feeType}</p>
                      {item.fees.length > 1 && (
                        <p className="text-xs text-slate-500">
                          {item.fees.map((f) => f.feeType).join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{fmt(item.feeAmount)}</td>
                    <td className="px-4 py-3">
                      {item.discountPercentage.toFixed(2)}% ({fmt(item.discount)})
                    </td>
                    <td className="px-4 py-3 font-medium">{fmt(item.netFee)}</td>
                    <td className="px-4 py-3">
                      <CollectedByBadge value={item.collected_by} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => removeInstallment(item.id)}
                        className="inline-flex items-center rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-500"
                        aria-label="Delete row"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-col items-start justify-between gap-4 border-t border-slate-200 pt-5 md:flex-row md:items-center">
          <div className="space-y-1 text-sm text-slate-700">
            <p>Net Fee: <span className="font-semibold">{fmt(planTotals.netFee)}</span></p>
            <p>Commission ({commissionPct}%): <span className="font-semibold">{fmt(planTotals.commissionAmount)}</span></p>
            <p>University Portion: <span className="font-semibold">{fmt(planTotals.universityPortion)}</span></p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={downloadPdf}
              disabled={isDownloading || isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDownloading ? "Downloading…" : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={generateAndSend}
              disabled={isSubmitting || isDownloading}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              <Send size={16} />
              {isSubmitting ? "Processing…" : "Generate & Send"}
            </button>
          </div>
        </div>

        {responseMessage && (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {responseMessage}
          </p>
        )}
      </div>

      {/* ── Add installment modal ───────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-3 md:p-5">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl md:p-6">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-800">
                Add Installment
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={addInstallment} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <ReadOnlyInput
                  label="Client Name"
                  value={loading ? "Loading…" : clientName || "-"}
                />
                <ReadOnlyInput
                  label="Application"
                  value={loading ? "Loading…" : application || "-"}
                />

                <Input
                  label="Installment Name"
                  required
                  value={draft.installmentName}
                  onChange={(v) => updateDraft("installmentName", v)}
                />
                <Input
                  label="Installment Date"
                  required
                  type="date"
                  value={draft.installmentDate}
                  onChange={(v) => updateDraft("installmentDate", v)}
                />

                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Collected By
                  </label>
                  <CollectedByToggle
                    value={draft.collected_by}
                    onChange={(v) => updateDraft("collected_by", v)}
                  />
                </div>

                {/* Fee lines */}
                <div className="md:col-span-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Fees</p>
                      <p className="text-xs text-slate-500">Up to 10 fee items.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addFeeLine}
                      disabled={draft.fees.length >= 10}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus size={14} />
                      Add another fee
                    </button>
                  </div>

                  {draft.fees.map((fee, index) => (
                    <div
                      key={fee.id}
                      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-12"
                    >
                      <div className="md:col-span-6">
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Fee Type{index === 0 ? " *" : ""}
                        </label>
                        <select
                          value={fee.feeType}
                          onChange={(e) => updateFeeLine(fee.id, "feeType", e.target.value)}
                          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
                          required={index === 0}
                        >
                          <option value="">Select fee type</option>
                          {FEE_TYPES.map((ft) => (
                            <option key={ft} value={ft}>{ft}</option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-4">
                        <Input
                          label="Fee Amount"
                          required={index === 0}
                          type="number"
                          value={String(fee.feeAmount)}
                          onChange={(v) => updateFeeLine(fee.id, "feeAmount", Number(v))}
                        />
                      </div>

                      <div className="md:col-span-2 flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => removeFeeLine(fee.id)}
                          className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500"
                          aria-label="Remove fee row"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="md:col-span-2">
                  <Input
                    label="Overall Discount %"
                    type="number"
                    value={String(draft.overallDiscountPercentage)}
                    onChange={(v) =>
                      updateDraft(
                        "overallDiscountPercentage",
                        Math.min(100, Math.max(0, Number(v) || 0))
                      )
                    }
                  />
                </div>

                <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-500">
                    Total Fee:{" "}
                    <span className="font-semibold text-slate-700">{fmt(draftTotals.feeAmount)}</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    Discount:{" "}
                    <span className="font-semibold text-slate-700">
                      {draftTotals.discountPercentage.toFixed(2)}% ({fmt(draftTotals.discount)})
                    </span>
                  </p>
                  <p className="text-2xl font-semibold text-sky-600">{fmt(draftTotals.netFee)}</p>
                </div>
              </div>

              <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg bg-slate-400 px-4 py-2 font-semibold text-white transition hover:bg-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-white transition hover:bg-sky-600"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  highlight
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        highlight ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight ${
          highlight ? "text-sky-700" : "text-slate-800"
        }`}
      >
        {fmt(value)}
      </p>
    </div>
  );
}

function CtxField({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

function CollectedByToggle({
  value,
  onChange
}: {
  value: "us" | "university";
  onChange: (v: "us" | "university") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
      <button
        type="button"
        onClick={() => onChange("us")}
        className={`px-4 py-2 text-sm font-semibold transition ${
          value === "us" ? "bg-sky-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        The Migration
      </button>
      <button
        type="button"
        onClick={() => onChange("university")}
        className={`border-l border-slate-300 px-4 py-2 text-sm font-semibold transition ${
          value === "university"
            ? "bg-sky-500 text-white"
            : "bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        University
      </button>
    </div>
  );
}

function CollectedByBadge({ value }: { value: "us" | "university" }) {
  return value === "university" ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      University
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
      The Migration
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}{required ? " *" : ""}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
      />
    </div>
  );
}

function ReadOnlyInput({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</label>
      <input
        type="text"
        value={value}
        readOnly
        className="h-11 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600 outline-none"
      />
    </div>
  );
}
