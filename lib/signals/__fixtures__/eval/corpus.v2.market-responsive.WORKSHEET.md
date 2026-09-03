# Market-responsive corpus — authoring worksheet

Not part of the eval corpus. Scaffolding only (sector/activity/target-verdict slots) — contains
no signal prose and no labels, so it does not touch `SIGNAL-MR-CORPUS-BLIND-LABELLED` or the
hand-authored-inputs ruling (ADR 0023 §10.5). Fill in `Headline` + `Body` yourself, in your own
words, then tell Claude Code to transcribe the filled rows into
`corpus.v2.market-responsive.template.json`.

**Per row, write:**
- **Headline** — one line, as it'd appear in a feed
- **Body** — 2-4 sentences, fictional publisher/company (never a real outlet — v1 convention)
- Leave **Verdict** as-is — it's your target, already spans the judgment boundary on purpose

**What makes something a `card`:** a concrete, non-speculative hook a B2B SaaS marketer could
credibly react to in their own brand voice — a competitor/market move, a regulatory shift, a
funding/M&A event, a platform change, or a citable trend — tied to something their audience cares
about. **What makes something `no_card`:** same shape of article, but generic/no specific hook,
rumor-tier, no plausible audience tie-in, gossip-adjacent, or already stale.

Don't reread the model's cassette before writing these — there isn't one yet, and per §10.5 the
label must never be influenced by seeing the model's answer.

---

## card (24) — spans clearly-card down toward the marginal edge

| # | Sector | Activity type | Headline | Body |
|---|---|---|---|---|
| c01 | DevTools / API platforms | Competitor pricing move | | |
| c02 | Fintech SaaS | Regulatory shift (payments) | | |
| c03 | Marketing SaaS | Platform algorithm/API change (ad channel) | | |
| c04 | HR/People-ops SaaS | Funding round (adjacent competitor) | | |
| c05 | Security/Compliance SaaS | New compliance mandate takes effect | | |
| c06 | Vertical SaaS (healthcare) | Major incumbent M&A | | |
| c07 | Vertical SaaS (legal) | Industry report with citable stat | | |
| c08 | E-commerce infra | Platform outage/reliability incident (industry-wide) | | |
| c09 | AI/LLM tooling | New model release changes buyer expectations | | |
| c10 | Data/analytics SaaS | Privacy law amendment | | |
| c11 | Collaboration/productivity SaaS | Major competitor feature parity gap closes | | |
| c12 | DevOps/infra SaaS | Cloud provider pricing change | | |
| c13 | Customer support SaaS | Layoffs at a major incumbent shift buyer sentiment | | |
| c14 | Sales/RevOps SaaS | New industry benchmark report | | |
| c15 | EdTech SaaS | Government funding/grant program announced | | |
| c16 | PropTech SaaS | Interest-rate-driven market shift | | |
| c17 | Supply chain SaaS | Tariff/trade policy change | | |
| c18 | Marketing SaaS | Social platform deprecates a widely-used API | | |
| c19 | DevTools | Open-source license change at a major dependency | | |
| c20 | Fintech SaaS | Competitor data breach / security incident | | |
| c21 | HR SaaS | New remote-work labor law | | |
| c22 | AI/LLM tooling | Pricing war between model providers | | |
| c23 | Vertical SaaS (real estate) | Major marketplace policy change | | |
| c24 | Generic B2B SaaS | Analyst firm (fictional) publishes category redefinition | | |

## no_card (16) — spans clearly-noise up toward the marginal edge

| # | Sector | Activity type | Headline | Body |
|---|---|---|---|---|
| n01 | DevTools | Unconfirmed rumor of acquisition | | |
| n02 | Marketing SaaS | Generic "5 tips" listicle, no news hook | | |
| n03 | Fintech | Executive personnel change, no strategic detail | | |
| n04 | HR SaaS | Conference recap with no new information | | |
| n05 | Security SaaS | Vague "threat landscape evolving" trend piece | | |
| n06 | Vertical SaaS | Local-market-only story, no broader relevance | | |
| n07 | AI/LLM tooling | Celebrity/influencer tangential mention of AI | | |
| n08 | DevOps SaaS | Minor changelog note reworded as "news" | | |
| n09 | E-commerce | Seasonal shopping-holiday puff piece | | |
| n10 | Sales SaaS | Opinion piece with no citable data | | |
| n11 | Collaboration SaaS | Meme/viral-tweet roundup | | |
| n12 | Data SaaS | Already-stale story (widely covered weeks earlier) | | |
| n13 | Fintech | Stock-price daily fluctuation, no fundamental news | | |
| n14 | PropTech | Real-estate gossip, no market signal | | |
| n15 | EdTech | Awards-list announcement, no product relevance | | |
| n16 | Generic B2B SaaS | Marginal: plausible hook but audience tie-in is a stretch | | |

---

**Marginal-edge rows worth extra care:** c24, n16 (and pick 1-2 more of your choosing to soften)
should be genuinely hard calls — not obviously either verdict — since the corpus's whole job is to
prove the triage script can find that line, not just recognize extremes.
