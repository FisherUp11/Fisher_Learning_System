"use server";

import { revalidatePath } from "next/cache";
import { adultCommand, numberValue, ownedProfile, textValue, uuid } from "@/lib/adult-server";
import { videoContext, videoDatabaseError } from "@/lib/adult-video-server";
import { parseVideoImport } from "@/lib/adult-video-import";
import { readCsvUpload } from "@/lib/csv-import";
import { ImportProblem } from "@/lib/import-safety";
import { parseVideoTimestamp, youtubeId, type VideoAction, type VideoAnswerReceipt } from "@/lib/adult-video";
import { readVideoPracticeQueue } from "@/lib/adult-video-practice-server";
import type { StudyAnswer } from "@/lib/study-answer-sync";

export async function reloadAdultVideoPractice(profileId: string) {
  const ctx = await videoContext();
  const profile = await ownedProfile(ctx, profileId);
  return readVideoPracticeQueue(ctx.db, ctx.user.id, profile.id);
}

export async function saveAdultVideoPracticeAnswer(answer: StudyAnswer): Promise<VideoAnswerReceipt | { error: string }> {
  try {
    if (!answer.day || !/^\d{4}-\d{2}-\d{2}$/.test(answer.day) || (answer.result !== "known" && answer.result !== "again"))
      throw new Error("请刷新词卡");
    const profileId = uuid(answer.learnerId), conceptId = uuid(answer.itemId), requestId = uuid(answer.requestId);
    const { db, user } = await videoContext();
    const result = await db.rpc("adult_video_command", { p_profile: profileId, p_action: "answer", p_data: {
      concept_id: conceptId, day: answer.day, result: answer.result, request_id: requestId,
    } });
    if (result.error) return { error: videoDatabaseError(result.error) };
    // The write has committed. A read failure must not turn it into an unconfirmed write.
    const [queue, stats] = await Promise.allSettled([
      readVideoPracticeQueue(db, user.id, profileId),
      db.from("adult_english_word_states").select("stage,attempts,due_date").eq("owner_id", user.id)
        .eq("profile_id", profileId).eq("concept_id", conceptId).maybeSingle(),
    ]);
    return { conceptId, result: result.data as VideoAnswerReceipt["result"],
      queue: queue.status === "fulfilled" ? queue.value : null,
      stats: stats.status === "fulfilled" && !stats.value.error ? stats.value.data : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "暂时无法确认，请按原操作重试。" };
  }
}

export async function previewAdultVideo(form: FormData) {
  try {
    await videoContext();
    const title = textValue(form.get("title"), 120);
    const url = textValue(form.get("url"), 500);
    youtubeId(url);
    const rows = parseVideoImport(await readCsvUpload(form.get("csv"), 1_000_000));
    return { title, url, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "词表预览失败", details: e instanceof ImportProblem ? e.details : undefined };
  }
}

export async function createVideoAdultProfile(form: FormData) {
  try {
    const ctx = await videoContext();
    await adultCommand(ctx, "profile", { name: form.get("name") });
    revalidatePath("/english/video");
    return { status: "success", message: "成人档案已准备好，可以导入视频词表。" };
  } catch (e) { return { status: "error", message: e instanceof Error ? e.message : "档案创建失败" }; }
}

export async function changeAdultVideo(profileId: string, action: VideoAction) {
  try {
    const { db } = await videoContext();
    const id = uuid(profileId);
    let payload: Record<string, unknown> = {};
    switch (action.type) {
      case "import":
        if (!Array.isArray(action.rows) || action.rows.length < 1 || action.rows.length > 200) throw new Error("每次导入 1～200 个词句");
        payload = {
          title: textValue(action.title, 120), youtube_id: youtubeId(textValue(action.url, 500)),
          rows: action.rows.map(row => ({
            word: textValue(row.word, 160), meaning: textValue(row.meaning, 240), example: textValue(row.example, 500, 0),
            pronunciation: textValue(row.pronunciation, 80, 0),
            timestamp: row.timestamp === null ? null : numberValue(row.timestamp, 0, 86399, true), track: row.track === true,
          })),
        };
        break;
      case "focus": payload = { video_id: uuid(action.videoId) }; break;
      case "checkin": payload = { video_id: uuid(action.videoId), request_id: uuid(action.requestId) }; break;
      case "edit_timestamp": payload = { video_id: uuid(action.videoId), concept_id: uuid(action.conceptId), timestamp: parseVideoTimestamp(action.timestamp) }; break;
      case "track": payload = { concept_id: uuid(action.conceptId), enabled: action.enabled === true }; break;
      case "settings": payload = { daily_new: numberValue(action.dailyNew, 0, 20, true) }; break;
      case "start": break;
      default: throw new Error("不支持的视频操作");
    }
    const result = await db.rpc("adult_video_command", { p_profile: id, p_action: action.type, p_data: payload });
    if (result.error) return { error: videoDatabaseError(result.error) };
    revalidatePath("/english/video");
    return { result: result.data as Record<string, unknown> };
  } catch (e) { return { error: e instanceof Error ? e.message : "暂时无法确认，请按原操作重试。" }; }
}
