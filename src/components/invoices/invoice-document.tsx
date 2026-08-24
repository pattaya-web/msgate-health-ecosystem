import {
  INVOICE_ACCENT,
  INVOICE_ACCENT_STRONG,
  formatInvoiceAmount,
  formatInvoiceDate,
  invoiceTotal,
  type Invoice,
} from "@/lib/invoices/types";

const INK = "#1f2937";
const MUTED = "#9ca3af";
const LINE = "#e5e7eb";

/** Les adresses sont saisies en multi-lignes dans le formulaire. */
function AddressLines({ value, color }: { value: string; color: string }) {
  return (
    <>
      {value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => (
          <div key={`${line}-${index}`} style={{ color }}>
            {line}
          </div>
        ))}
    </>
  );
}

function BankRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
      <span style={{ width: 84, flexShrink: 0, color: "#4b5563" }}>{label}</span>
      <span style={{ color: INK }}>{value}</span>
    </div>
  );
}

/**
 * Reproduction du modèle « Invoice Classique » (ScaleXReach / SCALEXBYECOM LLC).
 * Styles inline : le document doit rester identique en clair, en sombre et à l'impression.
 */
export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const total = invoiceTotal(invoice.lines);
  const lines = invoice.lines.filter((line) => line.description.trim() || line.amount);
  const issuerAddressLines = invoice.issuerAddress
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div
      id="invoice-print"
      style={{
        width: "210mm",
        minHeight: "297mm",
        background: "#ffffff",
        color: INK,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 11.5,
        lineHeight: 1.5,
        padding: "14mm 13mm 10mm",
        display: "flex",
        flexDirection: "column",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <header
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" style={{ marginTop: 5 }} aria-hidden="true">
              <path
                d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"
                stroke={INVOICE_ACCENT}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span
              style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: INVOICE_ACCENT }}
            >
              {invoice.brandName}
            </span>
          </div>
          <div style={{ marginLeft: 13, fontSize: 9.5, color: "#6b7280" }}>{invoice.issuerLegalName}</div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: INVOICE_ACCENT_STRONG,
            }}
          >
            INVOICE
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280" }}>
            {invoice.clientName} - Invoice
          </div>
        </div>
      </header>

      <div style={{ borderTop: `1px solid ${LINE}`, margin: "26px 0 22px" }} />

      <section style={{ display: "flex", justifyContent: "space-between", gap: 32 }}>
        <div>
          <div
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            BILL TO
          </div>
          <div style={{ color: INK }}>{invoice.clientName}</div>
          <AddressLines value={invoice.clientAddress} color={INK} />
          {invoice.clientEmail.trim() ? <div style={{ color: INK }}>{invoice.clientEmail}</div> : null}
        </div>

        <div style={{ textAlign: "right", color: "#374151" }}>
          <div>Invoice Date - {formatInvoiceDate(invoice.invoiceDate)}</div>
          <div>Payment Method: {invoice.paymentMethod}</div>
          <div>
            Service Period - {formatInvoiceDate(invoice.serviceFrom)} to{" "}
            {formatInvoiceDate(invoice.serviceTo)}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            background: INVOICE_ACCENT,
            borderRadius: 6,
            padding: "11px 18px",
            color: "#ffffff",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.09em",
          }}
        >
          <span>DESCRIPTION</span>
          <span>AMOUNT</span>
        </div>

        <div style={{ padding: "16px 18px 18px", borderBottom: `1px solid ${LINE}` }}>
          {lines.map((line) => (
            <div
              key={line.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 24, padding: "2px 0" }}
            >
              <span>- {line.description}</span>
              <span style={{ whiteSpace: "nowrap" }}>{formatInvoiceAmount(line.amount)}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginLeft: "auto",
            marginTop: 22,
            width: "48%",
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            background: INVOICE_ACCENT,
            borderRadius: 6,
            padding: "16px 20px",
            color: "#ffffff",
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          <span>AMOUNT DUE:</span>
          <span>{formatInvoiceAmount(total)}</span>
        </div>
      </section>

      <section style={{ marginTop: 72 }}>
        <div
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.09em",
            color: "#94a3b8",
            marginBottom: 12,
          }}
        >
          BANK TRANSFER DETAILS
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            border: `1px solid ${LINE}`,
            borderRadius: 10,
            padding: "20px 22px 24px",
          }}
        >
          <div>
            <BankRow label="Bank" value={invoice.bank.bankName} />
            <BankRow label="Beneficiary" value={invoice.bank.beneficiary} />
            <BankRow label="Account No." value={invoice.bank.accountNumber} />
            <BankRow label="ABA Routing" value={invoice.bank.routing} />
            <BankRow label="SWIFT" value={invoice.bank.swift} />
          </div>

          <div style={{ color: MUTED }}>
            {invoice.bank.bankAddress.trim() ? (
              <>
                <div style={{ marginBottom: 4 }}>Bank Address</div>
                <AddressLines value={invoice.bank.bankAddress} color={MUTED} />
              </>
            ) : null}
            {invoice.bank.beneficiaryAddress.trim() ? (
              <div style={{ marginTop: 18 }}>
                <div style={{ marginBottom: 4 }}>Beneficiary Address</div>
                <AddressLines value={invoice.bank.beneficiaryAddress} color={MUTED} />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div style={{ flex: 1, minHeight: 40 }} />

      <footer style={{ textAlign: "center", fontSize: 9.5, color: MUTED, lineHeight: 1.7 }}>
        <div>
          {invoice.issuerLegalName}
          {issuerAddressLines[0] ? ` · ${issuerAddressLines[0]}` : ""}
        </div>
        {issuerAddressLines.slice(1).map((line) => (
          <div key={line}>{line}</div>
        ))}
        <div>{invoice.issuerEmail}</div>
        <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 14 }} />
      </footer>
    </div>
  );
}
