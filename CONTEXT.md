# The Migration — Accounts Automation System
## Claude Code Project Context

This file is the single source of truth for everything designed in the planning phase.
Read this fully before writing any code or making any API calls.

---

## 1. WHO WE ARE

**Company:** The Migration (themigration.com.au)
**Type:** MARA-certified Australian migration and education consultancy
**Stack:** GoHighLevel (GHL) + Xero + n8n (self-hosted on Hostinger VPS)
**Role of this system:** Automate student fee collection, installment tracking, Xero invoicing, and commission bookkeeping for the education division.

---

## 2. CREDENTIALS (TO BE PROVIDED BY USER)

The user will provide these. Do NOT hardcode or guess them.
Ask for each one before the task that needs it.

```
GHL_API_KEY=
GHL_LOCATION_ID=
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_TENANT_ID=
N8N_BASE_URL=
N8N_API_KEY=
```

---

## 3. GHL OBJECT MODEL

Three custom objects exist in GHL:

### 3a. Partner (University)
Represents the university/education provider.
**Fields that exist:**
- Name
- Standard contact fields

**Fields to ADD (Task for Claude Code):**
- `partner_code` — short text, e.g. "RMIT", "HOL", "TOR", "LA_TROBE"
  This code is used to build the Xero tracking code.
  **STATUS: NOT YET CREATED. Claude Code must create these via GHL API.**

### 3b. Product (Course)
Represents an individual course.
**Fields that exist:**
- Name
- Standard fields

**Fields to ADD (Task for Claude Code):**
- `product_code` — short text, e.g. "BIT", "MBA", "NUR", "LAW"
  **STATUS: NOT YET CREATED. Claude Code must create these via GHL API.**

### 3c. Program Offer (Product + Partner)
The enrollable thing — a specific course at a specific university for a specific intake.
**Fields to ADD (Task for Claude Code):**
- `xero_tracking_code` — auto-generated, format: `[CustomerNo]_[PartnerCode]_[ProductCode]`
  e.g. `9105_BIT_RMIT`
  **STATUS: NOT YET CREATED. Claude Code must create this via GHL API.**

### 3d. Contact (Student)
**Fields that already exist:**
- Name, email, phone
- `contact_id` (GHL internal)
- `xero_customer_number` — e.g. "9105" (already auto-populated by existing automation)

---

## 4. GHL PIPELINES

### Pipeline: L2C Education
Existing pipeline. When opportunity reaches stage **"COE Received"**, the accounts system kicks in.

### Pipeline: Accounts
New pipeline to build. Stages in order:

1. Send Payment Plan
2. Payment Plan Sent
3. Awaiting Deposit
4. Deposit Received
5. Installments In Progress
6. Fully Paid (Our Collections)
7. Transfer to Uni Sent
8. Commission Received
9. Closed

---

## 5. GHL CUSTOM FIELDS ON OPPORTUNITY (Accounts Pipeline)

These need to exist on the Accounts pipeline opportunity.
**Claude Code must verify each exists and create any that are missing.**

| Field Key | Type | Notes |
|---|---|---|
| `installment_schedule_json` | Textarea | Master JSON blob — see schema in Section 7 |
| `original_schedule_json` | Textarea | Archived copy of original plan |
| `gross_fee` | Currency | Total fee before discount |
| `discount_amount` | Currency | Discount applied |
| `net_fee` | Currency | gross_fee - discount_amount |
| `commission_pct` | Number | e.g. 15 |
| `commission_amount` | Currency | net_fee × commission_pct / 100 |
| `university_portion` | Currency | net_fee - commission_amount |
| `deposit_amount` | Currency | |
| `deposit_due_date` | Date | |
| `outstanding_balance` | Currency | Sum of all amount_outstanding across installments |
| `next_due_date` | Date | Next unpaid installment due date |
| `next_due_amount` | Currency | Next unpaid installment amount |
| `installments_remaining` | Number | Count of installments where status != paid |
| `payment_model` | Dropdown | Options: us, university, mixed |
| `xero_tracking_code` | Text | e.g. 9105_BIT_RMIT |
| `xero_contact_id` | Text | Xero's internal contact UUID |
| `xero_invoice_ids` | Textarea | Comma-separated list of all Xero invoice IDs |
| `fully_paid` | Checkbox | True when outstanding_balance = 0 |
| `commission_received` | Checkbox | |
| `university_portion_sent` | Checkbox | |
| `partner_id` | Text | GHL Partner object ID |
| `product_id` | Text | GHL Product object ID |
| `program_offer_id` | Text | GHL Program Offer object ID |
| `payment_plan_app_link` | Text | Auto-generated link to payment plan app |

