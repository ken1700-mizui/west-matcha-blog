#!/usr/bin/env node
/**
 * West Matcha ブログ自動更新スクリプト
 *
 * 使い方:
 *   node generate-post.js drafts/single-origin.txt
 *   node generate-post.js drafts/single-origin.txt --review   (git pushせず内容確認のみ)
 *
 * 事前準備:
 *   1. 環境変数 ANTHROPIC_API_KEY をセットしておく (PowerShell例: $env:ANTHROPIC_API_KEY="sk-ant-...")
 *   2. このスクリプトを Astro プロジェクトのルートに置く
 *   3. src/content/blog/ ディレクトリが存在すること (Astro content collections想定)
 *   4. Node.js 18以上 (fetch が組み込みで使えるバージョン)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const BLOG_DIR = "src/content/blog";
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `あなたはWest Matchaというブランドのブログ記事を書くアシスタントです。

【ブランド概要】
- ブランド名: West Matcha
- 創業者: 名古屋出身、現在カナダ(マニトバ州)在住(年齢・具体的な居住地の詳細は書かない)
- 商品: 愛知県西尾市など日本の産地から仕入れる本格的な単一産地・儀式用抹茶。将来的にフレーバー系抹茶ラテミックスも展開予定
- ポジショニング: 「本格派・産地にこだわる」路線。カジュアル・フレーバー系の地元競合とは差別化する
- ターゲット読者: カナダ(特にWinnipeg)の抹茶に関心がある英語話者
- 署名は「West Matcha」または「J」

【記事の書き方】
- 日本語の下書きを、直訳ではなく英語圏の読者が自然に読めるブログ記事に書き直す
- タイトルはSEOで検索されやすいフレーズにする
- 専門的すぎず、初心者にも分かりやすいトーン
- 品質偽装など注意喚起は事実ベースで、誇張しない

【出力形式】
必ず以下のJSON形式のみを出力すること。前後に説明文やMarkdown記法のバッククォートは一切付けないこと。

{
  "title": "SEOタイトル(英語)",
  "metaDescription": "検索結果に表示される120〜155文字程度の英語の説明文",
  "slug": "url-slug-in-kebab-case",
  "body": "本文全体(英語、Markdown形式、見出しはh2=## 、h3=### を使用)",
  "translationNotes": "翻訳・意訳のポイントを日本語で簡潔に(3〜5行)"
}`;

async function generateArticle(draftText) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: draftText }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data.content.find((b) => b.type === "text")?.text ?? "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function buildMarkdown(article) {
  // west-matcha-blog の src/content.config.ts のスキーマに合わせる
  // (title, description, pubDate, updatedDate?, heroImage? のみ定義されている)
  const today = new Date().toISOString().split("T")[0];
  const frontmatter = [
    "---",
    `title: "${article.title.replace(/"/g, '\\"')}"`,
    `description: "${article.metaDescription.replace(/"/g, '\\"')}"`,
    `pubDate: ${today}`,
    "---",
    "",
  ].join("\n");

  return frontmatter + article.body + `\n\n— West Matcha / J\n`;
}

async function main() {
  const draftPath = process.argv[2];
  const reviewOnly = process.argv.includes("--review");

  if (!draftPath) {
    console.error("使い方: node generate-post.js <draft.txt> [--review]");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("環境変数 ANTHROPIC_API_KEY が設定されていません。");
    process.exit(1);
  }

  console.log("下書きを読み込み中...");
  const draftText = readFileSync(draftPath, "utf-8");

  console.log("Claude APIで記事を生成中...");
  const article = await generateArticle(draftText);

  const markdown = buildMarkdown(article);
  const outPath = path.join(BLOG_DIR, `${article.slug}.md`);

  if (!existsSync(BLOG_DIR)) mkdirSync(BLOG_DIR, { recursive: true });
  writeFileSync(outPath, markdown, "utf-8");
  console.log(`記事を作成しました: ${outPath}`);
  console.log(`\n--- 翻訳メモ ---\n${article.translationNotes}\n`);

  if (reviewOnly) {
    console.log("--review モードのため、git push はスキップしました。内容を確認してください。");
    return;
  }

  console.log("git commit & push 中...");
  execSync(`git add "${outPath}"`, { stdio: "inherit" });
  execSync(`git commit -m "Add blog post: ${article.title}"`, { stdio: "inherit" });
  execSync("git push", { stdio: "inherit" });

  console.log("\n完了です。Cloudflare Pagesが自動でビルド・公開します(数分待ってサイトを確認してください)。");
}

main().catch((err) => {
  console.error("エラーが発生しました:", err.message);
  process.exit(1);
});
