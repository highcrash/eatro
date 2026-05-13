# Integration Examples

Worked examples for consuming the Restora External API from common runtimes. All examples assume:

- `RESTORA_API_BASE` is set to `https://your-restora-host/api/v1/external`
- `RESTORA_API_KEY` is set to the plaintext key (`rk_<prefix>_<secret>`) from Admin → Integrations

---

## curl

```bash
# Business profile
curl "$RESTORA_API_BASE/business/profile" \
  -H "Authorization: Bearer $RESTORA_API_KEY"

# Last 30 days of sales (zero-filled time series)
curl "$RESTORA_API_BASE/business/sales/daily?days=30" \
  -H "Authorization: Bearer $RESTORA_API_KEY"

# Customer segment: spent ≥ 5000 BDT, visited in last 60 days
curl "$RESTORA_API_BASE/business/customers/segment?minSpent=5000&maxLastVisitDays=60" \
  -H "Authorization: Bearer $RESTORA_API_KEY"
```

---

## Node.js (built-in `fetch`, Node 18+)

```ts
const BASE = process.env.RESTORA_API_BASE!;
const KEY = process.env.RESTORA_API_KEY!;

async function callRestora<T>(path: string): Promise<{ data: T; meta: Meta }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Restora API ${res.status}: ${body}`);
  }
  return res.json() as Promise<{ data: T; meta: Meta }>;
}

interface Meta {
  branchId: string;
  generatedAt: string;
  currency: string;
  timezone: string;
}

// Money fields are in MINOR UNITS (paisa). Read meta.currency for the unit.
const { data, meta } = await callRestora<{ series: { date: string; revenue: number; orders: number }[] }>(
  '/business/sales/daily?days=30',
);
console.log(`Currency: ${meta.currency}, last day: ${data.series.at(-1)?.revenue ?? 0}`);
```

---

## Python

```python
import os
import httpx

BASE = os.environ["RESTORA_API_BASE"]
KEY = os.environ["RESTORA_API_KEY"]

client = httpx.Client(
    base_url=BASE,
    headers={"Authorization": f"Bearer {KEY}"},
    timeout=30.0,
)

# Pull a snapshot of everything the Marketing AI agent needs
profile = client.get("/business/profile").raise_for_status().json()
sales = client.get("/business/sales/daily", params={"days": 90}).raise_for_status().json()
performance = client.get("/business/performance").raise_for_status().json()
customers = client.get("/business/customers").raise_for_status().json()
loyalty = client.get("/business/loyalty/summary").raise_for_status().json()

print({
    "business": profile["data"]["name"],
    "currency": profile["meta"]["currency"],
    "90d_revenue_paisa": sum(d["revenue"] for d in sales["data"]["series"]),
    "customer_count": customers["data"]["total"],
})
```

---

## Error handling pattern

The API uses standard HTTP status codes. Common failures:

| Status | Meaning                                          | Action                                                |
| ------ | ------------------------------------------------ | ----------------------------------------------------- |
| 401    | Missing / malformed / wrong / revoked / expired  | Mint a new key from Admin → Integrations              |
| 403    | Key valid but lacks the scope this route needs   | Mint a key with the scope, or amend (revoke + re-mint) |
| 404    | Resource not found on this branch                | Re-check IDs; never trust client-supplied branchId    |
| 429    | Rate limited (planned, currently inactive)       | Back off + retry                                      |
| 5xx    | Restora-side error                                | Surface to the user; retry with backoff               |

Always inspect the JSON body — error responses include `{ message, error, statusCode }` with details (e.g. `"Missing scopes: reports:read"`).

---

## Recommended cache TTLs

The data is mostly point-in-time aggregates and changes slowly. Suggested client-side cache for the AI Marketing Agent:

| Route                            | Reasonable TTL  |
| -------------------------------- | --------------- |
| `business/profile`               | 24 h            |
| `business/menu`                  | 1 h             |
| `business/inventory`             | 5 min           |
| `business/sales/daily`           | 15 min          |
| `business/sales/by-category`     | 15 min          |
| `business/sales/top-items`       | 15 min          |
| `business/performance`           | 1 h             |
| `business/customers`             | 1 h             |
| `business/customers/segment`     | 5 min (queries change with filter) |
| `business/loyalty/summary`       | 1 h             |
| `business/marketing/campaigns`   | 5 min           |
| `business/finance/expenses`      | 30 min          |
| `business/reviews`               | 1 h             |

Use prompt caching on the Anthropic side for any large structured context derived from these calls.
