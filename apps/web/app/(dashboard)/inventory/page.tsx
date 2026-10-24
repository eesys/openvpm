"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Product = {
  id: string;
  name: string;
  unitPrice: string;
  stockQuantity: number;
  reorderPoint: number | null;
};

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("12.00");
  const [stockQuantity, setStockQuantity] = useState("12");
  const [adjustment, setAdjustment] = useState("-3");
  const [reason, setReason] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const result = await trpc<{ items: Product[] }>("inventory.list");
    setProducts(result.items);
    setSelectedId((current) => current || result.items[0]?.id || "");
  }

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const product = await trpc<Product>(
        "inventory.create",
        { name, unitPrice, stockQuantity: Number(stockQuantity) },
        "POST",
      );
      setName("");
      setSelectedId(product.id);
      await load();
      setMessage("已入库");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "入库失败");
    }
  }

  async function onAdjust(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const product = await trpc<Product>(
        "inventory.adjustStock",
        { id: selectedId, adjustment: Number(adjustment), reason },
        "POST",
      );
      setReason("");
      setSelectedId(product.id);
      await load();
      setMessage(`库存现为 ${product.stockQuantity}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "调整失败");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/billing">账单</a>
      </p>
      <h1>库存</h1>
      <form onSubmit={onCreate} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          名称
          <input value={name} onChange={(event) => setName(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          单价
          <input value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          期初数量
          <input value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">添加货品</button>
      </form>
      <h2>现有货品</h2>
      <ul>
        {products.map((product) => {
          const low = product.reorderPoint !== null && product.stockQuantity <= product.reorderPoint;
          return (
            <li key={product.id}>
              <button type="button" onClick={() => setSelectedId(product.id)}>
                {product.name}
              </button>
              {` ${product.stockQuantity}，${product.unitPrice}`}
              {low ? "，库存偏低" : ""}
            </li>
          );
        })}
      </ul>
      <form onSubmit={onAdjust} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          调整数量
          <input value={adjustment} onChange={(event) => setAdjustment(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          原因
          <input value={reason} onChange={(event) => setReason(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={!selectedId}>
          调整库存
        </button>
      </form>
      <p>{message}</p>
    </main>
  );
}
