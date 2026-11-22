import { redirect } from "next/navigation";

// Početna stranica je pregled tržišta (stranica Vesti je uklonjena).
export default function Home() {
  redirect("/trziste");
}
