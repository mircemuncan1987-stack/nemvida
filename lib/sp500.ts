// Snimak sastava S&P 500 indeksa. Sastav indeksa se povremeno menja
// (kvartalne revizije, spajanja, izlistavanja) — ova lista NIJE povučena
// uživo sa zvaničnog izvora (nema mrežnog pristupa za to u ovom okruženju),
// već je sastavljena iz opšteg znanja i može odstupati od trenutnog
// zvaničnog sastava. Za zvaničnu, uvek ažurnu listu vidi spglobal.com.

export const SP500_TICKERS: string[] = [
  // Tehnologija
  "AAPL","MSFT","NVDA","AVGO","ORCL","CRM","ADBE","AMD","CSCO","ACN","IBM","TXN","QCOM","INTU","AMAT",
  "NOW","PANW","ADI","LRCX","KLAC","SNPS","CDNS","MU","INTC","APH","ANSS","FTNT","MSI","ROP","CTSH",
  "GLW","HPQ","TEL","MCHP","ON","KEYS","TDY","TER","TRMB","ZBRA","JNPR","GEN","AKAM","EPAM","ENPH",
  "SWKS","QRVO","NTAP","WDC","STX","HPE","DELL","GDDY","FFIV","PTC","CDW","VRSN",
  // Komunikacione usluge
  "GOOGL","GOOG","META","NFLX","DIS","CMCSA","VZ","T","TMUS","CHTR","EA","TTWO","WBD","OMC","IPG",
  "MTCH","PARA","LYV","NWSA","NWS","FOXA","FOX",
  // Finansije
  "BRK.B","JPM","V","MA","BAC","WFC","GS","MS","SPGI","AXP","BLK","C","SCHW","CB","PGR","MMC","ICE",
  "PNC","USB","AON","CME","TFC","AJG","MCO","TRV","AFL","ALL","MET","AIG","PRU","COF","BK","FIS","FI",
  "STT","DFS","WTW","GPN","NDAQ","BRO","RJF","MTB","HBAN","FITB","SYF","KEY","CFG","RF","NTRS","CBOE",
  "CINF","L","GL","PFG","JKHY","IVZ","WRB","ERIE","MKTX","EG","AIZ",
  // Zdravstvo
  "UNH","JNJ","LLY","ABBV","MRK","TMO","ABT","PFE","DHR","BMY","AMGN","MDT","SYK","ISRG","VRTX","GILD",
  "ELV","CI","BSX","ZTS","REGN","BDX","HCA","MCK","CVS","HUM","EW","IDXX","IQV","A","DXCM","MRNA",
  "BIIB","RMD","ILMN","GEHC","ZBH","WAT","MTD","WST","STE","HOLX","VTRS","CAH","COR","CNC","MOH","UHS",
  "DVA","LH","BAX","ALGN","INCY","TECH","PODD","CRL","RVTY","TFX","SOLV",
  // Diskreciona potrošnja
  "AMZN","TSLA","HD","MCD","NKE","LOW","SBUX","TJX","BKNG","CMG","MAR","ORLY","AZO","GM","F","HLT",
  "YUM","ROST","DHI","LEN","LULU","GRMN","EBAY","EXPE","PHM","NVR","ULTA","DPZ","POOL","BBY","LVS",
  "WYNN","MGM","RL","DECK","TSCO","KMX","GPC","CCL","RCL","NCLH","APTV","WHR","MHK","BWA","TPR","HAS",
  // Osnovna potrošnja
  "PG","KO","PEP","COST","WMT","PM","MO","MDLZ","CL","KMB","GIS","STZ","SYY","KDP","KHC","HSY","MKC",
  "ADM","TSN","CHD","CLX","TAP","CAG","CPB","HRL","LW","BF.B","EL","MNST","KVUE","DG","DLTR","TGT","KR",
  // Industrija
  "GE","CAT","RTX","HON","UNP","BA","LMT","DE","ADP","UPS","ETN","WM","GD","ITW","EMR","NSC","CSX","PH",
  "TT","CARR","FDX","JCI","PCAR","CMI","ROK","IR","OTIS","XYL","AME","FAST","PAYX","VRSK","LHX","HWM",
  "DOV","GWW","EFX","URI","RSG","IEX","SNA","PWR","PNR","MAS","JBHT","EXPD","ALLE","LDOS","TDG","TXT",
  "HII","NDSN","WAB","CHRW","ODFL","BR","CTAS","LUV","DAL","UAL","AAL",
  // Energetika
  "XOM","CVX","COP","SLB","EOG","MPC","PSX","VLO","OXY","WMB","KMI","OKE","BKR","HES","DVN","FANG",
  "TRGP","CTRA","EQT","HAL","APA","MRO",
  // Sirovine
  "LIN","SHW","APD","ECL","FCX","NEM","DOW","DD","PPG","NUE","VMC","MLM","IFF","ALB","CTVA","CE","PKG",
  "IP","AVY","BALL","EMN","LYB","STLD","MOS","FMC",
  // Komunalije
  "NEE","SO","DUK","AEP","D","EXC","SRE","XEL","PEG","ED","WEC","ES","PPL","AEE","DTE","ATO","CMS","FE",
  "CNP","EIX","PCG","NI","LNT","EVRG","PNW","AWK",
  // Nekretnine
  "PLD","AMT","EQIX","PSA","CCI","O","WELL","SPG","DLR","VICI","AVB","EQR","SBAC","IRM","ARE","VTR",
  "ESS","MAA","KIM","INVH","UDR","HST","CPT","REG","EXR","BXP","FRT",
];
