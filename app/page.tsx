"use client";

import { useEffect, useState } from "react";
import PaymentPlanBuilder from "@/components/payment-plan-builder";

export default function HomePage() {
  const [oppId, setOppId] = useState("");
  const [contactId, setContactId] = useState("");
  const [opportunityName, setOpportunityName] = useState("");
  const [clientName, setClientName] = useState("");
  const [application, setApplication] = useState("");
  const [isContextLoading, setIsContextLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const opp = params.get("opp_id") || "";
    const contact = params.get("contact_id") || "";
    setOppId(opp);
    setContactId(contact);

    if (!opp || !contact) {
      return;
    }

    const loadContext = async () => {
      try {
        setIsContextLoading(true);
        const response = await fetch(
          `/api/opportunity-context?opp_id=${encodeURIComponent(opp)}&contact_id=${encodeURIComponent(contact)}`
        );
        const data = (await response.json()) as {
          opportunityName?: string;
          clientName?: string;
          application?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Unable to load opportunity context.");
        }
        setOpportunityName(data.opportunityName || "");
        setClientName(data.clientName || "");
        setApplication(data.application || "");
      } catch {
        setOpportunityName("");
        setClientName("");
        setApplication("");
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
        opportunityName={opportunityName}
        clientName={clientName}
        application={application}
        isContextLoading={isContextLoading}
      />
    </main>
  );
}
