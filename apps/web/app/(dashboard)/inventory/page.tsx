"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  canManageProductPricing,
  INVENTORY_ADJUSTMENT_REASON_MAX_LENGTH,
  INVENTORY_PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_PRICING_FORBIDDEN_MESSAGE,
} from "@/lib/inventory/policy";
import { trpc } from "@/lib/trpc";

function canManageInventory(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "veterinarian" ||
    role === "technician" ||
    role === "front_desk"
  );
}

export default function InventoryPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  if (status === "loading") return <p>Loading inventory...</p>;
  if (status === "unauthenticated") {
    router.push("/login");
    return <p>Loading inventory...</p>;
  }
  return <InventoryList role={session?.user?.role} />;
}

function InventoryList({ role }: { role?: string | null }) {
  const utils = trpc.useUtils();
  const products = trpc.inventory.list.useQuery({ limit: 50, offset: 0 });
  const createProduct = trpc.inventory.create.useMutation({
    onSuccess: async () => {
      setName("");
      setUnitPrice("");
      setStockQuantity(0);
      await utils.inventory.list.invalidate();
    },
  });
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState(0);
  const canPrice = canManageProductPricing(role);
  const canAdjust = canManageInventory(role);

  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Inventory</h1>
      {products.error ? <p>{products.error.message}</p> : null}
      <ul>
        {(products.data?.items ?? []).map((product) => (
          <li key={product.id}>
            {product.name} · {product.unitPrice} · {product.stockQuantity} on hand
            {canAdjust ? (
              <StockAdjust
                productId={product.id}
                stockQuantity={product.stockQuantity}
                onAdjusted={() => utils.inventory.list.invalidate()}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {!products.isLoading && (products.data?.items.length ?? 0) === 0 ? (
        <p>No products yet.</p>
      ) : null}
      {canPrice ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createProduct.mutate({ name, unitPrice, stockQuantity });
          }}
        >
          <h2>Add product</h2>
          <label>
            Name{" "}
            <input
              value={name}
              maxLength={INVENTORY_PRODUCT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Price{" "}
            <input
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
            />
          </label>
          <label>
            Opening quantity{" "}
            <input
              type="number"
              min={0}
              step="0.001"
              value={stockQuantity}
              onChange={(event) => setStockQuantity(Number(event.target.value))}
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || !unitPrice.trim() || createProduct.isPending}
          >
            Add product
          </button>
          {createProduct.error ? <p>{createProduct.error.message}</p> : null}
        </form>
      ) : (
        <p>{PRODUCT_PRICING_FORBIDDEN_MESSAGE}</p>
      )}
    </main>
  );
}

function StockAdjust({
  productId,
  stockQuantity,
  onAdjusted,
}: {
  productId: string;
  stockQuantity: number;
  onAdjusted: () => Promise<void>;
}) {
  const adjust = trpc.inventory.adjustStock.useMutation({
    onSuccess: async () => {
      operationId.current = crypto.randomUUID();
      setReason("");
      await onAdjusted();
    },
  });
  const operationId = useRef(crypto.randomUUID());
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const ready = quantity > 0 && reason.trim().length > 0 && !adjust.isPending;

  function submit(direction: 1 | -1) {
    if (!ready) return;
    if (direction < 0 && quantity > stockQuantity) return;
    adjust.mutate({
      id: productId,
      operationId: operationId.current,
      adjustment: quantity * direction,
      reason: reason.trim(),
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(1);
      }}
    >
      <label>
        Quantity{" "}
        <input
          type="number"
          min={0.001}
          step="0.001"
          aria-label="Stock adjustment quantity"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </label>
      <label>
        Reason{" "}
        <input
          maxLength={INVENTORY_ADJUSTMENT_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button type="submit" disabled={!ready}>
        Add
      </button>
      <button
        type="button"
        disabled={!ready || quantity > stockQuantity}
        onClick={() => submit(-1)}
      >
        Remove
      </button>
      {adjust.error ? <p>{adjust.error.message}</p> : null}
    </form>
  );
}
