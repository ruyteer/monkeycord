import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
    <Toaster
      theme="dark"
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!bg-popover !border-white/8 !text-foreground !rounded-xl",
          description: "!text-muted-foreground",
        },
      }}
    />
  </StrictMode>
);