---

## 6. XERO STRUCTURE

### Chart of Accounts (must exist before invoices are created)
- **Student Fees Collected** — Revenue account, for invoices to students (collected_by: us)
- **University Commissions** — Revenue account, for commission income from universities

### Tracking Categories
- Category name: **Program**
- Options are dynamic: one per Program Offer, format `9105_BIT_RMIT`
- n8n creates a new tracking option in Xero when a new Program Offer is enrolled

### Contact structure
- One Xero contact per student
- Contact name = student full name
- Contact reference = GHL contact ID
- Xero Customer Number written back to GHL contact field `xero_customer_number`

### Invoice structure (per installment, collected_by: us)
```
Type: ACCREC
Contact: [student Xero contact]
LineItems:
  - Description: "[ProductCode] — [Type] [No]"  e.g. "BIT — Installment 1"
  - Quantity: 1
  - UnitAmount: [installment.amount]
  - AccountCode: [Student Fees Collected code]
  - Tracking: [{ Name: "Program", Option: "9105_BIT_RMIT" }]
DueDate: [installment.due]
Status: AUTHORISED
Reference: [opportunity_id]
```

---

## 7. JSON BLOB SCHEMA

This is the master data structure stored in `installment_schedule_json` on every Accounts opportunity.
Every automation reads from and writes to this structure.

```json
{
  "schema_version": "1.0",
  "opportunity_id": "GHL_OPP_ID",
  "contact_id": "GHL_CONTACT_ID",
  "xero_tracking_code": "9105_BIT_RMIT",
  "partner": "RMIT University",
  "partner_code": "RMIT",
  "product": "Bachelor of IT",
  "product_code": "BIT",
  "program_offer_id": "GHL_OFFER_ID",

  "gross_fee": 24000,
  "discount": 500,
  "net_fee": 23500,
  "commission_pct": 15,
  "commission_amount": 3525,
  "university_portion": 19975,
  "payment_model": "mixed",

  "deposit": {
    "amount": 3000,
    "due": "2026-05-01",
    "collected_by": "us",
    "status": "unpaid",
    "amount_paid": 0,
    "amount_outstanding": 3000,
    "xero_invoice_id": "",
    "xero_contact_id": "",
    "payments": []
  },

  "installments": [
    {
      "no": 1,
      "amount": 5000,
      "due": "2026-06-01",
      "collected_by": "us",
      "status": "unpaid",
      "amount_paid": 0,
      "amount_outstanding": 5000,
      "xero_invoice_id": "",
      "payments": []
    },
    {
      "no": 2,
      "amount": 5000,
      "due": "2026-09-01",
      "collected_by": "us",
      "status": "partial",
      "amount_paid": 3000,
      "amount_outstanding": 2000,
      "xero_invoice_id": "INV-0042",
      "payments": [
        {
          "date": "2026-09-05",
          "amount": 3000,
          "method": "xero_invoice",
          "xero_payment_id": "PAY-001",
          "reference": "INV-0042",
          "recorded_by": "auto"
        }
      ]
    },
    {
      "no": 3,
      "amount": 5000,
      "due": "2027-02-01",
      "collected_by": "university",
      "status": "unpaid",
      "amount_paid": 0,
      "amount_outstanding": 5000,
      "xero_invoice_id": "",
      "payments": []
    }
  ],

  "outstanding_balance": 20000,
  "total_paid": 3000,

  "commission_received": false,
  "commission_received_date": "",
  "university_portion_sent": false,
  "university_portion_sent_date": "",

  "amendment_log": [],
  "created_at": "2026-04-15T10:00:00Z",
  "updated_at": "2026-04-15T10:00:00Z",
  "original_schedule_hash": "abc123"
}
```

### Payment status values
- `unpaid` — nothing received
- `partial` — some received, still outstanding
- `paid` — fully cleared

### Payment model values
- `us` — all installments collected by The Migration
- `university` — all installments collected by university
- `mixed` — some by us, some by university (auto-calculated)

### Payment method values (in payments array)
- `xero_invoice` — paid via Xero, came through webhook
- `bank_transfer` — paid directly, recorded manually
- `cash` — cash payment, recorded manually
- `other` — anything else, recorded manually

---

## 8. ALL 8 AUTOMATIONS

### Automation 1 — COE Received → Duplicate to Accounts
**Trigger:** GHL webhook — stage change to "COE Received" in L2C Education pipeline
**Actions:**
1. Duplicate opportunity to Accounts pipeline, stage = "Send Payment Plan"
2. Fetch Partner, Product, Program Offer from opportunity
3. Check if contact has `xero_customer_number` — if not, create Xero contact and write number back
4. Generate payment plan app link (append opportunity ID as query param)
5. Write link to `payment_plan_app_link` field on new Accounts opportunity
6. Create GHL task for accounts team: "Create payment plan for [student name]"

