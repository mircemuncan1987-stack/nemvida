// Server-side pristup Yahoo Finance-u — deljeno između /api/stock i
// /api/markets. Samo za server (rute), nikad iz browsera.
//
// Yahoo od 2024. traži "crumb" token (uz odgovarajući session cookie) čak i
// za osnovni chart API kad zahtev ne dolazi iz pravog browsera — bez toga
// vraća HTTP 401/403. Ovde se cookie/crumb pribavljaju jednom i keširaju u
// memoriji procesa (dovoljno kratko da se ne moraju tražiti pri svakom
// zahtevu, a dovoljno robusno da se automatski osveže ako Yahoo odbije
// zahtev sa trenutnim crumb-om).

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let cachedAuth: { cookie: string; crumb: string; fetchedAt: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

export async function fetchYahooAuth() {
  if (cachedAuth && Date.now() - cachedAuth.fetchedAt < AUTH_TTL_MS) return cachedAuth;

  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual",
  });
  const setCookie = cookieRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("Nije moguće pribaviti Yahoo sesijski kolačić");
  const cookie = setCookie.split(";")[0];

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`Nije moguće pribaviti Yahoo crumb (HTTP ${crumbRes.status})`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo crumb odgovor nije validan");

  cachedAuth = { cookie, crumb, fetchedAt: Date.now() };
  return cachedAuth;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Yahoo JSON nema stabilnu šemu; pozivaoci ga parsiraju tolerantno
export async function fetchUpstream(buildUrl: (crumb: string) => string, forceRefresh = false, revalidateSeconds = 300): Promise<any> {
  if (forceRefresh) cachedAuth = null;
  const auth = await fetchYahooAuth();
  const res = await fetch(buildUrl(auth.crumb), {
    headers: { "User-Agent": USER_AGENT, Cookie: auth.cookie, Accept: "application/json" },
    next: { revalidate: revalidateSeconds },
  });

  if ((res.status === 401 || res.status === 403) && !forceRefresh) {
    return fetchUpstream(buildUrl, true, revalidateSeconds);
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance je vratio HTTP ${res.status}`);
  }
  return res.json();
}
