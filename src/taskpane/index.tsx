import { createRoot } from "react-dom/client";
import App from "./components/app";
import "./index.css";

/* global document, Office, module, require, HTMLElement */

const title = "OpenExcel";

const rootElement: HTMLElement | null = document.getElementById("container");
const root = rootElement ? createRoot(rootElement) : undefined;

Office.onReady(() => {
  root?.render(<App title={title} />);
});

if ((module as any).hot) {
  (module as any).hot.accept("./components/app", () => {
    const NextApp = require("./components/app").default;
    root?.render(NextApp);
  });
}
