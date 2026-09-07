# PTS Finance

Lightweight internal revenue, payroll and profitability dashboard for PTS Cooperation.

## Stack

- Vanilla HTML
- Vanilla CSS
- Vanilla JavaScript
- No framework
- No runtime dependencies
- No chart library
- No backend in V1
- Data stored in browser localStorage

This makes the site suitable for a static Cloudflare Pages deployment with practically no application-side CPU cost.

## Payroll model

For a project with:
- Revenue: $300
- Targetologist: $100 fixed
- Performance marketer: 30%
- Lead manager: 5% of full project revenue

The dashboard calculates:
- Performance base = $300 - $100 = $200
- Performance salary = $200 × 30% = $60
- Lead manager salary = $300 × 5% = $15
- Total payroll = $175
- Agency net = $125
- Net margin = 41.67%

## Features

- Monthly revenue / payroll / agency net overview
- Revenue vs net-profit 12-month chart
- Project profitability table
- Automatic salary formulas
- Team assignments
- Individual salary history
- Payroll analytics by role
- Agency margin chart
- Profitability ranking
- Payment status: paid / pending / overdue
- Month closing with immutable monthly snapshots
- JSON backup export/import
- Responsive black/white UI

## Monthly snapshots

Current project settings are treated as live data. Press **Close month** to freeze that month's economics into snapshots. Once a month is closed, later changes to project fees or salary rates do not rewrite that historical month.

## Deploy to Cloudflare Pages

Use the repository as a static site.

- Build command: leave empty
- Build output directory: `.`

No Node runtime is required.

## Persistence note

V1 stores data locally in the browser. This is deliberate to keep hosting and CPU usage effectively zero.

For secure multi-device or multi-user sync later, add Cloudflare D1 / KV or another small datastore and protect the dashboard with Cloudflare Access.
