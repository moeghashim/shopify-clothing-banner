import { useState } from "react";

import { ClothingRack, type RackItem } from "../../src";

const garment = (file: string) => `${import.meta.env.BASE_URL}garments/${file}`;

const ITEMS: RackItem[] = [
  { id: "tee-black", name: "Black tee", image: garment("tee-black-front.webp"), sideImage: garment("tee-black-side.webp") },
  { id: "hoodie-white", name: "White hoodie", image: garment("hoodie-white-front.webp"), sideImage: garment("hoodie-white-side.webp") },
  { id: "sweatshirt-black", name: "Black sweatshirt", image: garment("sweatshirt-black-front.webp"), sideImage: garment("sweatshirt-black-side.webp") },
  { id: "sweatshirt-white", name: "White sweatshirt", image: garment("sweatshirt-white-front.webp"), sideImage: garment("sweatshirt-white-side.webp") },
  { id: "hoodie-maroon", name: "Maroon hoodie", image: garment("hoodie-maroon-front.webp"), sideImage: garment("hoodie-maroon-side.webp") },
  { id: "tee-white", name: "White tee", image: garment("tee-white-front.webp"), sideImage: garment("tee-white-side.webp") },
  { id: "hoodie-sand", name: "Sand hoodie", image: garment("hoodie-sand-front.webp") },
];

const clean = new URLSearchParams(window.location.search).has("clean");

export function App() {
  const [rtl, setRtl] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <main className={clean ? "page clean" : "page"}>
      {clean ? null : (
        <header className="toolbar">
          <h1>Clothing banner</h1>
          <label>
            <input checked={rtl} onChange={(e) => setRtl(e.target.checked)} type="checkbox" /> Right to left
          </label>
        </header>
      )}
      <ClothingRack disabled={open !== null} items={ITEMS} onSelect={setOpen} rtl={rtl} tapHint="Tap to view" />
      {clean ? null : (
        <p className="hint">Hover (or drag a finger) across the rack. Click or tap a garment to select it.</p>
      )}
      {open === null ? null : (
        <div aria-label={ITEMS[open].name} aria-modal="true" className="dialog" onClick={() => setOpen(null)} role="dialog">
          <img alt={ITEMS[open].name} src={ITEMS[open].image} />
          <p>{ITEMS[open].name}</p>
          <button onClick={() => setOpen(null)} type="button">
            Close
          </button>
        </div>
      )}
    </main>
  );
}
