const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself new news no nor not now of off on once only or other ought our ours ourselves out over own said same say says shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also inc corp ltd co reuters ap afp bloomberg according reported report reports says said`.split(
    /\s+/
  )
);

const BOILERPLATE = /subscribe|newsletter|sign up|cookie|advertisement|all rights reserved|terms of service|privacy policy|follow us|share this|related articles|read more|click here|log in|log out|sign in|skip to content|©|javascript is disabled/i;

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function extractParagraphs(html: string): string {
  const withoutJunk = html.replace(/<(script|style|nav|header|footer|aside|form|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const matches = [...withoutJunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = matches
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40 && !BOILERPLATE.test(p));
  return paragraphs.join(" ");
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 400 && !BOILERPLATE.test(s));
}

export function summarize(text: string, maxSentences = 4): string | null {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;
  if (sentences.length <= maxSentences) return sentences.join(" ");

  const freq: Record<string, number> = {};
  sentences.forEach((s) => {
    const words = s.toLowerCase().match(/[a-zà-öø-ÿčćžšđ']+/g) ?? [];
    words.forEach((w) => {
      if (w.length > 2 && !STOPWORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1;
    });
  });

  const scored = sentences.map((s, idx) => {
    const words = s.toLowerCase().match(/[a-zà-öø-ÿčćžšđ']+/g) ?? [];
    const raw = words.reduce((sum, w) => sum + (freq[w] ?? 0), 0);
    const score = words.length ? raw / Math.sqrt(words.length) : 0;
    const positionBonus = idx < 3 ? (3 - idx) * 0.8 : 0;
    return { s, idx, score: score + positionBonus };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.idx - b.idx);

  return top.map((t) => t.s).join(" ");
}
