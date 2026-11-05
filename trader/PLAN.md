# The $50–100 plan (A to Z)

Written 2026-11-05 for the trader-skill pack installed in `.claude/skills/`.
Not financial advice. This is a plan for running software that reads public
data and does arithmetic, with a stake small enough to lose without pain.

## A. What $50–100 can and cannot do

- **It cannot make meaningful money.** A great year on $75 (say +15 %) is
  about $11. A bad one is about –$20. The stake is tuition, not income.
- **It can buy you a working system.** By the end of this plan you have a
  broker account, a rules file, a pipeline that sizes, checks and places
  orders only with your yes, and a monthly routine. When you later put real
  money in, nothing changes except one number in `trader/config.json`.
- **Fractional shares are mandatory.** Apple costs hundreds of dollars a
  share. Alpaca lets you buy $12 of it. A broker without fractional shares
  makes this plan impossible at this size.
- **Funding fees can eat the stake.** An international wire of $75 can cost
  $15–25. Use a free funding route (local bank transfer, Wise, a card) or
  fund once with more than you intend to trade and leave the rest in cash.

## B. What was done today (in this repo)

- The 11 skills are installed project-locally in `.claude/skills/trader-*`.
  They appear as `/trader-copycat`, `/trader-budget`, and so on.
- The offline test suite (172 tests) passes. The upstream repo-layout test
  was removed because it only checks the author's own README and manifest.
- `trader/config.json` is set for small money: budget 75, 10 % cash buffer,
  25 % cap per stock, max order $25, min order $5, 6 orders a day,
  fractional on, **paper on**, no options, margin or shorting.
- `trader/targets.json` holds the pack's example targets: Berkshire
  Hathaway's top five from its Q2 2026 13F (holdings as of 2026-06-30,
  filed 2026-08-14), renormalised to 100.
- `trader/orders.json` holds the five proposed buys for a $75 budget. They
  all pass the risk check. Nothing has been placed; nothing can be placed
  from here.

## C. Where this has to run

This cloud session cannot reach Yahoo, SEC or any broker (the sandbox proxy
refuses those hosts), so the live steps below run on **your own computer**
in Claude Desktop or Claude Code with this repo open. The skills, config and
plan are committed so they are there when you clone it.

## D. One-time setup (about 45 minutes)

1. **Python 3.8+** on your machine. No pip installs. Optional: `pdftotext`
   (poppler) if you want the Pelosi skill to parse Congress PDFs locally.
2. **SEC user agent.** Edit `trader/config.json` and replace
   `"sec_user_agent": "Your Name you@example.com"` with your real name and
   email. SEC refuses anonymous scripts. This is the only personal detail
   the pack ever sends anywhere.
3. **Broker, paper first.** Open an Alpaca account (alpaca.markets). Check
   that your country of residence is on their list before you start. Create
   **paper** API keys in the dashboard. Do not create live keys yet.
4. **Connect the broker to Claude Desktop.** Settings > Developer > Edit
   Config, paste the block from
   `.claude/skills/trader-broker/claude_desktop_config.example.json`, put
   the paper keys in that file only, restart Claude Desktop.
5. **Lock the tool permissions.** Customize > Connectors > alpaca:
   `place_stock_order` = Needs approval. `close_all_positions`,
   `cancel_all_orders`, option and crypto order tools = Blocked. Read-only
   tools = Always allow. Never set an order tool to Always allow.
6. **Check it.** Ask Claude for the Alpaca account info and confirm in the
   dashboard that it is the paper account with $100,000 of fake money.

## E. Week 1: run the whole pipeline on paper

Run these as slash commands in the repo. Each one reads what the last wrote.

1. `/trader-copycat copy Berkshire top 5` — downloads the latest 13F-HR,
   rebuilds the weights, writes `trader/targets.json`. Read the diff: what
   they added, trimmed and sold since last quarter.
2. `/trader-budget 75` — sizes it. With today's targets and the config this
   gives:

   | stock | dollars | note |
   | --- | --- | --- |
   | AAPL | $18 | capped at 25 % |
   | AXP | $17 | |
   | GOOGL | $12 | |
   | KO | $11 | |
   | BAC | $9 | |
   | cash buffer | $7.50 | |
   | left idle | $0.50 | |

   At $50 it is 12 / 12 / 8 / 7 / 6 with $5 cash. At $100 it is
   25 / 23 / 16 / 14 / 12 with $10 cash.
3. `/trader-risk` — PASS or BLOCK per order. Today all five pass.
4. `/trader-broker` — shows one ticket at a time. You type "yes" for each.
   Claude calls `place_stock_order` on the paper account and its own
   Allow once / Deny card asks a second time. Five tickets, five yeses.
5. `/trader-alerts quote --holdings --write` — pulls delayed prices into
   `trader/prices.json`. Then `/trader-broker` records the fills as tax
   lots in `trader/portfolio.json`.

