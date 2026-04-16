"use client";

import { useEffect, useState } from "react";
import PaymentPlanBuilder from "@/components/payment-plan-builder";

type OpportunityContext = {
  opportunityName?: string;
  clientName?: string;
  studentEmail?: string;
  application?: string;
  programOfferId?: string;
  xeroCustomerNumber?: string;
  xeroTrackingCode?: string;
  error?: string;
};

export default function HomePage() {
  const [oppId, setOppId] = useState("");
  const [contactId, setContactId] = useState("");
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [ctx, setCtx] = useState<OpportunityContext>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const opp = params.get("opp_id") || "";
    const contact = params.get("contact_id") || "";
    setOppId(opp);
    setContactId(contact);

    if (!opp || !contact) return;

    const loadContext = async () => {
      try {
        setIsContextLoading(true);
        const response = await fetch(
          `/api/opportunity-context?opp_id=${encodeURIComponent(opp)}&contact_id=${encodeURIComponent(contact)}`
        );
        const data = (await response.json()) as OpportunityContext;
        if (!response.ok) {
          throw new Error(data.error || "Unable to load opportunity context.");
        }
        setCtx(data);
      } catch {
        setCtx({});
      } finally {
        setIsContextLoading(false);
      }
    };

    void loadContext();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <PaymentPlanBuilder
        oppId={oppId}
        contactId={contactId}
        isContextLoading={isContextLoading}
        opportunityName={ctx.opportunityName || ""}
        clientName={ctx.clientName || ""}
        studentEmail={ctx.studentEmail || ""}
        application={ctx.application || ""}
        programOfferId={ctx.programOfferId || ""}
        xeroCustomerNumber={ctx.xeroCustomerNumber || ""}
        xeroTrackingCode={ctx.xeroTrackingCode || ""}
      />
    </main>
  );
}
