import { MapPin } from "lucide-react";

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-500 text-white">
        <MapPin className="h-4 w-4" />
      </span>
      <span>
        QalaQuest <span className="text-primary">AI</span>
      </span>
    </span>
  );
}
