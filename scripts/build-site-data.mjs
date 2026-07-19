import path from "node:path";
import { fileURLToPath } from "node:url";

import { archiveOptionsFromEnvironment, writeArchiveData } from "./build-archive-data.mjs";
import { writeReviewData } from "./build-review-data.mjs";

export function siteDataOptionsFromEnvironment(environment = process.env) {
  const workspace = environment.SITE_DATA_WORKSPACE || process.cwd();
  return {
    review: {
      workspace: environment.REVIEW_WORKSPACE || workspace,
      markdownPath: environment.REVIEW_MARKDOWN_PATH || undefined,
      obsidianRoot: environment.REVIEW_OBSIDIAN_ROOT || undefined,
      outputPath: environment.REVIEW_OUTPUT_PATH || undefined,
      mediaOutputDir: environment.REVIEW_MEDIA_OUTPUT_DIR || undefined,
    },
    archive: {
      ...archiveOptionsFromEnvironment(environment),
      workspace: environment.ARCHIVE_WORKSPACE || workspace,
    },
  };
}

export function buildSiteData(options = siteDataOptionsFromEnvironment()) {
  const review = writeReviewData(options.review);
  const archive = writeArchiveData(options.archive);
  return { review, archive };
}

function buildSummary({ review, archive }) {
  const reviewMedia = review.chapters.flatMap((chapter) => chapter.blocks)
    .filter((block) => ["image", "video", "media"].includes(block.type));
  return {
    review: {
      chapters: review.chapters.length,
      pages: review.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0),
      mediaEmbeds: reviewMedia.length,
    },
    archive: archive.summary,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildSummary(buildSiteData())));
}
