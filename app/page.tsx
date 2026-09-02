import type { Metadata } from "next";
import Wackelwerk from "./Wackelwerk";

export const metadata: Metadata = {
  title: "Wackelwerk – Ragdoll-Spiele visuell bauen",
  description:
    "Baue lustige Physikspiele ohne Code, teste sie sofort und exportiere sie als eigenständige HTML-Datei.",
};

export default function Home() {
  return <Wackelwerk />;
}
