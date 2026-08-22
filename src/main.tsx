import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installChunkErrorRecovery } from "./lib/chunkError.ts";
import "./index.css";

// Registered before render so a chunk that fails during the very first paint is
// still recovered — the route error boundary can only catch what reaches React.
installChunkErrorRecovery();

createRoot(document.getElementById("root")!).render(<App />);
