---
name: financial-integrity
description: "Use when changing tontine contributions, payments, loan balances, repayments, financial reports, or money-related database operations."
---

# Financial Integrity

## Workflow

1. Trace the amount, owner, status, and timestamps from the UI through the API to PostgreSQL.
2. Validate positive finite amounts, supported statuses/methods, referenced records, and currency precision at the API boundary.
3. Use database transactions when one action writes multiple related records.
4. Lock the parent financial row when concurrent updates could overpay or double-apply a balance.
5. Compute remaining balances from persisted ledger rows; never trust a client-supplied balance.
6. Reject payments or repayments that exceed the remaining amount; return a clear conflict/validation response.
7. Keep aggregates scoped to the authorized role and report period.
8. Test success, duplicate, invalid, boundary, rollback, and concurrent cases with isolated data and cleanup.

## Validation

- Confirm the transaction commits all related writes or none.
- Confirm retries and duplicate relationships do not create duplicate ledger entries.
- Confirm totals reconcile to ledger rows and rounding uses the supported currency precision.
- Never run cleanup or reset commands against production data.
