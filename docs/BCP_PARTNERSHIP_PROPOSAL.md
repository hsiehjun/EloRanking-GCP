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

## 4. Live Platform Capability Showcase

OmniTactica is live and operational with four core feature sets driving engagement back to BCP:

1. **Player Hub & Elo Progression:** Tracks personal rating (1845.5), milestone progress toward High Warlord, verified BCP account connection, recent form, and active tournament registrations.
2. **Opponent Scouting Profiles:** Deep competitor intelligence (e.g., Folger Pyles, 90.1% win rate, Everchosen rank). Scouting an opponent's high win rate triggers the immediate urge to inspect their exact army list on BCP.
3. **Opponent Matchup Matrix:** Automatically isolates Favorite Prey Armies (+56.2 Elo vs. Orks) and Toughest Nemesis Armies (-31.0 Elo vs. Aeldari) with exact win rates and net Elo deltas.
4. **Event Discovery Hub & BCP Ticketing:** Geographically filtered tournament listings with direct ticket purchase and registration links pointing straight to BCP.

---

## 5. Collaboration vs. Competition: Strict Demarcation

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

## 6. Technical Architecture & Security Guarantees

1. **Strict Read-Only Backend Synchronization:**
   - Ingestion of tournament results occurs strictly through backend scheduled worker jobs.
   - The client web and mobile frontends have **zero write access** to BCP databases or our match sync tables.
2. **Zero Infrastructure Load on BCP:**
   - All compute-heavy algorithms run entirely on OmniTactica's Google Cloud Platform infrastructure.
3. **Official Attribution & Direct Deep Linking:**
   - Every tournament match record displays: `Verified Tournament Data provided by Best Coast Pairings`.
   - Roster inspection buttons deliberately route users to BCP's native app or website, strictly honoring BCP's subscription paywall for army list viewing.

---

## 7. A Collaborative Mindset: Open to Improvements & Roadmap Alignment

OmniTactica is built to empower the tabletop community in partnership with Best Coast Pairings. We view this as a flexible, cooperative partnership and are **completely open to feedback, feature improvements, custom UI adaptations, co-branding integration, or workflow adjustments** to ensure this partnership delivers maximum value and revenue for Best Coast Pairings.

---

## 8. Live Platform Demonstration & Contact

Experience the live platform and community suite:
- **Live Platform Demo:** [https://omnitactica.com](https://omnitactica.com)
- **Partnership Inquiries:** `partnership@omnitactica.com`

**OmniTactica looks forward to collaborating with Best Coast Pairings to grow community adoption and accelerate subscription revenue together.**
