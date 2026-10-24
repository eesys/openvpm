export interface Pagination {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

export function parsePagination(searchParams: URLSearchParams): Pagination {
  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(Math.floor(rawOffset), MAX_OFFSET)
      : 0;
  return { limit, offset };
}

export function paginated<T>(data: T[], pagination: Pagination, total: number) {
  return {
    data,
    pagination: { ...pagination, total },
  };
}
