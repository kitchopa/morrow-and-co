# Morrow & Co. payment backend

This Cloudflare Worker is the server-side half of the multi-item PayPal flow. It is intentionally fail-closed: it will not create an order until PayPal credentials, an allowed origin, a KV order store, and explicit shipping/tax amounts are configured.

## Required configuration

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` as Wrangler secrets.
- `ALLOWED_ORIGIN=https://kitchopa.github.io`.
- `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com` for sandbox testing; change only when production credentials and a production review are complete.
- `SHIPPING_AMOUNT` and `TAX_AMOUNT` chosen by the store owner. The current storefront does not publish a free-shipping or tax policy, so the example values are not a production decision.
- A Cloudflare KV namespace bound as `ORDERS` for order idempotency and capture records.

## Deployment outline

1. Copy `wrangler.toml.example` to `wrangler.toml` outside the public static site configuration and replace the KV IDs.
2. Run `wrangler secret put PAYPAL_CLIENT_ID` and `wrangler secret put PAYPAL_CLIENT_SECRET`.
3. Deploy with Wrangler.
4. Set `apiBase` in `checkout-config.js` to the Worker origin and set the public sandbox `paypalClientId`.
5. Run a sandbox transaction containing at least three products with different quantities.
6. Confirm `/api/health`, PayPal capture status `COMPLETED`, one captured KV record, and no second capture on refresh/retry before considering the flow production-ready.

The Worker validates every product and price from its own catalog. The browser cannot set a price, shipping amount, tax amount, or payment-success state.
