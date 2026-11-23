"use server";

import { revalidatePath } from "next/cache";
import { adultCommand, numberValue, textValue, uuid } from "@/lib/adult-server";
import { videoContext, videoDatabaseError } from "@/lib/adult-video-server";
import { parseVideoImport } from "@/lib/adult-video-import";
import { readCsvUpload } from "@/lib/csv-import";
import { ImportProblem } from "@/lib/import-safety";
import { parseVideoTimestamp, youtubeId, type VideoAction } from "@/lib/adult-video";

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
      case "answer":
        if (!/^\d{4}-\d\d-\d\d$/.test(action.day)) throw new Error("请刷新词卡");
        payload = { concept_id: uuid(action.conceptId), day: action.day, result: action.result, request_id: uuid(action.requestId) };
        break;
      default: throw new Error("不支持的视频操作");
    }
    const result = await db.rpc("adult_video_command", { p_profile: id, p_action: action.type, p_data: payload });
    if (result.error) return { error: videoDatabaseError(result.error) };
    revalidatePath("/english/video");
    return { result: result.data as Record<string, unknown> };
  } catch (e) { return { error: e instanceof Error ? e.message : "暂时无法确认，请按原操作重试。" }; }
}
