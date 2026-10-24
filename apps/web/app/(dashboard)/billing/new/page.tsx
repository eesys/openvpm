"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

type Appointment = {
  id: string;
  status: string;
  patientId: string | null;
  patientName: string | null;
  clientId: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
};

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get("appointmentId") ?? "";
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [description, setDescription] = useState("诊费");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("80.00");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!appointmentId) return;
    trpc<Appointment>("appointments.getById", { id: appointmentId })
      .then(setAppointment)
      .catch((error: Error) => setMessage(error.message));
  }, [appointmentId]);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointment?.clientId || !appointment.patientId) return;
    setMessage("");
    try {
      const invoice = await trpc<{ id: string }>(
        "billing.createInvoice",
        {
          appointmentId: appointment.id,
          clientId: appointment.clientId,
          patientId: appointment.patientId,
          items: [
            {
              description,
              quantity: Number(quantity),
              unitPrice,
              itemType: "service",
            },
          ],
        },
        "POST",
      );
      router.push(`/billing?expand=${invoice.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开票失败");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href={appointmentId ? `/encounters/${appointmentId}` : "/billing"}>返回</a>
      </p>
      <h1>草稿发票</h1>
      {!appointmentId ? <p>缺少就诊。</p> : null}
      {appointment ? (
        <p>
          {appointment.patientName ?? "未指定患者"}，{appointment.status}，
          {appointment.clientLastName}
          {appointment.clientFirstName}
        </p>
      ) : null}
      <form onSubmit={onCreate} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          项目
          <input value={description} onChange={(event) => setDescription(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          数量
          <input value={quantity} onChange={(event) => setQuantity(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          单价
          <input value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={!appointment || appointment.status !== "in_exam"}>
          开草稿发票
        </button>
      </form>
      <p>{message}</p>
    </main>
  );
}
