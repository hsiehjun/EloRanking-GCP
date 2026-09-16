# Strategic Partnership Proposal: Best Coast Pairings & OmniTactica
## Supercharging Player Engagement, Community Growth, and BCP Subscription Revenue

**Prepared by:** OmniTactica Leadership  
**Target Partner:** Best Coast Pairings (BCP) Executive Team  
**Subject:** Collaborative Data Integration & Ecosystem Revenue Synergy  
**Status:** Partnership Proposal  

---

## 1. Executive Summary: What OmniTactica Is & How It Helps BCP

Best Coast Pairings (BCP) is the premier tournament software platform in tabletop wargaming, serving as the trusted authority for event registration, live Swiss pairings, and official roster submissions. BCP monetizes primarily through two subscription offerings:
1. **Player Subscriptions:** Unlocking the ability to view opponent and tournament **"Lists"** (army rosters) and pairings.
2. **Event Organizer (TO) Subscriptions:** Subscriptions for tournament organizers to create, manage, and ticket events.

**OmniTactica is an engagement and progression companion built to supplement Best Coast Pairings—not compete with it.**

OmniTactica utilizes official BCP tournament match data to provide players with what they love most: **tracking their personal growth through a standardized Elo rating system, scouting upcoming opponents' stats and matchup histories, and discovering local community events**.

By connecting player enthusiasm directly to BCP's core services, OmniTactica serves as an organic conversion funnel for BCP:
- **Drives Player Subscriptions:** When players scout an opponent’s Elo, win rate, and faction trends on OmniTactica, OmniTactica provides a direct call-to-action: *"View Full Army List on Best Coast Pairings (BCP Subscription Required)"*, turning tactical curiosity into paying BCP subscribers.
- **Drives TO Subscriptions:** OmniTactica's event search and community directory direct local players to register and purchase tickets for upcoming BCP tournaments, filling brackets faster and increasing TO retention.

---

## 2. How OmniTactica Helps Tabletop Players

Tabletop competitors are passionate about self-improvement and community connection. OmniTactica delivers three key capabilities that players actively seek:

1. **Standardized Elo Rating & Personal Growth:**
   - Gives players lasting milestones across their tournament journey (from Apprentice to Everchosen).
   - Allows competitors to visualize their skill progression over time, making every game played at a BCP event feel meaningful and rewarding.
2. **Opponent Stats & Matchup Scouting:**
   - Gives players instant visibility into their upcoming opponent's win rate, top factions, and historical performance.
   - Generates Opponent Matchup Matrices showing performance against different armies, Favorite Prey factions, and Toughest Nemeses.
3. **Event & Community Discovery:**
   - Features an integrated tournament search and local game store directory.
   - Connects players to active local sparring groups and nearby tournaments, lowering barriers to competitive participation.

---

## 3. How OmniTactica Directly Expands BCP Revenue

OmniTactica aligns seamlessly with BCP's two primary revenue streams:

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
          - "What exact units and enhancements are they running?"
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
          - Player seeks next Elo tier (e.g., High Warlord)
          - Discovers upcoming local GT via OmniTactica Event Search
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

## 4. Collaboration vs. Competition: Strict Demarcation

OmniTactica respects BCP’s role as the authoritative tournament engine and maintains strict operational boundaries:

| Functional Area | Best Coast Pairings (Sole Authority) | OmniTactica (Engagement Companion) | Why This Protects BCP |
| :--- | :--- | :--- | :--- |
| **Tournament Pairings & Rounds** | **100% Owned by BCP** (Swiss pairings, round clocks, check-ins, table assignments) | **Zero Pairing Tools** (Does not run tournaments or pairings) | BCP remains the sole operational tool for running events. |
| **Army List Repository** | **100% Owned by BCP** (Lists uploaded and gated behind BCP subscription) | **Zero Paywalled List Hosting** (Deep-links directly to BCP) | Protects and increases BCP list-view subscription revenue. |
| **Live Round Check-In** | **100% Owned by BCP** | **Zero Tournament Check-In** | Ensures all live event traffic remains within BCP apps. |
| **Elo Ratings & Growth Tiers** | Event standings only | **Standardized Global Elo** (Calculates skill deltas, milestones, decay) | Transforms BCP match data into lasting personal value. |
| **Opponent Scouting & Matrices** | Raw event tables | **Matchup Matrices & Nemesis Tracking** | Keeps players engaged throughout the week and prompts list lookups. |
| **Event Discovery Hub** | BCP Official Event Listing & Ticketing | **Community Directory** (Directs players to BCP ticket checkout) | Amplifies BCP event discovery and ticket sales. |

---

## 5. Technical Architecture & Security Guarantees

Our technical implementation ensures zero friction and complete data safety:

1. **Strict Read-Only Backend Synchronization:**
   - Ingestion of tournament results occurs strictly through backend scheduled worker jobs.
   - The client web and mobile frontends have **zero write access** to BCP databases or our match sync tables.
2. **Zero Infrastructure Load on BCP:**
   - All compute-heavy algorithms (Elo calculations, matchup matrix aggregations, search queries) run entirely on OmniTactica's Google Cloud Platform infrastructure.
3. **Official Attribution & Direct Deep Linking:**
   - Every tournament match record and event card displays: `Verified Tournament Data provided by Best Coast Pairings`.
   - Roster inspection buttons deliberately route users to BCP's native app or website, strictly honoring BCP's subscription paywall for army list viewing.

---

## 6. Live Platform Demonstration

The OmniTactica platform is fully implemented and responsive across Desktop, Tablet, and Mobile:
- **Player Hub & Skill Progression:** Visualizes current Elo, peak rating, tier progress (e.g., High Warlord), active faction mastery, and verified BCP account integration.
- **Opponent Scouting & Profiles:** In-depth competitor intelligence highlighting win rates, match history, and top factions.
- **Opponent Matchup Matrix:** Automatically isolates Favorite Prey Armies vs. Toughest Nemesis Armies with exact win rates and net Elo deltas.
- **Event Discovery Hub:** Geographically filtered tournament listings with direct ticket purchase links pointing straight to BCP.

---

## 7. Proposed Partnership Next Steps

We propose a low-risk, collaborative pilot aligned with upcoming tournament circuits:
1. **API Collaboration:** Establish an authorized read-only data sync or export webhook.
2. **Co-Branding & Funnel Tracking:** Embed official BCP attribution and measure list-view subscription conversions and ticket click-through volume.
3. **Review & Expansion:** Review conversion metrics and formalize an ongoing partnership framework.

**OmniTactica looks forward to collaborating with Best Coast Pairings to grow community adoption and accelerate subscription revenue together.**

*Contact: partnership@omnitactica.com*  
