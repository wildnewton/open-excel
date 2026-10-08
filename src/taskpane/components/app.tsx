import type { FC } from "react";
import { ChatInterface } from "./chat";

interface AppProps {
  title: string;
}

const App: FC<AppProps> = () => (
  <div className="h-screen w-full overflow-hidden">
    <ChatInterface />
  </div>
);

export default App;
