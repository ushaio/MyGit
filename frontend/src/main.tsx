import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { WorkbenchProvider } from "@/lib/workbench";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    if (this.state.error)
      return (
        <div role="alert" className="m-6 rounded-md border p-5">
          <h1 className="font-semibold">MyGit</h1>
          <pre className="my-4 whitespace-pre-wrap text-xs">
            {this.state.error}
          </pre>
          <button
            className="text-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>
        <WorkbenchProvider>
          <App />
        </WorkbenchProvider>
        <Toaster position="bottom-right" closeButton richColors />
      </TooltipProvider>
    </ThemeProvider>
  </ErrorBoundary>,
);