### Automation 2 — Payment Plan Submitted → JSON + Xero Invoices (MOST COMPLEX — BUILD FIRST)
**Trigger:** Webhook from payment plan app on form submission
**Payload received:** All form fields (see Section 9)
**Actions:**
1. Build JSON blob from form data (calculate net_fee, commission_amount, university_portion, payment_model, outstanding_balance)
2. Write JSON blob to `installment_schedule_json` on GHL opportunity
3. Write all flat fields to GHL opportunity
4. Build Xero tracking code: `[xero_customer_number]_[product_code]_[partner_code]`
5. Write tracking code to GHL opportunity and Program Offer
6. For each installment/deposit where `collected_by = "us"`: create Xero invoice
7. Write returned Xero invoice IDs back into JSON blob
8. Update JSON blob again in GHL with invoice IDs
9. For each installment where `collected_by = "university"`: create GHL task "Chase commission — Installment [N] due [date]"
10. Advance GHL stage to "Payment Plan Sent"
11. Create GHL task for accounts: "Review Xero invoices for [student name]"

### Automation 3 — Xero Invoice Paid → Sync to GHL
**Trigger:** Xero webhook — `invoice.updated`
**Actions:**
1. Extract InvoiceID, AmountPaid, AmountDue from payload
2. Search all GHL Accounts opportunities for matching `xero_invoice_id` in JSON blob
3. Parse JSON blob
4. Find matching installment (or deposit) by xero_invoice_id
5. Update: `amount_paid`, `amount_outstanding`, `status` (partial or paid)
6. Append to `payments` array: date, amount, method=xero_invoice, xero_payment_id
7. Recalculate `outstanding_balance` and `total_paid` at top level
8. Write updated JSON blob to GHL
9. Update flat fields: `outstanding_balance`, `next_due_date`, `next_due_amount`, `installments_remaining`
10. If `outstanding_balance = 0`: set `fully_paid = true`, advance stage to "Fully Paid (Our Collections)"
11. Notify accounts team via GHL task if fully paid

### Automation 4 — Nightly Installment Checker (Safety Net)
**Trigger:** Cron — daily at 8:00 AM AEST
**Actions:**
1. Fetch all active Accounts opportunities (paginate — max 20 per GHL call)
2. For each, parse JSON blob
3. Find installments where: `due <= today + 7 days` AND `status = unpaid` AND `xero_invoice_id = ""`
4. Create missing Xero invoices for those installments
5. Write invoice IDs back to JSON blob
6. Find installments where: `due < today` AND `status != paid`
7. For each overdue: create or update GHL task "OVERDUE — [student] installment [N] — [amount]"
8. Send daily overdue summary email to accounts manager

### Automation 5 — Schedule Amendment → Update JSON + Void Invoices
**Trigger:** GHL amendment form submitted (webhook)
**Payload:** opportunity_id, from_installment_no, new_collected_by, reason, amended_by
**Actions:**
1. Fetch JSON blob from GHL opportunity
2. Archive current JSON to `original_schedule_json` field
3. For all installments >= from_installment_no: set `collected_by = new_collected_by`
4. For switched installments that had Xero invoices (status=unpaid): void those invoices in Xero
5. Clear `xero_invoice_id` on voided installments
6. Recalculate `payment_model` (us/university/mixed)
7. If new_collected_by = "university": create GHL commission-chase tasks for each affected installment
8. Write updated JSON blob to GHL
9. Write amendment log entry:
   ```json
   { "date": "...", "by": "...", "from_installment": N, "change": "collected_by → university", "reason": "..." }
   ```
10. Write activity note to GHL opportunity timeline

### Automation 6 — Xero Tracking Code Generator
**Trigger:** New Program Offer created in GHL OR manual trigger
**Actions:**
1. Fetch Program Offer record
2. Fetch linked Partner → get `partner_code`
3. Fetch linked Product → get `product_code`
4. Get student's `xero_customer_number` from contact
5. Concatenate: `[xero_customer_number]_[product_code]_[partner_code]`
6. Write to Program Offer `xero_tracking_code` field
7. Create Xero Tracking Category option if it doesn't exist

