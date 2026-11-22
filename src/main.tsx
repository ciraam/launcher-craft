import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyThemeToDocument, readCachedTheme } from "@/lib/theme";

// Apply saved theme before first paint (CSP-safe, no inline script in index.html)
applyThemeToDocument(readCachedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
