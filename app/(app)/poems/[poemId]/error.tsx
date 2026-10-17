"use client";

export default function PoemDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel" role="alert"><h1>这首诗暂时没能打开</h1><p className="lede">可能是网络或数据读取暂时失败，已保存的背诵记录不会丢失。</p><button type="button" className="primary" onClick={reset}>重新打开</button></section>;
}
