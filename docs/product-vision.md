# Jemip — Product Vision

> **Audience:** anyone who needs to understand what we are building and why — a new hire, a designer, an
> investor, a customer, or us in six months. **Deliberately non-technical.** For how it is built, see
> `CLAUDE.md`. For what exists today, see `docs/product-status.md`. For what must exist before we launch,
> see `docs/pre-launch-scope.md`.
>
> **Naming:** the product is being renamed **SOSH → Jemip**. This document uses Jemip throughout. The
> codebase, ADRs and build guides still say SOSH; that is the legacy internal name and it will be
> migrated deliberately, not opportunistically.

---

## The one-sentence version

**Jemip gives a startup the social media output of a €10–20k-per-month agency, for the price of a
software subscription — by knowing their company well enough to decide what is worth saying, and then
saying it in their voice.**

---

## Who it is for

Founders and marketing teams at B2B SaaS and tech startups with 1–100 employees.

These companies share a specific, painful shape:

- The founder has genuine expertise and no time to package it.
- Product work generates content opportunities constantly, and almost all of them are wasted.
- Social matters to them for real reasons — credibility, pipeline, recruiting, partnerships — not vanity.
- They cannot justify €10–20k a month for an agency, and cannot justify a marketing hire whose first six
  months are spent learning the product.

So they end up with the worst option: posting sporadically, in a voice that isn't quite theirs, about
whatever they happened to remember that week.

---

## The problem we are actually solving

Not scheduling. Scheduling was solved a decade ago and is worth roughly nothing.

**The problem is deciding what to say, and then saying it well enough to be worth having said.**

An agency solves this with people: someone who learns your business, interviews you monthly, mines your
work for stories, decides what matters this week, writes it in your voice, publishes it, replies to the
comments, and tells you at month end what worked. That is what €10–20k buys. It is not the writing —
it is the *judgment* around the writing, and the *consistency* of someone whose job it is.

Existing tools give you a text box and an AI button. That solves the least valuable ten minutes of the
process and leaves the hard part exactly where it was.

---

## What Jemip does

Jemip runs the loop an agency runs, continuously, and asks a human to approve the decisions that matter.

**1. It learns your company.**
Your voice from what you have actually published, not from a questionnaire. Your evidence — the customer
quotes, numbers and stories you are allowed to use publicly. What your audience keeps asking and
objecting to. What has worked for you before, and what hasn't. This is not a settings page; it is a
picture of your company that gets sharper every week.

**2. It notices when there is something worth saying.**
A release ships. A competitor moves. An article lands in your space. The same objection comes up for the
fifth time. A customer quote has been sitting unused for a month. Jemip watches the sources that matter to
*you* — a small world you define, not the whole internet — and surfaces the handful of things that are
genuinely worth a post.

**3. It turns a decision into a campaign, not a post.**
The unit of work is a campaign with an objective, an audience, an argument, evidence and a sequence — not
a lone tweet. Each post inside it has a job: the thesis, the founder's perspective, the customer proof,
the objection answered, the follow-up.

**4. It writes natively for each platform.**
Not one post copy-pasted five ways. A shared argument, executed differently on LinkedIn than on X, because
they are different rooms with different manners.

**5. You approve. Always.**
Nothing publishes without a human saying yes. This is a feature, not a limitation, and it is permanent —
there is no setting, plan or power-user mode that removes it. It is what makes the rest safe to automate.

**6. It publishes, then it handles the conversation.**
Scheduling, timing, formatting, retries. Then the comments and mentions come back in, classified, with
drafted replies waiting for your approval — because for a founder-led company, the replies matter as much
as the posts.

**7. It learns from what happened, and tells you.**
Which arguments land. Which formats work for which audience. What you are over-invested in and what you
are neglecting. Not a chart wall — a monthly account of what happened and what to do differently, of the
kind an agency sends to justify its invoice.

**And then it does it again, slightly better**, because everything in step 7 feeds back into step 1.

---

## What makes it different

Three things, and only three.

**It knows your company, and that knowledge compounds.**
Everyone has access to the same models. The difference is what the model is given. After six months Jemip
holds your voice, your evidence with its permissions and expiry dates, your audience's real objections,
and a record of what has actually worked for you. A competitor cannot copy that overnight, because it is
not code — it is your accumulated history. **This is the moat, and it is the only one that matters.**

**It exercises judgment, not just generation.**
Most tools answer *"write me a post."* Jemip answers *"is this worth posting at all, what should it argue,
and what evidence do we actually have?"* — and it will tell you when the honest answer is that an idea is
too thin to publish. Generating polished mediocrity on demand is a commodity. Declining to is not.

**It is honest about what it knows.**
When Jemip says a format works for you, it says how many posts that is based on. It flags claims it cannot
support with evidence you have. It does not imply causal precision that social data cannot deliver. This
sounds like modesty; it is actually the feature that makes a founder willing to press publish.

---

## What Jemip deliberately is not

- **Not autonomous.** It proposes; you decide. Permanently.
- **Not a design tool.** It produces the visual formats that carry reach on these platforms. It is not
  trying to be Canva.
- **Not an everything-channel platform.** Social. Not newsletters, blogs or SEO. That is a boundary we
  state rather than let people discover.
- **Not an enterprise suite.** No approval chains, no complex permission trees, no white-labelling. One
  company, one brand, a small team.
- **Not a replacement for relationships.** PR, events, influencer deals, crisis judgment — those are human
  work and we say so.

---

## Where this goes

**Now — augmentation.** A small marketing team with Jemip covers what a much larger one would. This is the
honest claim today, it is easy to demonstrate, and it is the one we lead with.

**Next — replacement.** Once the engagement inbox, visual formats, reporting and the founder-input engine
are in place, the comparison stops being *"a better scheduler"* and becomes *"the agency, at 1% of the
price."* That is the claim worth earning, and it is earned by closing specific gaps, not by marketing.

**Later — the compounding advantage.** The longer a company uses Jemip, the harder it is to leave — not
through lock-in, but because the system genuinely knows things about their business that a replacement
would take months to relearn. Value that grows with tenure is the rarest property in software, and this
product is shaped to have it.

---

## How we price, and why

€79/month and €125/month, per brand.

Deliberately far below an agency and above a scheduler, because that gap is the entire pitch. We price per
**brand workspace**, not per post or per token, because the customer is buying an outcome and should not
be metering their own creativity.

The trial is 14 days with a card, on a work email. We do not run a free-forever tier: this product's value
comes from what it learns about a company, and a user who never invests anything real never sees it work.

---

## What we would consider success

Not posts scheduled. That number can be gamed by a product that is actively wasting someone's time.

**A brand that completes the full loop — opportunity, campaign, publication, conversation, learning — and
whose next campaign is measurably better than the last.** Everything else is instrumentation.

---

## The uncomfortable truths we hold on to

1. **The blank page is the competitor**, not Hootsuite. If we reliably answer *"what should I say today?"*
   in under a minute, everything else can follow.
2. **Quality is judged against an agency, not against a tool.** A customer comparing us to Buffer is a
   customer we have priced wrong.
3. **The value is in what the system knows, so the input problem is the real problem.** Anything that gets
   more of the founder's brain into Jemip is worth more than anything that makes the writing marginally
   better.
4. **Trust is spent, not earned back.** One confidently wrong published claim costs more than a hundred
   good posts earn. Every design decision that looks like caution is actually this.