Do this once and watch it work. Then do it a second time with a different
investor (`/trader-copycat find ackman`, `find druckenmiller`, `find ark`)
to see how the targets, sizing and risk verdicts change. Nothing costs money.

## F. Week 2: pick the strategy you will actually fund

Three honest options for this stake. Pick one; do not mix.

- **Option 1, copy one investor (default).** Berkshire top 5 as above.
  Simple, five tickets, rebalanced quarterly when the next 13F posts.
  Caveat the skill will repeat every time: the filing is up to 45 days old,
  shows only long US positions, and you buy at today's price, not theirs.
- **Option 2, one broad ETF.** Set `trader/targets.json` to a single line,
  for example `{"ticker": "VOO", "name": "S&P 500 ETF", "weight": 100}`,
  and raise `max_position_pct` and `max_order_usd` to 100 in the config. One $67
  order, one yes.
  The least to learn, the least to go wrong, and still runs through
  budget, risk and broker. The risk skill accepts ETF tickers.
- **Option 3, your own screen.** `/trader-analyst AAPL MSFT KO ...` pulls
  filed revenue, margins and EPS from SEC XBRL; `/trader-screener` ranks
  them against rules you set (`.claude/skills/trader-screener/rules.example.json`).
  Most work, most learning, and at $75 it still buys the same five
  tiny slices.

Whatever you pick, keep the cash buffer. With `min_order_usd` at 5, any
slice under $5 is dropped automatically, so do not try to hold more than
about eight names at this size.

## G. Week 3: go live, small

1. In the Alpaca dashboard, fund the live account (mind the fee note in A).
2. Create **live** API keys. Put them in the Claude Desktop config in place
   of the paper keys, set `ALPACA_PAPER_TRADE` to `false` there, and set
   `"paper": false` in `trader/config.json`. The skills will never do this
   for you; it is deliberately your own two edits.
3. Run E again: copycat (or your targets) > budget > risk > broker. The
   risk skill prints a LIVE warning on every order. Say yes one ticket at
   a time, during NYSE hours (`/trader-alerts clock` tells you; it is
   09:30–16:00 New York, with the 2026–27 holiday calendar built in).
4. Record the fills so `trader/portfolio.json` holds real lots.

## H. Ongoing routine (15 minutes a week)

| when | command | what you get |
| --- | --- | --- |
| each morning you care to | `/trader-news` | new headlines and 8-K filings on what you hold, only what is new since last time |
| each morning | `/trader-alerts check` | your price targets or stops, plus the opening bell, each rings once |
| weekly | `/trader-pelosi` | new House stock disclosures as rows; flags any in stocks you hold. Public and 30–45 days late, so information, not an edge |
| monthly | `/trader-rebalance --band 10` | drift table. At $75 use a 10-point band, not the default 5: a 5-point drift is under $4 and would be dropped as below the $5 minimum anyway |
| quarterly, mid Feb / May / Aug / Nov | `/trader-copycat diff` then `/trader-rebalance` | the new 13F versus the last one, and the trades to match it. Risk and broker gates still apply |
| whenever you sell | `/trader-tax` | which lots, gain or loss, short or long term, wash-sale window |

Alerts and news can run on a schedule on your own machine. The broker skill
refuses to place anything from a scheduled run, by design: nobody is there
to say yes.

## I. Rules that stay fixed at this size

- Budget 75 (or whatever you fund), 10 % cash, 25 % cap, $25 max order,
  $5 min order, 6 orders a day, stocks and ETFs only.
- No options, margin, shorts or crypto. The config has them off and the
  risk skill blocks them.
- Never raise a limit in the middle of a run. Change the config, re-run
  risk, then broker.
- Never paste an API key into a chat. If you do, delete the message and
  make new keys.

## J. Taxes and residency (check, do not assume)

`/trader-tax` does lot arithmetic only. If you are not a US resident,
your broker will ask for a W-8BEN; US dividends are then withheld at source
and your home country's rules decide the rest. At $75 the harvesting
threshold (`--min-loss 100`) will never trigger, which is fine. Ask a
professional before relying on anything here.

## K. What I can do from this cloud session

- Keep the skills, config and this plan up to date in the repo.
- Change targets, budget, caps and rules in `trader/*.json` and re-run the
  sizing and risk checks offline (they need no network).
- Write rules for the screener and alert files for the alerts skill.
- Review the orders, lots and state files you commit after a run.

## L. What I cannot do, from anywhere

- Place, approve or schedule an order. Every order needs your typed yes and
  your click on Claude's card, one ticket at a time.
- Predict prices or promise a return.
- Reach Yahoo, SEC or a broker from this cloud sandbox. The live steps
  run on your computer.

## Z. The short version

Install done. Fill in your name and email in `trader/config.json`, open an
Alpaca paper account, connect it to Claude Desktop with the order tool on
Needs approval, then run copycat > budget > risk > broker on paper until
it is boring. Fund $75 through a free route, flip paper to live yourself,
run the same four steps once, and keep the weekly routine in H. Expect to
learn a lot and earn roughly nothing. That is the point of $75.
