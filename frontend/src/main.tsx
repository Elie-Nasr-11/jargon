import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/router";
import "@/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

ReactDOM.createRoot(root).render(<RouterProvider router={router} />);
