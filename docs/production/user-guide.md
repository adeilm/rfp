# User guide (OliveSoft bid team)

How to use TendOlive day to day. The web app is at the address IT gives you (locally: `http://localhost:5173`).

## 1. The weekly cycle

1. **Tenders arrive.** RFP - Main runs (by hand from n8n, or on its weekly schedule): it collects new tenders, analyses
   them, checks each requirement against OliveSoft's CVs and projects, researches the buyer and the market, and starts
   the deck of the best tender. With Teams alerts on, a card per good tender is posted in the team's channel.
2. **You triage** in **Tenders**: the list is ranked by relevance and fit. Filter by status (In review, Bid, No-bid,
   Proposal ready).
3. **You decide** bid or no-bid on each tender worth reading (section 2).
4. **You review the deck** of the tenders you bid on, fix what is marked, approve the pricing and export (section 3).

## 2. Reading a tender and deciding

Open a tender. The tabs:

| Tab | What to check |
|---|---|
| **Overview** | Fit score, the system's recommendation and **its reason** (read it: "review first" says what to check), blocking gaps |
| **Requirements** | One row per requirement: covered / partial / missing, the evidence and where it comes from. *Partial* with a note ("equivalent technology", "not an exact match") needs your judgement |
| **Team** | The people proposed, from the CVs; near matches are listed but never staffed |
| **Gaps** | What OliveSoft cannot prove from its documents |
| **Prospect** | The buyer: registry data, contacts, past contracts (real buyers only) |
| **Market** | Comparable awarded contracts, typical winners, budget range |
| **Proposal** | Deck parameters and the deck runs |

Then press **Bid** or **No-bid** (with the reason). The decision is saved with the tender.

What the statuses mean: *covered* = a CV or project proves the requirement as written; *partial* = related evidence
only; *missing* = nothing in OliveSoft's documents proves it (it may still be true: add the evidence to the knowledge
base, section 5).

## 3. Reviewing and exporting the deck

1. Open the deck (**Proposal** tab or the tender's deck button). It opens in the editor.
2. Look for **`[TO FILL]`** markers: the system writes them where it found no fact instead of inventing one. Fill them
   or delete the element.
3. Check the slides the system cannot judge: executive summary, solution, team, references, risks.
4. **Refine with AI**: choose a slide, write an instruction ("more concise, three bullet points"), press *Refine slide*.
   Wait until the editor shows "Enregistré" before editing by hand again.
5. **Financial offer**: check the people-days and the cloud provider. Prices come from the Pricing page (section 4).
6. **Export** (PPTX or PDF). The export asks you to **approve the pricing** first, and warns about remaining
   placeholders. Approve only after checking the amounts.

## 4. Pricing (admins)

**Pricing** page:
- **Day rates** by role and level (junior, mid-level, senior) and the level each role is staffed with. Enter
  OliveSoft's real rates; the shipped junior and senior rates are estimates.
- **Support, contingency, margin** percentages added to the build cost.
- **Cloud**: the default provider, the USD/EUR rate, and the price of each item. *Update prices* fetches the public
  Azure, Google Cloud (with a key), ECB and AI prices. *Add provider* adds AWS or Oracle Cloud: enter their prices;
  a provider is used only once all its prices are entered.
- **AI APIs**: price per million tokens of each model, used when a tender asks for AI features.

Press **Save**. New decks use the new prices; existing decks keep theirs.

## 5. Knowledge base (admins)

What the matching can use as proof. Keep it current: a missing CV or project means *missing* in every tender.

- **People → Add CV**: choose the PDF; the fields are filled from the CV (job title, seniority, years, fields of
  experience, certifications, skills, languages). **Check every field**, complete what is empty, then *Add CV*.
  Indexing takes a few minutes. A scanned PDF has no text: fill the fields by hand.
- **Projects, Tech stacks, Tools, Clients → Add**: fill the form; *Save draft* keeps it out of the matching,
  *Save and index* makes it usable. A project is cited as a reference only when it is *completed*.
- Never add someone's CV without their agreement; remove the CVs of people who left (ask IT: deletion is manual today).

## 6. Teams bot

In the team's Teams channel or a chat with the bot:

| Type | Result |
|---|---|
| `help` | the commands, and whether you may run actions |
| `tenders` | the 5 best open tenders, with *Details*, *Matrix*, *Open* |
| `status` | the latest deck run |
| a question ("which tenders need Power BI?") | an answer from the system's data |
| *Generate deck*, *No-bid* buttons | actions, for approvers only |
| `alerts here` / `alerts off` | post (or stop) the new-tender alerts in this conversation |

## 7. When something looks wrong

| You see | Do |
|---|---|
| A requirement marked *missing* that OliveSoft can do | add the CV or project to the knowledge base; the next analysis uses it |
| A wrong *covered* | report it to IT with the tender id; do not rely on it in the bid |
| A deck run failed | start it again from the Proposal tab; if it fails again, tell IT (often an AI quota limit) |
| No new tenders this week | tell IT: the run's summary says which source failed |
