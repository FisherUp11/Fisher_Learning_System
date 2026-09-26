import { adultContext, checked, ownedProfile, reserveJob, uuid } from "@/lib/adult-server";
import { adultAudio } from "@/lib/adult-media";
import { meteredFetch } from "@/lib/metered-fetch";
import type { DailyPlan, EnglishLesson } from "@/lib/adult-learning";
import type { ListeningSession } from "@/lib/english-listening";
import { listeningAudioText } from "@/lib/english-audio";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  let failureJob: { db: Awaited<ReturnType<typeof adultContext>>["db"]; id: string } | null = null;
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) throw new Error("请求来源无效");
    const ctx = await adultContext();
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > 1200000) throw new Error("录音请控制在 30 秒以内");
      const form = await request.formData(); const id = uuid(form.get("id"));
      const plan = checked(await ctx.db.from("adult_english_plans").select("*").eq("id", uuid(form.get("plan_id"))).eq("owner_id", ctx.user.id).single()) as DailyPlan;
      await ownedProfile(ctx, plan.profile_id);
      const taskId = String(form.get("task_id")); if (!plan.tasks.some(t => t.id === taskId)) throw new Error("录音任务不存在");
      const file = form.get("audio"); if (!(file instanceof File) || file.size > 1000000 || file.size < 100) throw new Error("录音为空或过长，请重录");
      const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer);
      if (new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WAVE" || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint16(34, true) !== 16 || bytes.length > 16000 * 2 * 31 + 44) throw new Error("录音格式不支持，请使用页面录音按钮重试");
      const prior = await reserveJob(ctx, id, "transcription");
      if (prior) return Response.json(prior.result, { headers });
      failureJob = { db: ctx.db, id };
      const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION;
      if (!key || !region) throw new Error("Azure Speech 尚未配置；可切换文字作答");
      const response = await meteredFetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple`, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", Accept: "application/json" }, body: bytes, signal: AbortSignal.timeout(30000), cache: "no-store" }, {service:"stt",feature:"adult.transcription",model:"azure-speech-en-US",audioSeconds:Math.max(0,bytes.length-44)/32000});
      if (!response.ok) throw new Error(`转写暂时不可用（HTTP ${response.status}），可重试或文字作答`);
      const data = await response.json();
      if (data.RecognitionStatus !== "Success" || !data.DisplayText) throw new Error("没有听清有效语音，请重录或文字作答；此次不记为答错。");
      const result = { text: String(data.DisplayText), transcription_id: id, plan_id: plan.id, task_id: taskId, profile_id: plan.profile_id };
      checked(await ctx.db.from("adult_ai_jobs").update({ status: "complete", result, model: "azure-speech-en-US", updated_at: new Date().toISOString() }).eq("id", id));
      return Response.json(result, { headers });
    }
    const b = await request.json(); let text = "";
    if (b.concept_id) {
      const concept = checked(await ctx.db.from("adult_english_concepts").select("phrase,example").eq("id",uuid(b.concept_id)).eq("owner_id",ctx.user.id).single());
      if (b.field !== undefined && b.field !== "phrase" && b.field !== "example") throw new Error("朗读类型无效");
      text = b.field === "example" ? concept.example : concept.phrase;
    } else if (b.session_id) {
      const session = checked(await ctx.db.from("adult_listening_sessions").select("*").eq("id",uuid(b.session_id)).eq("owner_id",ctx.user.id).single()) as ListeningSession;
      const target = String(b.target ?? "summary");
      text = listeningAudioText(session,target,b.field);
    } else if (b.plan_id) {
      const plan = checked(await ctx.db.from("adult_english_plans").select("*").eq("id", uuid(b.plan_id)).eq("owner_id", ctx.user.id).single()) as DailyPlan;
      const task = plan.tasks.find(t => t.id === b.task_id); if (!task) throw new Error("任务不存在");
      text = b.reference === true ? task.answer : task.audio;
    } else {
      const lesson = checked(await ctx.db.from("adult_english_lessons").select("*").eq("id", uuid(b.lesson_id)).eq("owner_id", ctx.user.id).single()) as EnglishLesson;
      text = lesson.content?.summary ?? "";
    }
    if (!text || text.length > 8000) throw new Error("暂无可朗读的英文文本");
    const id = uuid(b.id); await reserveJob(ctx, id, "audio"); failureJob = { db: ctx.db, id };
    const audio = await adultAudio(ctx.user.id, text, b.slow === true);
    checked(await ctx.db.from("adult_ai_jobs").update({ status: "complete", updated_at: new Date().toISOString() }).eq("id", id));
    return new Response(audio as BodyInit, { headers: { ...headers, "Content-Type": "audio/mpeg" } });
  } catch (e) {
    if (failureJob) await failureJob.db.from("adult_ai_jobs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", failureJob.id);
    return Response.json({ error: e instanceof Error ? e.message : "语音暂不可用" }, { status: 400, headers });
  }
}
