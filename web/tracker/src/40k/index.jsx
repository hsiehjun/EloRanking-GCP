import React from "react";
import { createRoot } from "react-dom/client";
import { TrackerProvider } from "./context/TrackerContext.jsx";
import { App } from "./App.jsx";
import { runAutomatedTests } from "./testRunner.js";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <TrackerProvider>
      <App />
    </TrackerProvider>
  );
  runAutomatedTests();
}
