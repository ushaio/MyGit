import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function basename(path: string) {
  return path.replaceAll("\\", "/").replace(/\/$/, "").split("/").pop() || path;
}
export function joinPath(root: string, file: string) {
  return root.replace(/[\\/]$/, "") + "/" + file;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
