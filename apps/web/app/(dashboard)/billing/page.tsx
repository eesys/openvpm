"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  openGrantedScanner,
  requestScanner,
  serialScannerAvailable,
  type ScannerSession,
} from "@/lib/barcode-scanner";
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
  const [scan, setScan] = useState<"wechat" | "alipay" | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [charging, setCharging] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [canConnectScanner, setCanConnectScanner] = useState(false);
  const sessionRef = useRef<ScannerSession | null>(null);
  const scanRef = useRef(scan);
  const detailRef = useRef(detail);
  const chargingRef = useRef(false);
  scanRef.current = scan;
  detailRef.current = detail;

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
    setScan(null);
    setAuthCode("");
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
    setScan(null);
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

  function openScan(method: "wechat" | "alipay") {
    setMessage("");
    setScan(method);
    setAuthCode("");
  }

  async function chargeScannedCode(code: string) {
    const current = detailRef.current;
    const method = scanRef.current;
    if (!current || !method || chargingRef.current) return;
    chargingRef.current = true;
    setCharging(true);
    setAuthCode(code);
    setMessage("");
    try {
      await trpc(
        "billing.chargeCustomerPayCode",
        { invoiceId: current.id, method, authCode: code },
        "POST",
      );
      setScan(null);
      setAuthCode("");
      loadInvoices();
      loadDetail(current.id);
      setMessage(method === "wechat" ? "微信收款成功" : "支付宝收款成功");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "没有收成款");
    } finally {
      chargingRef.current = false;
      setCharging(false);
    }
  }

  useEffect(() => {
    setCanConnectScanner(serialScannerAvailable());
  }, []);

  useEffect(() => {
    if (!scan) {
      setScannerOpen(false);
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.close();
    }
  }, [scan]);

  const scannerListening = scan !== null;
  useEffect(() => {
    if (!scannerListening) return;
    let cancelled = false;
    openGrantedScanner((code) => {
      void chargeScannedCode(code);
    })
      .then((session) => {
        if (cancelled || !session || sessionRef.current) {
          void session?.close();
          return;
        }
        sessionRef.current = session;
        setScannerOpen(true);
      })
      .catch((error: Error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [scannerListening]);

  async function onConnectScanner() {
    setMessage("");
    try {
      await sessionRef.current?.close();
      sessionRef.current = await requestScanner((code) => {
        void chargeScannedCode(code);
      });
      setScannerOpen(true);
    } catch (error) {
      setScannerOpen(false);
      if (error instanceof DOMException && error.name === "NotFoundError") {
        setMessage("没有选中扫码枪。");
        return;
      }
      if (error instanceof DOMException && error.name === "SecurityError") {
        setMessage("请直接点「连接扫码枪」，浏览器才会允许选择扫码枪。");
        return;
      }
      setMessage(error instanceof Error ? error.message : "没有连上扫码枪");
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
              </button>{" "}
              <button type="button" onClick={() => openScan("wechat")}>
                微信支付
              </button>{" "}
              <button type="button" onClick={() => openScan("alipay")}>
                支付宝支付
              </button>
            </p>
          ) : null}
          {scan ? (
            <p>
              {scannerOpen ? (
                "扫码枪已连接，请扫描客户付款码。"
              ) : canConnectScanner ? (
                <button type="button" onClick={onConnectScanner} disabled={charging}>
                  连接扫码枪
                </button>
              ) : (
                "当前浏览器不能打开扫码枪。"
              )}
              {authCode ? ` ${authCode}` : ""}
            </p>
          ) : null}
        </section>
      ) : null}
      <p>{message}</p>
    </main>
  );
}