### Automation 7 — Recovery Report Form → Excel + Email
**Trigger:** GHL recovery report form submitted (webhook)
**Payload:** from_date, to_date, report_type (all/outstanding/paid), requested_by
**Actions:**
1. Fetch all active Accounts opportunities (paginate)
2. For each, parse JSON blob
3. Filter installments: due >= from_date AND due <= to_date
4. Apply report_type filter (all / status=unpaid / status=paid)
5. Build detail rows array sorted by due date
6. Calculate summary: total_expected, total_paid, total_outstanding, by_model breakdown, by_partner breakdown
7. Generate Excel file (2 sheets: Detail + Summary) using SheetJS/exceljs
8. Email Excel to accounts manager with subject "Recovery Report — [from_date] to [to_date]"

### Automation 8 — Manual Payment Recorder
**Trigger:** GHL manual payment form submitted (webhook)
**Payload:** opportunity_id, installment_no, amount_received, payment_date, payment_method, reference, recorded_by
**Actions:**
1. Fetch JSON blob from GHL opportunity
2. Find installment by `installment_no` (or "deposit")
3. Calculate new `amount_paid = existing + amount_received`
4. Calculate new `amount_outstanding = amount - amount_paid`
5. Set status: paid if amount_outstanding=0, partial if >0
6. Append to `payments` array: { date, amount, method, reference, recorded_by }
7. Recalculate top-level `outstanding_balance` and `total_paid`
8. Write updated JSON blob to GHL
9. Update GHL flat fields
10. **Record payment in Xero against existing invoice:**
    ```
    POST /Payments
    { InvoiceID: xero_invoice_id, AccountCode: bank_account, Date: payment_date, Amount: amount_received, Reference: reference }
    ```
11. If fully paid: advance GHL stage, notify accounts

---

## 9. PAYMENT PLAN APP — FORM FIELDS

The payment plan app is an existing app. It needs to be extended to:
1. Accept these fields
2. Build the JSON blob
3. POST to n8n Automation 2 webhook on submit
4. Also write JSON blob directly to GHL opportunity via API

### Section A — Auto-filled from GHL (read from opportunity on page load)
- `opportunity_id`
- `contact_id`
- `student_name`
- `student_email`
- `xero_customer_number`
- `partner_name`
- `partner_code`
- `product_name`
- `product_code`
- `program_offer_id`

### Section B — Financials (manual entry)
- `gross_fee` — number
- `discount_amount` — number (default 0)
- `net_fee` — auto-calculated: gross_fee - discount_amount
- `commission_pct` — number
- `commission_amount` — auto-calculated: net_fee × commission_pct / 100
- `university_portion` — auto-calculated: net_fee - commission_amount

### Section C — Deposit
- `deposit_amount` — number
- `deposit_due_date` — date
- `deposit_collected_by` — radio: "us" / "university"

### Section D — Installments (dynamic rows, minimum 1, no maximum)
Each row:
- `installment_amount` — number
- `installment_due_date` — date
- `installment_collected_by` — toggle: "us" / "university"

Default for `collected_by` on all rows: look up university in lookup table (see Section 10).
Add row button. Remove row button. Rows numbered automatically.

---

## 10. UNIVERSITY PAYMENT MODEL LOOKUP TABLE

Used to pre-fill `collected_by` defaults in the payment plan app.
Stored as a JSON config in n8n or as a GHL custom value.
**To be populated by user — ask them for their university list.**

```json
{
  "RMIT": "us",
  "Torrens": "us",
  "Holmes": "us",
  "La Trobe": "mixed",
  "default": "us"
}
```

---

## 11. GHL FORMS TO BUILD

### Form 1 — Payment Plan App (existing, needs extension)
See Section 9.

### Form 2 — Schedule Amendment Form
Internal GHL form. Fields:
- Opportunity ID (text)
- From installment number (number)
- New collected by (dropdown: us / university)
- Reason / note (textarea)
- Amended by (text)

On submit: fires Automation 5 webhook.

### Form 3 — Manual Payment Form
Internal GHL form. Fields:
- Opportunity ID (text)
- Installment number or "deposit" (text)
- Amount received (currency)
- Payment date (date)
- Payment method (dropdown: bank_transfer / cash / other)
- Reference / note (text)
- Recorded by (text)

On submit: fires Automation 8 webhook.

### Form 4 — Recovery Report Form
Internal GHL form. Fields:
- From date (date)
- To date (date)
- Report type (dropdown: all / outstanding / paid)
- Requested by (text)

On submit: fires Automation 7 webhook.

---

## 12. IMMEDIATE TASKS FOR CLAUDE CODE (DO THESE FIRST)

Before building any automations, these GHL setup tasks must be completed via API.
Ask the user for `GHL_API_KEY` and `GHL_LOCATION_ID` before starting.

