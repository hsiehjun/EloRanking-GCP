import React from "react";
import { createRoot } from "react-dom/client";
import { AosTrackerProvider } from "./context/AosTrackerContext.jsx";
import { AosApp } from "./AosApp.jsx";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <AosTrackerProvider>
      <AosApp />
    </AosTrackerProvider>
  );
}
