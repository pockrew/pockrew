import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WebEntry } from "./entry";

import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("ROOT_ELEMENT_NOT_FOUND");
}

createRoot(rootElement).render(
  <StrictMode>
    <WebEntry />
  </StrictMode>,
);
