# Strategic Partnership Proposal: Best Coast Pairings & OmniTactica
## Unlocking Year-Round Player Engagement, Competitive Retention, and BCP Subscription Growth

**Prepared by:** OmniTactica Leadership  
**Target Partner:** Best Coast Pairings (BCP) Executive Team  
**Subject:** Collaborative Data Integration & Ecosystem Revenue Synergy  
**Status:** Confidential Partnership Proposal  

---

## 1. Executive Summary: The Mutual Opportunity

Tabletop wargaming is experiencing an unprecedented golden era of competitive participation. At the heart of this thriving ecosystem stands **Best Coast Pairings (BCP)**—the definitive gold standard for tournament organization, Swiss pairings, and live match logging.

However, BCP’s monetization model faces an inherent industry dynamic:
1. **Player Subscriptions:** Monetized primarily through the ability to view opponent and tournament **"Lists"** (army rosters) and pairings.
2. **Event Organizer (TO) Subscriptions:** Monetized through tournament management software subscriptions and player ticket processing.

Because competitive tournaments predominantly occur on weekends, player activity exhibits sharp spikes on Saturday and Sunday, followed by drop-offs throughout the workweek. Once a tournament concludes, match records sit archived in static standings tables. Players lack a persistent, week-round progression loop to track cumulative skill growth, analyze past match data, and scout future competition.

**OmniTactica is designed as the engagement companion to Best Coast Pairings—not a competitor.** 

By partnering to utilize BCP's tournament match data via a secure, read-only backend sync:
- **For Players:** OmniTactica transforms raw tournament match results into a standardized, chess-grade **Elo Rating System**, **Tier Milestones**, **Opponent Matchup Matrices**, and **Local Event Discovery**.
- **For Best Coast Pairings:** OmniTactica serves as an **active conversion funnel for BCP's core subscriptions**. Every time a player scouts an upcoming opponent's Elo or faction record, OmniTactica directs them to BCP with an explicit call-to-action: *"Unlock & View Full Roster on Best Coast Pairings (BCP Subscription Required)"*. Furthermore, our event discovery engine directly promotes BCP tournaments, driving ticket sales and expanding TO subscription adoption.

---

## 2. Understanding BCP's Business Model & Growth Levers

| BCP Revenue Stream | Core Value Metric | Current Growth Challenge | OmniTactica Partnership Solution |
| :--- | :--- | :--- | :--- |
| **Player Subscriptions** | Ability to view published army lists, rosters, and pairings. | Casual & semi-competitive players only subscribe right before an event, leading to off-season churn. | **Continuous Scouting Incentive:** When players review their opponent's 70%+ win rate and matchup history on OmniTactica, their natural next action is to view the exact army list on BCP—driving recurring, year-round player subscriptions. |
| **Event Organizer (TO) Subscriptions** | Tournament planning tools, player check-in, scoring, and ticketing. | TOs need filled tables to justify organizing events and maintaining active BCP subscriptions. | **Event Discovery & Ticket Funnel:** Integrated regional tournament search and Sparring Radar direct local players straight to BCP registration pages, increasing event fill rates and TO retention. |

---

## 3. The Tabletop Player Experience: Easing Friction & Driving Retention

Modern competitive players across all esports and tabletop games share three psychological drivers:
1. **Visualizing Personal Skill Growth:** Players want proof of their development. Standard win-loss records do not capture whether a victory was against a national champion or a beginner. A chess-grade Elo system gives every game lasting stakes and prestige.
2. **Opponent Intelligence & Scouting:** Players experience anxiety before round 1. They want to know: *Who is my opponent? What factions do they master? What are their recent trends?*
3. **Discovering Competition:** Players actively seek local game stores, active sparring partners, and nearby RTTs/GTs.

By resolving these friction points, players stay engaged in the hobby 7 days a week, keeping the competitive circuit top-of-mind and dramatically increasing tournament participation.

---

## 4. The BCP Monetization Flywheel

```
┌────────────────────────────────────────────────────────────────────────┐
│                        THE BCP REVENUE FLYWHEEL                        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
       1. Player Scouts Opponent on OmniTactica
          - Sees Opponent's Elo (e.g., 1950 Grand Marshal)
          - Analyzes Opponent's 72% Faction Win Rate
                                    │
                                    ▼
       2. Strategic Intent & List Curiosity Triggered
          - "What exact units & enhancements are they running?"
                                    │
                                    ▼
       3. Direct Funnel to Best Coast Pairings
          - CTA: "View Full Submitted Roster on BCP"
          - Direct deep link to BCP's paywalled list view
                                    │
                                    ▼
    ★ CONVERSION 1: BCP Player Subscription Acquired/Retained!
                                    │
                                    ▼
       4. Elo Progression Inspires Next Competition
          - Player needs 30 Elo points to reach High Warlord tier
          - Discovers upcoming local RTT via OmniTactica Event Search
                                    │
                                    ▼
       5. Direct Registration via BCP
          - Clicks "Buy Ticket / Register on BCP"
          - TO fills tournament capacity early
                                    │
                                    ▼
    ★ CONVERSION 2: BCP TO Subscription Retained & Upgraded!
```

