import * as stylex from "@stylexjs/stylex";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./styles/ThemeProvider";

const qc = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: true, retry: 1, staleTime: 5000, gcTime: 5 * 60 * 1000 },
  },
});

const el = document.getElementById("root");
if (!el) throw new Error("Home Print Hub failed to start: missing #root element");
const root = el;
createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
