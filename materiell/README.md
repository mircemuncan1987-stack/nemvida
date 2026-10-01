# Ord for hverdagen – utskriftbart materiell (norsk)

Materiell for bokstav- og ordinnlæring, bygget på 50 høyfrekvente hverdagsord.
Alle PDF-er ligger i `pdf/`. Skriv ut i A4, 100 % størrelse.

| Fil | Innhold |
|---|---|
| `00_veiledning_og_oversikt` | Veiledning til voksne + oversikt over de 50 ordene |
| `01_ordkort_bilde_og_ord` | 50 kort med bilde og ord |
| `02_bildekort_kun_bilde` | Samme kort, bare bilde (til parring) |
| `03_ordkort_kun_ord` | Samme kort, bare ord (til parring) |
| `04_velg_riktig_ord` | 50 oppgaver: bilde + to ord å velge mellom, med fasit |
| `05_kommunikasjonstavle` | 50 flis-bilder (tavle) + setningsstriper |
| `06_bokstavkort` | 29 bokstavkort (hele alfabetet A–Å) (stor/liten bokstav + bilde) |
| `10`–`17` `bok1`–`bok4` | Lettleste bøker (Jeg vil ha / Jeg er / Jeg vil / Jeg ser), nivå 1 (bilde ved ordene) og nivå 2 (bare ord), med fasit |

Bygges på nytt med `node src/bygg.mjs` (krever Playwright/Chromium og fonten Noto Color Emoji).
Ordlisten og kategoriene ligger i `src/ord.mjs`.