---

## 5. Ecosystem Demarcation: Collaboration vs. Competition

We respect BCP’s position as the tournament pairing and data authority. OmniTactica strictly delineates its scope to ensure zero overlap or friction:

| Functional Area | Best Coast Pairings (Core Authority) | OmniTactica (Synergistic Companion) | Why This Protects BCP |
| :--- | :--- | :--- | :--- |
| **Tournament Pairings & Rounds** | **100% Owned by BCP** (Swiss pairing engine, table timers, judge tools) | **Zero Pairing Tools** (Does not run tournaments or pairings) | BCP remains the sole operational tool for running events. |
| **Army List Repository** | **100% Owned by BCP** (Lists uploaded and gated behind BCP subscription) | **Zero Paywalled List Hosting** (Deep-links directly to BCP) | Protects BCP's list subscription revenue stream completely. |
| **Live Round Check-In** | **100% Owned by BCP** | **Zero Tournament Check-In** | Ensures all live event traffic remains within BCP apps. |
| **Elo Ratings & Growth Tiers** | Not BCP's primary focus (Event standings only) | **Dedicated Elo Engine** (Calculates skill deltas, milestones, decay) | Adds permanent value to raw BCP match data. |
| **Matchup Matrices & Scouting** | Not BCP's primary focus | **Pre-Match & Post-Match Analytics** (Nemesis factions, head-to-head records) | Drives mid-week engagement and list-view curiosity. |
| **Event Discovery** | BCP Official Event Listing & Ticketing | **Community Directory** (Directs players to BCP ticket checkout) | Amplifies BCP event discovery and ticket sales. |

---

## 6. Technical Architecture & Security Guarantees

Our technical implementation is engineered around two non-negotiable principles: **zero client-side writes** and **zero operational burden on BCP**.

1. **Strict Read-Only Backend Synchronization:**
   - OmniTactica ingests tournament results strictly via backend scheduled worker jobs (e.g., Cloud Scheduler).
   - The client web and mobile interfaces have **zero write access** to BCP databases or our internal match sync tables.
2. **Off-Host Serverless Computation:**
   - All compute-heavy algorithms (Elo calculations, matchup matrix aggregations, decay tracking) run entirely within OmniTactica’s Google Cloud Platform (Cloud Run / Cloud SQL) infrastructure.
   - BCP infrastructure experiences zero additional load or database locks.
3. **Official Attribution & Deep Linking:**
   - Every tournament match record, tournament result card, and player ranking is tagged with: `Verified Tournament Data provided by Best Coast Pairings`.
   - Links to events and rosters seamlessly route users to `bestcoastpairings.com` and BCP mobile apps.

---

## 7. Platform Capabilities & Live Demonstration

The OmniTactica platform is fully implemented and operational across all modern device form factors:

### Desktop Experience (1440 × 900)
- **Player Hub & Skill Progression:** Visualizes current Elo, peak rating, tier progress bar (e.g., High Warlord), active faction mastery, and verified BCP account integration.
- **Opponent Matchup Matrix:** Automatically isolates Favorite Prey Armies vs. Toughest Nemesis Armies with exact win rate percentages and net Elo deltas.
- **Competitor Scouting:** Comprehensive search allowing players to scout upcoming rivals (e.g., Folger Pyles, Everchosen tier, 90.1% win rate).
- **Event Discovery Hub:** Geographically filtered RTT, GT, and Major listings with instant ticket purchase links pointing directly to BCP.

### Responsive Tablet & Mobile Viewports (768 × 1024 & 390 × 844)
- Touch-optimized, stacked card layouts designed for quick pre-round scouting at crowded tournament venues.
- Instant access to tournament journeys and historical round-by-round results.

---

## 8. Proposed 90-Day Partnership Pilot

To validate the revenue lift for Best Coast Pairings with zero initial risk, we propose a 90-day pilot partnership:

1. **Phase 1: Official Data Collaboration (Weeks 1–3)**
   - Establish an authorized read-only API sync or scheduled export webhook.
   - Embed official BCP co-branding (`"Powered by BCP"`) and deep-link hooks.
2. **Phase 2: Targeted Circuit Pilot (Weeks 4–8)**
   - Launch co-branded integration across a select tournament circuit (e.g., US Open Series or regional Major).
   - Track player click-through rates from OmniTactica scouting cards to BCP subscription list pages.
3. **Phase 3: Impact Review & Long-Term Agreement (Weeks 9–12)**
   - Review conversion metrics: player list-view subscriptions initiated, event ticket conversions, and player retention.
   - Finalize a long-term data partnership and revenue-sharing framework.

---

## 9. Conclusion: Better Together

Best Coast Pairings built the foundation of modern competitive tabletop wargaming. OmniTactica builds upon that foundation by giving players daily reasons to celebrate their progress, scout their rivals, and enter the next event.

Together, we can transform tournament play from an occasional weekend hobby into an active, year-round competitive sport—expanding community participation and accelerating BCP subscription growth.

**We welcome the opportunity to discuss this proposal with the BCP executive team.**

*Contact: partnership@omnitactica.com*  