### Task 1 — Add `partner_code` field to Partner object
- GHL API: POST /locations/{locationId}/customFields
- Object: partner (custom object)
- Field name: "Partner Code"
- Field key: `partner_code`
- Field type: TEXT

### Task 2 — Add `product_code` field to Product object
- Same as above but for product custom object
- Field name: "Product Code"
- Field key: `product_code`
- Field type: TEXT

### Task 3 — Add `xero_tracking_code` field to Program Offer object
- Same pattern
- Field name: "Xero Tracking Code"
- Field key: `xero_tracking_code`
- Field type: TEXT

### Task 4 — Verify or create all Accounts opportunity custom fields
- Loop through the fields list in Section 5
- For each: check if it exists (GET /customFields), create if missing (POST /customFields)
- Report back which were created vs already existed

### Task 5 — Create Accounts pipeline with all stages
- Check if "Accounts" pipeline exists
- If not: create it with all 9 stages from Section 4 in correct order
- If yes: verify all stages exist, add any missing ones

### Task 6 — Verify Xero chart of accounts
- Use Xero API to check "Student Fees Collected" and "University Commissions" accounts exist
- If missing: prompt user to create them manually in Xero (can't create via API without account codes)
- Report the account codes back — needed for invoice creation

---

## 13. BUILD ORDER FOR AUTOMATIONS

1. **Complete Tasks 1–6 above first** (GHL + Xero setup)
2. **Automation 2** — Payment plan → JSON + Xero invoices (core engine)
3. **Automation 1** — COE received → duplicate + Xero contact
4. **Automation 3** — Xero paid → GHL sync
5. **Automation 8** — Manual payment recorder (operationally urgent)
6. **Automation 4** — Nightly checker
7. **Automation 5** — Schedule amendment
8. **Automation 7** — Recovery report Excel
9. **Automation 6** — Tracking code generator (can run in parallel with any of the above)

---

## 14. IMPORTANT BUSINESS RULES

- A student can have multiple Accounts opportunities (one per course enrolment)
- Each opportunity = one Program Offer = one Partner + one Product
- `collected_by` lives at the **installment level**, not the opportunity level
- `payment_model` on the opportunity is auto-calculated: all us = "us", all university = "university", mix = "mixed"
- Partial payments are fully supported — never overwrite `amount_paid`, always add to it
- Every payment (regardless of source) must be recorded in both GHL JSON and Xero
- Xero is the accounting system of record — GHL is the operational system of record
- When they conflict, Xero wins for financial figures, GHL wins for student journey status
- Amendment log must always be preserved — never delete history from JSON blob
- `original_schedule_json` is written once (first amendment) and never overwritten again

---

## 15. N8N NOTES

- n8n is self-hosted on Hostinger VPS
- Use n8n's built-in GHL node where available, HTTP Request node otherwise
- Use n8n's built-in Xero node for standard operations, HTTP Request for advanced calls
- All workflows should have an error handler branch that sends a GHL internal note + email alert on failure
- Paginate all GHL "get opportunities" calls — default page size is 20, loop until no more results
- JSON blob field in GHL is a textarea — always JSON.parse() on read, JSON.stringify() on write
- When writing JSON back to GHL, always re-fetch first, merge, then write — never blind overwrite

---
*Generated from planning session — The Migration Accounts System v1.0*
*Last updated: April 2026*

## 16. PAYMENT PLAN APP — CODE REVIEW INSTRUCTIONS

The existing app is in this workspace. Before touching any code:

1. Read all files in this project and understand what it currently does
2. Compare against the requirements in Section 9 (form fields) and Section 7 (JSON blob schema)
3. Produce a review report covering:

   A) WHAT'S CORRECT — keep as is
   B) WHAT'S MISSING — fields, logic, or API calls not yet built
   C) WHAT NEEDS TO CHANGE — conflicts with new design
   D) EXACT CHANGES NEEDED — file by file, function by function

4. Do NOT make any changes yet — report first, wait for approval

Key things to specifically check for:
- Does it collect `collected_by` per installment? (us / university toggle)
- Does it support variable number of installments (up to 10+)?
- Does it build the full JSON blob from Section 7?
- Does it write the JSON blob back to GHL via API?
- Does it write all flat fields to GHL (Section 5)?
- Does it POST the payload to an n8n webhook?
- Does it handle partial payment structure (amount_paid, amount_outstanding, status)?
- Does it calculate net_fee, commission_amount, university_portion automatically?
- Does it generate the xero_tracking_code?
- Does the stage auto-advance to "Payment Plan Sent" after submission?
- Does it create a GHL task for accounts team after submission?
- Is the deposit handled separately from installments?