"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

type InvoiceList = {
  items: Array<{
    id: string;
    status: string;
    total: string;
    patientName: string | null;
    clientLastName: string | null;
    clientFirstName: string | null;
  }>;
};

type InvoiceDetail = {
  id: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  paidAmount: string;
  isEstimate: boolean;
  patientName: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
  appointmentId: string | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
    itemType: string;
  }>;
};

export default function BillingPage() {
  const searchParams = useSearchParams();
  const expand = searchParams.get("expand") ?? "";
  const [invoices, setInvoices] = useState<InvoiceList["items"]>([]);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [message, setMessage] = useState("");

  function loadInvoices() {
    trpc<InvoiceList>("billing.listInvoices")
      .then((result) => setInvoices(result.items))
      .catch((error: Error) => setMessage(error.message));
  }

  useEffect(() => {
    loadInvoices();
  }, []);

  function loadDetail(id: string) {
    trpc<InvoiceDetail>("billing.getInvoice", { id })
      .then(setDetail)
      .catch((error: Error) => setMessage(error.message));
  }

  useEffect(() => {
    if (!expand) {
      setDetail(null);
      return;
    }
    loadDetail(expand);
  }, [expand]);

  async function onMarkSent() {
    if (!detail) return;
    setMessage("");
    try {
      await trpc("billing.updateInvoiceStatus", { id: detail.id, status: "sent" }, "POST");
      loadInvoices();
      loadDetail(detail.id);
      setMessage("已标为已发送");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "没有标成已发送");
    }
  }

  async function onCardCheckout() {
    if (!detail) return;
    setMessage("");
    try {
      const result = await trpc<{ url: string }>(
        "billing.createCardPaymentCheckout",
        { invoiceId: detail.id },
        "POST",
      );
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "没有打开刷卡收款");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/schedule">日程</a>
      </p>
      <h1>账单</h1>
      <ul>
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <a href={`/billing?expand=${invoice.id}`}>
              {invoice.patientName ?? "未指定患者"} {invoice.total}（{invoice.status}）
            </a>
            {invoice.clientLastName
              ? ` ${invoice.clientLastName}${invoice.clientFirstName ?? ""}`
              : ""}
          </li>
        ))}
      </ul>
      {detail ? (
        <section>
          <h2>
            {detail.patientName ?? "未指定患者"} {detail.status}
          </h2>
          <p>
            客户：{detail.clientLastName}
            {detail.clientFirstName}
          </p>
          {detail.appointmentId ? (
            <p>
              <a href={`/encounters/${detail.appointmentId}`}>这次就诊</a>
            </p>
          ) : null}
          <ul>
            {detail.items.map((item) => (
              <li key={item.id}>
                {item.description} × {item.quantity} @ {item.unitPrice} = {item.total}
              </li>
            ))}
          </ul>
          <p>
            小计 {detail.subtotal}，税 {detail.tax}，合计 {detail.total}，已付 {detail.paidAmount}
          </p>
          {detail.status === "draft" && !detail.isEstimate ? (
            <p>
              <button type="button" onClick={onMarkSent}>
                标为已发送
              </button>
            </p>
          ) : null}
          {(detail.status === "sent" || detail.status === "overdue") && !detail.isEstimate ? (
            <p>
              <button type="button" onClick={onCardCheckout}>
                刷卡收款
              </button>
            </p>
          ) : null}
        </section>
      ) : null}
      <p>{message}</p>
    </main>
  );
}
