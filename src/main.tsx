import { render } from "preact";
import "./ui/styles.css";
import { App } from "./ui/App";
import { init } from "./ui/store";

void init().then(() => render(<App />, document.getElementById("app")!));
