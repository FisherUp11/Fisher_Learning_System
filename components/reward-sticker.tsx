import { stickerPicture } from "@/lib/reward-types";

type RewardStickerProps = {
  code?: string | null;
  label?: string;
  size?: "small" | "large";
  empty?: boolean;
};

export function RewardSticker({ code, label, size = "small", empty = false }: RewardStickerProps) {
  const picture = stickerPicture(code);
  return (
    <span
      className={`reward-sticker ${size} ${empty ? "empty" : ""}`}
      aria-label={empty ? "还没有贴纸的位置" : label ?? `${picture.label}贴纸`}
    >
      <span aria-hidden="true">{empty ? "·" : picture.emoji}</span>
    </span>
  );
}
