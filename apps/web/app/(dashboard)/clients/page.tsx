import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = q?.trim() || undefined;
  const caller = appRouter.createCaller(await createTRPCContext());
  let list: Awaited<ReturnType<typeof caller.clients.list>>;
  try {
    list = await caller.clients.list({ search, limit: 25, offset: 0 });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED") {
      redirect("/login");
    }
    throw error;
  }

  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Clients</h1>
      <p>
        <a href="/clients/new">New Client</a>
      </p>
      <form action="/clients">
        <label>
          Search{" "}
          <input name="q" defaultValue={search ?? ""} />
        </label>
        <button type="submit">Search</button>
      </form>
      <p>{list.total === 1 ? "1 client" : `${list.total} clients`}</p>
      <ul>
        {list.items.map((client) => (
          <li key={client.id}>
            <a href={`/clients/${client.id}`}>
              {client.firstName} {client.lastName}
            </a>
            {client.email ? ` · ${client.email}` : ""}
            {client.phone ? ` · ${client.phone}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
