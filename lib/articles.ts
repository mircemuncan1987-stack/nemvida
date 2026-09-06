import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import type { ArticleLang } from "./articleLangs";

export type { ArticleLang } from "./articleLangs";
export { LANG_LABELS } from "./articleLangs";

const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");

export type ArticleMeta = {
  slug: string;
  title: string;
  date: string;
  author: string;
  excerpt: string;
  lang: ArticleLang;
};

export type Article = ArticleMeta & {
  html: string;
};

function readSlugs(): string[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""));
}

export function getAllArticles(): ArticleMeta[] {
  return readSlugs()
    .map((slug) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, `${slug}.md`), "utf-8");
      const { data } = matter(raw);
      return {
        slug,
        title: data.title ?? slug,
        date: data.date ?? "",
        author: data.author ?? "Redakcija",
        excerpt: data.excerpt ?? "",
        lang: (data.lang as ArticleLang) ?? "sr",
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getArticle(slug: string): Article | null {
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return {
    slug,
    title: data.title ?? slug,
    date: data.date ?? "",
    author: data.author ?? "Redakcija",
    excerpt: data.excerpt ?? "",
    lang: (data.lang as ArticleLang) ?? "sr",
    html: marked.parse(content, { async: false }) as string,
  };
}
