"use client";

import { useRouter } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { savePoemVideoLink } from "@/lib/poem-video-actions";

export function PoemVideoEditor({ poemId, initialUrl }: { poemId: string; initialUrl: string | null }) {
  const router = useRouter();
  return <details className="panel poem-video-editor">
    <summary>管理这首诗的音乐视频</summary>
    <p className="small muted">粘贴小鹅通视频课程链接；孩子点击后会前往小鹅通观看。清空并保存可移除入口。</p>
    <FeedbackForm action={async (formData) => {
      const result = await savePoemVideoLink(formData);
      if (result.status === "success") router.refresh();
      return result;
    }} className="form-grid" pendingLabel="正在保存视频链接…" successTitle="视频入口已更新">
      <input type="hidden" name="poem_id" value={poemId} />
      <label>小鹅通视频链接<input name="music_video_url" type="url" defaultValue={initialUrl ?? ""} placeholder="https://…h5.xiaoeknow.com/p/course/video/…" maxLength={2000} /></label>
      <button className="secondary" type="submit">保存视频入口</button>
    </FeedbackForm>
  </details>;
}
