import { categoryColor } from "@/lib/categories";

export const CategoryDot = ({ category }: { category: string }) => (
  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryColor(category) }} aria-hidden />
);
