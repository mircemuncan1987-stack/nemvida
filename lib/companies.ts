export type Company = {
  ticker: string;
  name: string;
  displayName: string;
  yahooSymbol?: string;
  searchTerms: string[];
};

export const companies: Company[] = [
  { ticker: "V", name: "Visa", displayName: "Visa (V)", yahooSymbol: "V", searchTerms: ["Visa Inc stock"] },
  { ticker: "MA", name: "Mastercard", displayName: "Mastercard (MA)", yahooSymbol: "MA", searchTerms: ["Mastercard stock"] },
  { ticker: "AXP", name: "American Express", displayName: "American Express (AXP)", yahooSymbol: "AXP", searchTerms: ["American Express stock"] },
  { ticker: "NVDA", name: "Nvidia", displayName: "Nvidia (NVDA)", yahooSymbol: "NVDA", searchTerms: ["Nvidia stock"] },
  { ticker: "AMZN", name: "Amazon", displayName: "Amazon (AMZN)", yahooSymbol: "AMZN", searchTerms: ["Amazon stock"] },
  { ticker: "META", name: "Meta Platforms", displayName: "Meta Platforms (META)", yahooSymbol: "META", searchTerms: ["Meta Platforms stock"] },
  { ticker: "GOOGL", name: "Alphabet", displayName: "Alphabet / Google (GOOGL)", yahooSymbol: "GOOGL", searchTerms: ["Alphabet Google stock"] },
  { ticker: "MSFT", name: "Microsoft", displayName: "Microsoft (MSFT)", yahooSymbol: "MSFT", searchTerms: ["Microsoft stock"] },
  { ticker: "MRK", name: "Merck", displayName: "Merck & Co. (MRK)", yahooSymbol: "MRK", searchTerms: ["Merck stock"] },
  { ticker: "TSMC", name: "TSMC", displayName: "Taiwan Semiconductor (TSMC)", yahooSymbol: "TSM", searchTerms: ["TSMC Taiwan Semiconductor stock"] },
  { ticker: "INVEB", name: "Investor AB", displayName: "Investor AB", yahooSymbol: "INVE-B.ST", searchTerms: ["Investor AB Wallenberg stock"] },
];

export function findCompany(ticker: string): Company | undefined {
  return companies.find((c) => c.ticker.toLowerCase() === ticker.toLowerCase());
}
