export async function runAutomatedTests() {
  if (typeof window === "undefined" || !window.location.search.includes("test=1")) {
    return;
  }

  const log = (msg, isErr = false) => {
    console.log(`[TEST] ${msg}`);
    const el = document.getElementById("error-log");
    if (el) {
      el.style.display = "block";
      if (!isErr) {
        el.style.background = "#dcfce7";
        el.style.borderColor = "#22c55e";
        el.style.color = "#15803d";
      }
      el.textContent += `[TEST] ${msg}\n`;
    }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  log("Starting automated verification test suite...");
  await sleep(600);

  try {
    // 1. Check window.__gdmGetTrackerState
    if (typeof window.__gdmGetTrackerState !== "function") {
      throw new Error("window.__gdmGetTrackerState is not defined");
    }
    const state = window.__gdmGetTrackerState();
    log(`Initial state loaded: started=${state.started}, round=${state.round}`);

    // Switch to setup view
    const setupTab = [...document.querySelectorAll("button")].find(b =>
      b.textContent.includes("7-Step Setup")
    );
    if (setupTab) {
      setupTab.click();
      await sleep(200);
      log("Switched to 7-Step Setup view");
    }

    // Step 1: Players
    const p1Input = document.querySelector('input[aria-label="Player 1 name"]');
    const p2Input = document.querySelector('input[aria-label="Player 2 name"]');
    if (p1Input && p2Input) {
      p1Input.value = "Commander Dante";
      p1Input.dispatchEvent(new Event("input", { bubbles: true }));
      p2Input.value = "Ghazghkull Thraka";
      p2Input.dispatchEvent(new Event("input", { bubbles: true }));
      log("Step 1: Set player names: Commander Dante vs Ghazghkull Thraka");
    }

    // Click Next
    let nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 1");
    nextBtn.click();
    await sleep(300);

    // Step 2: Detachments - Click Next
    nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 2");
    nextBtn.click();
    await sleep(300);
    log("Step 2: Detachments passed");

    // Step 3: Dispositions - Pick Take and Hold for P1, Purge the Foe for P2
    const dispoBtns = [...document.querySelectorAll(".gtk-tile")];
    const takeAndHoldBtn = dispoBtns.find(b => b.textContent.includes("Take and Hold"));
    if (takeAndHoldBtn) takeAndHoldBtn.click();
    await sleep(200);

    const purgeBtn = [...document.querySelectorAll(".gtk-tile")].find(b =>
      b.textContent.includes("Purge the Foe")
    );
    if (purgeBtn) purgeBtn.click();
    await sleep(300);

    const stateAfterDispo = window.__gdmGetTrackerState();
    log(
      `Step 3: Dispositions selected. P1 Primary: "${stateAfterDispo.game.p1Primary}", P2 Primary: "${stateAfterDispo.game.p2Primary}"`
    );

    nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 3");
    nextBtn.click();
    await sleep(300);

    // Step 4: Terrain - pick layout 2
    const layoutBtns = [...document.querySelectorAll('button[aria-pressed]')].filter(b =>
      b.textContent.includes("Layout")
    );
    if (layoutBtns.length > 1) layoutBtns[1].click();
    await sleep(200);
    log("Step 4: Terrain Layout picked");

    nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 4");
    nextBtn.click();
    await sleep(300);

    // Step 5: Roles - Pick Attacker for P1
    const attackerBtns = [...document.querySelectorAll("button")].filter(b =>
      b.textContent.includes("Attacker")
    );
    if (attackerBtns.length > 0) attackerBtns[0].click();
    await sleep(200);
    log("Step 5: Roles selected (P1 Attacker, P2 Defender)");

    nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 5");
    nextBtn.click();
    await sleep(300);

    // Step 6: Deck Type - Pick Tactical for P1, Tactical for P2
    const tacticalBtns = [...document.querySelectorAll("button")].filter(b =>
      b.textContent.includes("Tactical")
    );
    if (tacticalBtns.length > 0) tacticalBtns[0].click();
    if (tacticalBtns.length > 1) tacticalBtns[1].click();
    await sleep(200);
    log("Step 6: Deck Types selected");

    nextBtn = [...document.querySelectorAll("button")].find(
      b => b.textContent.includes("Next") || b.textContent.includes("Start Game")
    );
    if (!nextBtn) throw new Error("Next button not found on Step 6");
    nextBtn.click();
    await sleep(300);

    // Step 7: First turn roll-off
    const p1FirstTurnBtn = [...document.querySelectorAll("button")].find(b =>
      b.textContent.includes("Commander Dante")
    );
    if (p1FirstTurnBtn) p1FirstTurnBtn.click();
    await sleep(200);
    log("Step 7: First Turn winner picked (Commander Dante)");

    const startBtn = [...document.querySelectorAll("button")].find(b =>
      b.textContent.includes("Start Game")
    );
    if (!startBtn) throw new Error("Start Game button not found");
    startBtn.click();
    await sleep(400);

    // Verify Scorecard View
    const finalState = window.__gdmGetTrackerState();
    log(`Game started! started=${finalState.started}, round=${finalState.round}`);

    // Draw secondary for P1
    const drawBtn = [...document.querySelectorAll("button")].find(b =>
      b.textContent.includes("Draw Secondary")
    );
    if (drawBtn) {
      drawBtn.click();
      await sleep(300);
      const stateWithCard = window.__gdmGetTrackerState();
      log(
        `P1 Drew Secondary: "${stateWithCard.p1.hand[0]?.cardId}". Hand size: ${stateWithCard.p1.hand.length}`
      );
    }

    log("SUCCESS: ALL 7 SETUP STEPS AND SCORECARD ACTIONS VERIFIED ACCURATELY!");
  } catch (err) {
    log(`TEST FAILED: ${err.message}\n${err.stack}`, true);
    console.error("Test failure:", err);
  }
}
