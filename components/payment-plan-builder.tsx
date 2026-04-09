"use client";

import { FormEvent, useMemo, useState } from "react";
import { Plus, Send, Trash2, X } from "lucide-react";

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

export type Installment = {
  id: string;
  installmentName: string;
  installmentDate: string;
  feeType: string;
  feeAmount: number;
  discount: number;
  discountPercentage: number;
  netFee: number;
  fees: FeeLine[];
};

type Props = {
  oppId: string;
  contactId: string;
  opportunityName: string;
  clientName: string;
  application: string;
  isContextLoading: boolean;
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
};

const createEmptyFeeLine = (): FeeLine => ({
  id: crypto.randomUUID(),
  feeType: "",
  feeAmount: 0
});

const createEmptyDraft = (): DraftInstallment => ({
  installmentName: "",
  installmentDate: "",
  fees: [createEmptyFeeLine()],
  overallDiscountPercentage: 0
});

const currency = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export default function PaymentPlanBuilder({
  oppId,
  contactId,
  opportunityName,
  clientName,
  application,
  isContextLoading
}: Props) {
  const [isModalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftInstallment>(createEmptyDraft());
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [responseMessage, setResponseMessage] = useState("");

  const totals = useMemo(() => {
    const overallFee = installments.reduce((sum, item) => sum + item.feeAmount, 0);
    const overallDiscount = installments.reduce((sum, item) => sum + item.discount, 0);
    const overallDiscountPercentage = overallFee > 0 ? (overallDiscount / overallFee) * 100 : 0;
    return { overallFee, overallDiscount, overallDiscountPercentage };
  }, [installments]);

  const draftTotals = useMemo(() => {
    const feeAmount = draft.fees.reduce((sum, fee) => sum + Number(fee.feeAmount || 0), 0);
    const discount = Math.max(0, (feeAmount * Number(draft.overallDiscountPercentage || 0)) / 100);
    return {
      feeAmount,
      discount,
      netFee: Math.max(0, feeAmount - discount),
      discountPercentage: feeAmount > 0 ? (discount / feeAmount) * 100 : 0
    };
  }, [draft.fees, draft.overallDiscountPercentage]);

  const updateDraft = (field: keyof DraftInstallment, value: string | number | FeeLine[]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateFeeLine = (id: string, field: keyof Omit<FeeLine, "id">, value: string | number) => {
    setDraft((prev) => ({
      ...prev,
      fees: prev.fees.map((fee) => (fee.id === id ? { ...fee, [field]: value } : fee))
    }));
  };

  const addFeeLine = () => {
    setDraft((prev) => {
      if (prev.fees.length >= 10) {
        return prev;
      }
      return { ...prev, fees: [...prev.fees, createEmptyFeeLine()] };
    });
  };

  const removeFeeLine = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      fees: prev.fees.length === 1 ? prev.fees : prev.fees.filter((fee) => fee.id !== id)
    }));
  };

  const addInstallment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft.installmentName || !draft.installmentDate) {
      setResponseMessage("Please fill in installment name and date before adding.");
      return;
    }

    const hasInvalidFee = draft.fees.some((fee) => !fee.feeType);
    if (hasInvalidFee) {
      setResponseMessage("Please select a fee type for every fee line.");
      return;
    }

    const feeAmount = draftTotals.feeAmount;
    const discount = draftTotals.discount;

    const row: Installment = {
      id: crypto.randomUUID(),
      installmentName: draft.installmentName.trim(),
      installmentDate: draft.installmentDate,
      feeType: draft.fees.length === 1 ? draft.fees[0].feeType : `${draft.fees.length} Fees`,
      feeAmount,
      discount,
      discountPercentage: draftTotals.discountPercentage,
      netFee: draftTotals.netFee,
      fees: draft.fees
    };

    setInstallments((prev) => [...prev, row]);
    setDraft(createEmptyDraft());
    setResponseMessage("");
    setModalOpen(false);
  };

  const removeInstallment = (id: string) => {
    setInstallments((prev) => prev.filter((item) => item.id !== id));
  };

  const generateAndSend = async () => {
    if (!oppId || !contactId) {
      setResponseMessage("Missing opp_id or contact_id in URL parameters.");
      return;
    }

    if (installments.length === 0) {
      setResponseMessage("Please add at least one installment.");
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
          installments
        })
      });

      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to process payment plan.");
      }

      setResponseMessage(data.message || "Payment plan processed successfully.");
    } catch (error) {
      setResponseMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-7">
      <div className="mb-7 flex flex-col items-start justify-between gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Payment Schedule</h1>
          <p className="mt-1 text-sm text-slate-500">
            Opportunity:{" "}
            <span className="font-medium">
              {isContextLoading ? "Loading..." : opportunityName || oppId || "-"}
            </span>{" "}
            | Contact:{" "}
            <span className="font-medium">
              {isContextLoading ? "Loading..." : clientName || contactId || "-"}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600"
        >
          <Plus size={18} />
          Add Schedule
        </button>
      </div>

      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Scheduled" value={totals.overallFee} />
        <SummaryCard label="Discount" value={totals.overallDiscount} />
        <SummaryCard label="Pending" value={Math.max(0, totals.overallFee - totals.overallDiscount)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-sky-500/95 text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">ID</th>
              <th className="px-4 py-3 font-semibold">INSTALLMENT</th>
              <th className="px-4 py-3 font-semibold">FEE TYPE</th>
              <th className="px-4 py-3 font-semibold">FEE</th>
              <th className="px-4 py-3 font-semibold">DISCOUNT</th>
              <th className="px-4 py-3 font-semibold">NET FEE</th>
              <th className="px-4 py-3 font-semibold">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {installments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
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
                    {item.fees.length > 1 ? (
                      <p className="text-xs text-slate-500">{item.fees.map((fee) => fee.feeType).join(", ")}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{currency.format(item.feeAmount)}</td>
                  <td className="px-4 py-3">
                    {item.discountPercentage.toFixed(2)}% ({currency.format(item.discount)})
                  </td>
                  <td className="px-4 py-3">{currency.format(item.netFee)}</td>
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

      <div className="mt-7 flex flex-col items-start justify-between gap-4 border-t border-slate-200 pt-5 md:flex-row md:items-center">
        <div className="space-y-1 text-sm text-slate-700">
          <p>
            Overall Fee: <span className="font-semibold">{currency.format(totals.overallFee)}</span>
          </p>
          <p>
            Overall Discount:{" "}
            <span className="font-semibold">{currency.format(totals.overallDiscount)}</span>
          </p>
          <p>
            Overall Discount %:{" "}
            <span className="font-semibold">{totals.overallDiscountPercentage.toFixed(2)}%</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={downloadPdf}
            disabled={isDownloading || isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDownloading ? "Downloading..." : "Download"}
          </button>
          <button
            type="button"
            onClick={generateAndSend}
            disabled={isSubmitting || isDownloading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            <Send size={16} />
            {isSubmitting ? "Processing..." : "Generate & Send"}
          </button>
        </div>
      </div>

      {responseMessage ? <p className="mt-4 text-sm text-slate-600">{responseMessage}</p> : null}

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-3 md:p-5">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl md:p-6">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-800">Add Payment Schedule</h2>
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
                  value={isContextLoading ? "Loading..." : clientName || "-"}
                />

                <ReadOnlyInput
                  label="Application"
                  value={isContextLoading ? "Loading..." : application || "-"}
                />

                <Input
                  label="Installment Name"
                  required
                  value={draft.installmentName}
                  onChange={(value) => updateDraft("installmentName", value)}
                />

                <Input
                  label="Installment Date"
                  required
                  type="date"
                  value={draft.installmentDate}
                  onChange={(value) => updateDraft("installmentDate", value)}
                />

                <div className="md:col-span-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Fees</p>
                      <p className="text-xs text-slate-500">You can add up to 10 fee items.</p>
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

                  {draft.fees.map((fee, index) => {
                    return (
                      <div key={fee.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-12">
                        <div className="md:col-span-6">
                          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                            Fee Type {index === 0 ? "*" : ""}
                          </label>
                          <select
                            value={fee.feeType}
                            onChange={(event) => updateFeeLine(fee.id, "feeType", event.target.value)}
                            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none ring-sky-500 focus:ring-2"
                            required={index === 0}
                          >
                            <option value="">Select fee type</option>
                            {FEE_TYPES.map((feeType) => (
                              <option key={feeType} value={feeType}>
                                {feeType}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="md:col-span-4">
                          <Input
                            label="Fee Amount"
                            required={index === 0}
                            type="number"
                            value={String(fee.feeAmount)}
                            onChange={(value) => updateFeeLine(fee.id, "feeAmount", Number(value))}
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
                    );
                  })}
                </div>

                <div className="md:col-span-2">
                  <Input
                    label="Overall Discount %"
                    type="number"
                    value={String(draft.overallDiscountPercentage)}
                    onChange={(value) =>
                      updateDraft(
                        "overallDiscountPercentage",
                        Math.min(100, Math.max(0, Number(value) || 0))
                      )
                    }
                  />
                </div>

                <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-500">
                    Total Fee: <span className="font-semibold text-slate-700">{currency.format(draftTotals.feeAmount)}</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    Discount:{" "}
                    <span className="font-semibold text-slate-700">
                      {draftTotals.discountPercentage.toFixed(2)}% ({currency.format(draftTotals.discount)})
                    </span>
                  </p>
                  <p className="text-2xl font-semibold text-sky-600">{currency.format(draftTotals.netFee)}</p>
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
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-800">{currency.format(value)}</p>
    </div>
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
        {label}
        {required ? " *" : ""}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
