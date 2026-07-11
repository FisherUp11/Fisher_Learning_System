// 字库在切换孩子、筛选和翻页时始终重新挂载，避免复用上一份字库的表单/详情 DOM。
export default function LibraryTemplate({ children }: { children: React.ReactNode }) {
  return children;
}
